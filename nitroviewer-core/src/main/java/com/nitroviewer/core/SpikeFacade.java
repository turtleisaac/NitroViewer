/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Copyright (c) 2026.
 *
 * This file is part of NitroViewer, released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.Fnt;
import io.github.turtleisaac.nds4j.Narc;
import io.github.turtleisaac.nds4j.NintendoDsRom;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Throwaway Phase-0 facade used only by the CheerpJ spike. It proves the whole chain works in a
 * WASM JVM: hand it ROM bytes, walk the FNT tree, and decode a real sprite to a PNG data URL.
 * <p>
 * Two conventions that the real {@code NitroViewerService} will inherit, learned from CheerpJ:
 * <ul>
 *   <li>Every method takes/returns only {@code int}, {@code byte[]}, or {@code String} (JSON /
 *       base64) — never a live Nds4j object, and never a {@code long} (long return values marshal
 *       poorly through CheerpJ). Handles are {@code int}.</li>
 *   <li>Nothing throws across the boundary. Java exceptions marshal badly to JS, so failures come
 *       back as {@code {"ok":false,"error":"..."}} JSON instead.</li>
 * </ul>
 * Static methods keep the JavaScript glue trivial (no constructor reflection).
 */
public final class SpikeFacade
{
    private static final Map<Integer, NintendoDsRom> ROMS = new ConcurrentHashMap<>();
    private static final AtomicInteger SEQ = new AtomicInteger(1);

    private SpikeFacade() {}

    // --- session -----------------------------------------------------------------------------

    /**
     * Parse a ROM from its raw bytes.
     * @return JSON {"ok":true,"handle":int,"len":int} or {"ok":false,"error":str,"len":int}.
     *         {@code len} echoes the received byte[] length so the browser can confirm the array
     *         arrived intact across the JS/JVM boundary.
     */
    public static String openRom(byte[] romBytes)
    {
        int len = romBytes == null ? -1 : romBytes.length;
        try
        {
            NintendoDsRom rom = new NintendoDsRom(romBytes);
            int handle = SEQ.getAndIncrement();
            ROMS.put(handle, rom);
            return "{\"ok\":true,\"handle\":" + handle + ",\"len\":" + len + "}";
        }
        catch (Throwable t)
        {
            StringBuilder sb = new StringBuilder("{\"ok\":false,");
            field(sb, "error", t.getClass().getName() + ": " + t.getMessage()).append(',');
            sb.append("\"len\":").append(len);
            return sb.append('}').toString();
        }
    }

    /** JSON: {"title","gameCode","numFiles"}. */
    public static String getRomInfo(int handle)
    {
        NintendoDsRom rom = require(handle);
        StringBuilder sb = new StringBuilder("{");
        field(sb, "title", rom.getTitle()).append(',');
        field(sb, "gameCode", rom.getGameCode()).append(',');
        sb.append("\"numFiles\":").append(rom.getNumFiles());
        return sb.append('}').toString();
    }

    // --- filesystem tree ---------------------------------------------------------------------

    /**
     * JSON tree of the ROM filesystem: {@code {"name","folders":[...],"files":[{"name","id"}]}}.
     * There is no public filenames getter on {@link NintendoDsRom}, so the tree is rebuilt from the
     * raw FNT via {@link Fnt#load(byte[])} — the canonical way to walk it.
     */
    public static String listTree(int handle)
    {
        NintendoDsRom rom = require(handle);
        Fnt.Folder root = Fnt.load(rom.getFnt());
        StringBuilder sb = new StringBuilder();
        writeFolder(sb, "/", root);
        return sb.toString();
    }

    private static void writeFolder(StringBuilder sb, String name, Fnt.Folder folder)
    {
        sb.append('{');
        field(sb, "name", name).append(',');

        sb.append("\"folders\":[");
        boolean first = true;
        for (Map.Entry<String, Fnt.Folder> e : folder.getFolders().entrySet())
        {
            if (!first) sb.append(',');
            first = false;
            writeFolder(sb, e.getKey(), e.getValue());
        }

        sb.append("],\"files\":[");
        int id = folder.getFirstId();
        first = true;
        for (String fileName : folder.getFiles())
        {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            field(sb, "name", fileName).append(',');
            sb.append("\"id\":").append(id).append('}');
            id++;
        }
        sb.append("]}");
    }

    // --- the decode proof --------------------------------------------------------------------

    /**
     * Scan the ROM for the first NARC that carries a decodable NCGR (RGCN) + NCLR (RLCN) pair and
     * render the tile graphics to a transparent PNG. Mirrors {@code CrossLayerRenderingTest}'s
     * bundle-finding logic, so it is known to succeed on the retail Gen IV ROMs.
     *
     * @return JSON: {"romFileId","narcName","ncgrIndex","nclrIndex","width","height","png"} where
     *         {@code png} is a {@code data:image/png;base64,...} URL, or {"error":...} if none found.
     */
    public static String decodeFirstSprite(int handle)
    {
        NintendoDsRom rom = require(handle);
        Fnt.Folder root = Fnt.load(rom.getFnt());

        for (int f = 0; f < rom.getNumFiles(); f++)
        {
            byte[] data = rom.getFile(f);
            if (!magic(data).equals("NARC"))
                continue;

            Narc narc;
            try { narc = new Narc(data); }
            catch (RuntimeException e) { continue; }

            int ncgrI = indexOf(narc, "RGCN");
            int nclrI = indexOf(narc, "RLCN");
            if (ncgrI < 0 || nclrI < 0)
                continue;

            String result = tryDecodePair(rom, root, f, narc, ncgrI, nclrI);
            if (result != null)
                return result;
        }
        return "{\"error\":\"no decodable NCGR+NCLR pair found in ROM\"}";
    }

    /**
     * Decode a specific NCGR+NCLR pair inside a specific NARC (identified by its ROM file id) — the
     * targeted counterpart to {@link #decodeFirstSprite(int)}, so the per-sprite decode cost can be
     * measured without the whole-ROM scan. Same JSON shape.
     */
    public static String decodeSprite(int handle, int romFileId, int ncgrIndex, int nclrIndex)
    {
        NintendoDsRom rom = require(handle);
        Fnt.Folder root = Fnt.load(rom.getFnt());
        try
        {
            Narc narc = new Narc(rom.getFile(romFileId));
            String result = tryDecodePair(rom, root, romFileId, narc, ncgrIndex, nclrIndex);
            return result != null ? result : "{\"error\":\"pair did not decode\"}";
        }
        catch (RuntimeException e)
        {
            StringBuilder sb = new StringBuilder("{");
            field(sb, "error", e.getClass().getSimpleName() + ": " + e.getMessage());
            return sb.append('}').toString();
        }
    }

    /** Render an NCGR+NCLR pair to a PNG, or return null if this NCGR rejects header geometry. */
    private static String tryDecodePair(NintendoDsRom rom, Fnt.Folder root, int romFileId,
                                        Narc narc, int ncgrI, int nclrI)
    {
        try
        {
            // 0,0 => let Nds4j read tile width and bit depth from the NCGR header.
            IndexedImage ncgr = new IndexedImage(narc.getFile(ncgrI), 0, 0, 1, 1, true);
            ncgr.setPalette(new Palette(narc.getFile(nclrI), 0));
            BufferedImage img = ncgr.getTransparentImage();

            StringBuilder sb = new StringBuilder("{");
            sb.append("\"romFileId\":").append(romFileId).append(',');
            field(sb, "narcName", nameOrNull(root, romFileId)).append(',');
            sb.append("\"ncgrIndex\":").append(ncgrI).append(',');
            sb.append("\"nclrIndex\":").append(nclrI).append(',');
            sb.append("\"width\":").append(img.getWidth()).append(',');
            sb.append("\"height\":").append(img.getHeight()).append(',');
            field(sb, "png", pngDataUrl(img));
            return sb.append('}').toString();
        }
        catch (RuntimeException e)
        {
            // Scanned/odd NCGRs can reject header-driven geometry; caller tries the next NARC.
            return null;
        }
    }

    // --- helpers -----------------------------------------------------------------------------

    private static NintendoDsRom require(int handle)
    {
        NintendoDsRom rom = ROMS.get(handle);
        if (rom == null)
            throw new IllegalArgumentException("no ROM open for handle " + handle);
        return rom;
    }

    /** First four bytes as a Latin-1 string, e.g. "NARC" / "RGCN"; matches raw on-disk magics. */
    private static String magic(byte[] d)
    {
        return d == null || d.length < 4 ? "" : new String(d, 0, 4, StandardCharsets.ISO_8859_1);
    }

    /** Index of the first embedded file in the NARC whose magic equals {@code magic}, or -1. */
    private static int indexOf(Narc narc, String magic)
    {
        for (int i = 0; i < narc.getNumFiles(); i++)
            if (magic(narc.getFile(i)).equals(magic))
                return i;
        return -1;
    }

    private static String nameOrNull(Fnt.Folder root, int id)
    {
        try { return root.getFilenameOf(id); }
        catch (RuntimeException e) { return null; }
    }

    private static String pngDataUrl(BufferedImage img)
    {
        try
        {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
        }
        catch (Exception e)
        {
            throw new RuntimeException("PNG encode failed: " + e.getMessage(), e);
        }
    }

    /** Append {@code "key":"value"} with minimal JSON string escaping; null -> JSON null. */
    private static StringBuilder field(StringBuilder sb, String key, String value)
    {
        sb.append('"').append(key).append("\":");
        if (value == null)
        {
            sb.append("null");
            return sb;
        }
        sb.append('"');
        for (int i = 0; i < value.length(); i++)
        {
            char c = value.charAt(i);
            switch (c)
            {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"');
    }
}
