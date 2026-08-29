/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.Fnt;
import io.github.turtleisaac.nds4j.Narc;
import io.github.turtleisaac.nds4j.NintendoDsRom;
import io.github.turtleisaac.nds4j.framework.NitroLz;
import io.github.turtleisaac.nds4j.g3d.GltfExporter;
import io.github.turtleisaac.nds4j.g3d.MaterialColorAnimationSet;
import io.github.turtleisaac.nds4j.g3d.Model;
import io.github.turtleisaac.nds4j.g3d.ModelSet;
import io.github.turtleisaac.nds4j.g3d.ParticleRenderer;
import io.github.turtleisaac.nds4j.g3d.ParticleSet;
import io.github.turtleisaac.nds4j.g3d.SkeletalAnimationSet;
import io.github.turtleisaac.nds4j.g3d.TexturePatternAnimationSet;
import io.github.turtleisaac.nds4j.g3d.TextureSet;
import io.github.turtleisaac.nds4j.g3d.VisibilityAnimationSet;
import io.github.turtleisaac.nds4j.images.CellAnimation;
import io.github.turtleisaac.nds4j.images.CellBank;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;
import io.github.turtleisaac.nds4j.images.Screen;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-browser (CheerpJ) implementation of {@link NitroViewerService} over Nds4j. Instantiated once
 * by the frontend; holds open ROMs and NARCs keyed by integer handles. See the interface for the
 * calling conventions (all returns are JSON; nothing throws across the boundary).
 */
public final class CheerpjFacade implements NitroViewerService
{
    private final Map<Integer, NintendoDsRom> roms = new ConcurrentHashMap<>();
    private final Map<Integer, Narc> narcs = new ConcurrentHashMap<>();
    // The (container,id) resource each narc-handle was opened from, so an edited sub-file can be repacked
    // back up the chain. container < 0 = a ROM file; container >= 0 = a sub-file of that parent narc-handle
    // (a NARC-in-NARC). writeResource walks this recursively, so nested NARCs edit + save correctly.
    private final Map<Integer, int[]> narcParent = new ConcurrentHashMap<>(); // narcHandle -> {container, id}
    private final AtomicInteger romSeq = new AtomicInteger(1);
    private final AtomicInteger narcSeq = new AtomicInteger(1);
    private volatile String lastError = "";

    // --- session -----------------------------------------------------------------------------

    @Override
    public String openRom(byte[] romBytes)
    {
        int len = romBytes == null ? -1 : romBytes.length;
        try
        {
            int handle = romSeq.getAndIncrement();
            roms.put(handle, new NintendoDsRom(romBytes));
            return "{\"ok\":true,\"handle\":" + handle + ",\"len\":" + len + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + ",\"len\":" + len + "}";
        }
    }

    @Override
    public String getRomInfo(int romHandle)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            return "{\"title\":" + jstr(rom.getTitle())
                    + ",\"gameCode\":" + jstr(rom.getGameCode())
                    + ",\"numFiles\":" + rom.getNumFiles() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public void closeRom(int romHandle)
    {
        roms.remove(romHandle);
    }

    // --- filesystem --------------------------------------------------------------------------

    @Override
    public String listTree(int romHandle)
    {
        try
        {
            Fnt.Folder root = Fnt.load(rom(romHandle).getFnt());
            StringBuilder sb = new StringBuilder();
            writeFolder(sb, "/", root);
            return sb.toString();
        }
        catch (Throwable t) { return err(t); }
    }

    private void writeFolder(StringBuilder sb, String name, Fnt.Folder folder)
    {
        sb.append("{\"name\":").append(jstr(name)).append(",\"folders\":[");
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
            sb.append("{\"name\":").append(jstr(fileName)).append(",\"id\":").append(id).append('}');
            id++;
        }
        sb.append("]}");
    }

    @Override
    public String detectFormat(int romHandle, int container, int id)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            byte[] raw = resolveRaw(rom, container, id);
            byte[] data = maybeDecompress(raw);
            boolean compressed = data != raw;
            return "{\"format\":" + jstr(formatOf(data))
                    + ",\"compressed\":" + compressed
                    + ",\"size\":" + raw.length + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    // --- NARC --------------------------------------------------------------------------------

    @Override
    public String openNarc(int romHandle, int romFileId)
    {
        return openNarcAt(romHandle, -1, romFileId); // a top-level ROM file is just container -1
    }

    @Override
    public String openNarcAt(int romHandle, int container, int id)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            // Resolve from anywhere: a ROM file (container < 0) OR a sub-file of an already-open NARC
            // (container >= 0) — i.e. a NARC-in-NARC.
            byte[] data = maybeDecompress(resolveRaw(rom, container, id));
            Narc narc = new Narc(data);
            int handle = narcSeq.getAndIncrement();
            narcs.put(handle, narc);
            narcParent.put(handle, new int[]{container, id});
            return "{\"narcHandle\":" + handle + ",\"numFiles\":" + narc.getNumFiles() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String listNarc(int narcHandle)
    {
        try
        {
            Narc narc = narc(narcHandle);
            StringBuilder sb = new StringBuilder("{\"files\":[");
            for (int i = 0; i < narc.getNumFiles(); i++)
            {
                if (i > 0) sb.append(',');
                byte[] raw = narc.getFile(i);
                byte[] data = maybeDecompress(raw);
                sb.append("{\"index\":").append(i)
                        .append(",\"size\":").append(raw.length)
                        .append(",\"format\":").append(jstr(formatOf(data))).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- 2D decode ---------------------------------------------------------------------------

    @Override
    public String decodeNcgr(int romHandle, int ncgrContainer, int ncgrId,
                             int nclrContainer, int nclrId, int tilesWidth,
                             boolean transparent, int paletteIndex, boolean scanFrontToBack)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, tilesWidth, scanFrontToBack);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);

            // 4bpp images index into 16-colour sub-palettes; select which one. 8bpp uses all 256.
            Color[] colors = pal.getColors();
            int subPalettes = ncgr.getBitDepth() == 4 ? Math.max(1, colors.length / 16) : 1;
            if (ncgr.getBitDepth() == 4 && colors.length > 16)
            {
                int idx = Math.max(0, Math.min(paletteIndex, subPalettes - 1));
                pal = new Palette(Arrays.copyOfRange(colors, idx * 16, idx * 16 + 16));
            }

            ncgr.setPalette(pal);
            BufferedImage img = transparent ? ncgr.getTransparentImage() : ncgr.getImage();
            return imageJson(img, subPalettes);
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodePalette(int romHandle, int nclrContainer, int nclrId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            Color[] colors = pal.getColors();
            StringBuilder sb = new StringBuilder("{\"count\":").append(colors.length).append(",\"colors\":[");
            for (int i = 0; i < colors.length; i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(hex(colors[i])));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNscr(int romHandle, int nscrContainer, int nscrId,
                             int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                             boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Screen screen = new Screen(resolve(rom, nscrContainer, nscrId));
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            return imageJson(transparent ? screen.getTransparentImage(ncgr, pal)
                                         : screen.getImage(ncgr, pal));
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNcerMeta(int romHandle, int ncerContainer, int ncerId)
    {
        try
        {
            CellBank bank = new CellBank(resolve(rom(romHandle), ncerContainer, ncerId));
            return "{\"cellCount\":" + bank.getNumCells() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNcer(int romHandle, int ncerContainer, int ncerId,
                             int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                             int cellIndex, boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            ncgr.setPalette(new Palette(resolve(rom, nclrContainer, nclrId), 0));
            // A scanned (bitmap) NCGR — e.g. DPPt trbgra.narc trainer sprites — can't be composed
            // through an NCER (Nds4j only implements tiled-OBJ composition; a re-tiled bitmap scrambles).
            // Its own pixels ARE the assembled sprite, so render the NCGR directly instead of erroring.
            if (ncgr.isScanned())
                return scannedNcgrJson(ncgr, transparent);
            CellBank bank = new CellBank(resolve(rom, ncerContainer, ncerId));
            bank.setParentImage(ncgr);
            return imageJson(transparent ? bank.getTransparentNcerImage(cellIndex)
                                         : bank.getNcerImage(cellIndex));
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNanrMeta(int romHandle, int nanrContainer, int nanrId)
    {
        try
        {
            CellAnimation anim = new CellAnimation(resolve(rom(romHandle), nanrContainer, nanrId));
            CellAnimation.Animation[] animations = anim.getAnimations();
            StringBuilder sb = new StringBuilder("{\"animations\":[");
            for (int i = 0; i < animations.length; i++)
            {
                if (i > 0) sb.append(',');
                sb.append("{\"frames\":").append(animations[i].getFrames().length).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNanr(int romHandle, int nanrContainer, int nanrId,
                             int ncerContainer, int ncerId, int ncgrContainer, int ncgrId,
                             int nclrContainer, int nclrId, int animIndex, int frameIndex,
                             boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            ncgr.setPalette(new Palette(resolve(rom, nclrContainer, nclrId), 0));
            if (ncgr.isScanned())
                return scannedNcgrJson(ncgr, transparent); // see decodeNcer — bitmap parent, render direct
            CellBank bank = new CellBank(resolve(rom, ncerContainer, ncerId));
            bank.setParentImage(ncgr);
            CellAnimation anim = new CellAnimation(resolve(rom, nanrContainer, nanrId));
            anim.setCellBank(bank);
            CellAnimation.Animation.Frame frame = anim.getAnimations()[animIndex].getFrames()[frameIndex];
            return imageJson(anim.getFrameImage(frame));
        }
        catch (Throwable t) { return err(t); }
    }

    // --- export ------------------------------------------------------------------------------

    @Override
    public String exportRaw(int romHandle, int container, int id)
    {
        try
        {
            byte[] raw = resolveRaw(rom(romHandle), container, id);
            return "{\"size\":" + raw.length + ",\"base64\":" + jstr(base64(raw)) + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String exportFile(int romHandle, int container, int id)
    {
        try
        {
            // The usable, standalone format file: LZ-decompressed if the ROM stored it compressed, so the
            // extracted bytes open in Tinke/other tools and re-import cleanly (Tinke extracts decompressed).
            byte[] raw = resolveRaw(rom(romHandle), container, id);
            byte[] data = maybeDecompress(raw);
            return "{\"size\":" + data.length
                    + ",\"format\":" + jstr(formatOf(data))
                    + ",\"compressed\":" + (data != raw)
                    + ",\"base64\":" + jstr(base64(data)) + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String exportFolderZip(int romHandle, String folderPath)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Fnt.Folder folder = findFolderByPath(Fnt.load(rom.getFnt()), folderPath);
            if (folder == null)
                return "{\"ok\":false,\"error\":" + jstr("No folder at path " + folderPath) + "}";
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(baos);
            int[] count = {0};
            zipFolder(zip, rom, folder, "", count); // recurse, mirroring the directory layout
            zip.close();
            return "{\"ok\":true,\"count\":" + count[0] + ",\"base64\":" + jstr(base64(baos.toByteArray())) + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    /** Navigate the FNT to the folder at {@code path} (e.g. "/application/balloon"); root for "" or "/". */
    private static Fnt.Folder findFolderByPath(Fnt.Folder root, String path)
    {
        Fnt.Folder cur = root;
        for (String seg : path.split("/"))
        {
            if (seg.isEmpty()) continue;
            cur = cur.getFolders().get(seg);
            if (cur == null) return null;
        }
        return cur;
    }

    /** Zip every file under {@code folder} (decompressed) with paths relative to it, recursing subfolders. */
    private void zipFolder(java.util.zip.ZipOutputStream zip, NintendoDsRom rom, Fnt.Folder folder,
                           String prefix, int[] count) throws java.io.IOException
    {
        int id = folder.getFirstId();
        for (String fileName : folder.getFiles())
        {
            zip.putNextEntry(new java.util.zip.ZipEntry(prefix + fileName));
            zip.write(maybeDecompress(rom.getFile(id)));
            zip.closeEntry();
            count[0]++;
            id++;
        }
        for (Map.Entry<String, Fnt.Folder> e : folder.getFolders().entrySet())
            zipFolder(zip, rom, e.getValue(), prefix + e.getKey() + "/", count);
    }

    @Override
    public String exportNarcZip(int romHandle, int container, int id)
    {
        try
        {
            Narc narc = new Narc(maybeDecompress(resolveRaw(rom(romHandle), container, id)));
            int n = narc.getNumFiles();
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(baos);
            for (int i = 0; i < n; i++)
            {
                byte[] data = maybeDecompress(narc.getFile(i)); // extract the usable, decompressed sub-file
                zip.putNextEntry(new java.util.zip.ZipEntry(String.format("%04d.%s", i, extForFormat(formatOf(data)))));
                zip.write(data);
                zip.closeEntry();
            }
            zip.close();
            return "{\"ok\":true,\"count\":" + n + ",\"base64\":" + jstr(base64(baos.toByteArray())) + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public String importNarcZip(int romHandle, int container, int id, byte[] zipBytes)
    {
        try
        {
            if (zipBytes == null || zipBytes.length == 0) throw new IllegalArgumentException("no zip data");
            Narc narc = new Narc(maybeDecompress(resolveRaw(rom(romHandle), container, id)));

            // Collect the zip's files, ordered by the leading integer in each name (so "0000.nscr",
            // "0001.nscr", … rebuild in order); ties and non-numeric names fall back to zip order.
            java.util.List<Object[]> got = new java.util.ArrayList<>();
            java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zipBytes));
            java.util.zip.ZipEntry e;
            int order = 0;
            byte[] chunk = new byte[8192];
            while ((e = zis.getNextEntry()) != null)
            {
                if (e.isDirectory()) continue;
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                int r;
                while ((r = zis.read(chunk)) > 0) buf.write(chunk, 0, r);
                String base = e.getName().substring(e.getName().lastIndexOf('/') + 1);
                got.add(new Object[]{leadingInt(base, order), order, buf.toByteArray()});
                order++;
            }
            if (got.isEmpty()) throw new IllegalArgumentException("the zip contained no files");
            got.sort((a, b) -> {
                int c = Integer.compare((Integer) a[0], (Integer) b[0]);
                return c != 0 ? c : Integer.compare((Integer) a[1], (Integer) b[1]);
            });

            java.util.ArrayList<byte[]> files = new java.util.ArrayList<>();
            for (int i = 0; i < got.size(); i++)
            {
                // Re-compress a rebuilt sub-file if the original at that index was compressed (the zip holds
                // decompressed files); extra/new files (beyond the original count) are stored uncompressed.
                byte[] original = i < narc.getNumFiles() ? narc.getFile(i) : null;
                files.add(matchCompression(original, (byte[]) got.get(i)[2]));
            }
            narc.setFiles(files);
            writeResource(romHandle, container, id, narc.save());
            return "{\"ok\":true,\"count\":" + files.size() + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    /** Leading run of digits in a filename as an int, else {@code fallback} (keeps foreign zips in order). */
    private static int leadingInt(String name, int fallback)
    {
        int i = 0;
        while (i < name.length() && Character.isDigit(name.charAt(i))) i++;
        if (i == 0) return Integer.MAX_VALUE - 1_000_000 + Math.min(fallback, 999_999); // non-numeric names sort last
        try { return Integer.parseInt(name.substring(0, i)); }
        catch (NumberFormatException ex) { return fallback; }
    }

    /** A file extension for a Nitro format name (lower-cased), or "bin" for unknown/raw. */
    private static String extForFormat(String fmt)
    {
        return (fmt == null || fmt.isEmpty()) ? "bin" : fmt.toLowerCase(java.util.Locale.ROOT);
    }

    // --- import / save (write half) ----------------------------------------------------------

    @Override
    public String importRaw(int romHandle, int container, int id, byte[] bytes)
    {
        try
        {
            if (bytes == null) throw new IllegalArgumentException("no bytes");
            rom(romHandle); // validate the handle before touching anything
            writeResource(romHandle, container, id, bytes);
            return "{\"ok\":true,\"size\":" + bytes.length + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    /**
     * Persist {@code bytes} to the addressed resource. ROM file ({@code container < 0}) → direct
     * {@code setFile}. NARC entry → update the sub-file, then repack that NARC and write it back into
     * whatever it was opened from — recursively, so a NARC-in-NARC edit repacks all the way up to the
     * ROM file. Shared by {@link #importRaw} and {@link #importPng}.
     */
    private void writeResource(int romHandle, int container, int id, byte[] bytes)
    {
        if (container < 0)
        {
            NintendoDsRom rom = rom(romHandle);
            rom.setFile(id, matchCompression(rom.getFile(id), bytes));
            return;
        }
        Narc narc = narc(container);
        narc.setFile(id, matchCompression(narc.getFile(id), bytes));
        int[] parent = narcParent.get(container);
        if (parent == null)
            throw new IllegalStateException("NARC handle " + container + " has no known parent to repack into");
        // Recurse up the chain — matchCompression at the parent level keeps a compressed NARC file compressed.
        writeResource(romHandle, parent[0], parent[1], narc.save());
    }

    /**
     * Keep an edited resource in the compression state the ROM stored it in: if the slot held LZ-compressed
     * bytes, re-compress the new (decompressed) content with the same LZ type, so games that require certain
     * files compressed keep working. No-op when the slot was uncompressed, or when the new bytes are already
     * compressed (e.g. re-importing an already-compressed file, or an undo restoring exact prior bytes).
     * <p>Guards {@link NitroLz#isCompressed}'s false positives by requiring the existing bytes to actually
     * decompress before committing to re-compression.
     */
    private static byte[] matchCompression(byte[] existing, byte[] newBytes)
    {
        if (existing == null || newBytes == null || !NitroLz.isCompressed(existing))
            return newBytes;
        int type;
        try { NitroLz.decompress(existing); type = existing[0] & 0xFF; } // real compressed file (not a false positive)
        catch (Throwable t) { return newBytes; }                          // isCompressed lied — leave as-is
        if (NitroLz.isCompressed(newBytes))
        {
            try { NitroLz.decompress(newBytes); return newBytes; }        // already compressed — don't double-compress
            catch (Throwable t) { /* false positive on the new bytes; compress below */ }
        }
        return type == 0x11 ? NitroLz.compressLz11(newBytes) : NitroLz.compress(newBytes);
    }

    @Override
    public String importPng(int romHandle, int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                            int paletteIndex, int tilesWidth, boolean rebuildPalette, boolean dryRun,
                            byte[] pngBytes)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            // Load the EXISTING NCGR so its geometry (dimensions, bit depth, tiling) is preserved — the
            // imported pixels just overwrite it, then it re-encodes cleanly. (This is why we don't build
            // an IndexedImage from scratch: the header fields would be lost.)
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, tilesWidth);
            int bitDepth = ncgr.getBitDepth();

            BufferedImage src = ImageIO.read(new java.io.ByteArrayInputStream(pngBytes));
            if (src == null)
                throw new IllegalArgumentException("Could not decode the imported file as an image.");
            if (src.getWidth() != ncgr.getWidth() || src.getHeight() != ncgr.getHeight())
                return "{\"ok\":false,\"error\":" + jstr(String.format(
                        "Imported image is %dx%d but the sprite is %dx%d — they must match.",
                        src.getWidth(), src.getHeight(), ncgr.getWidth(), ncgr.getHeight())) + "}";

            Palette full = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            Color[] fullColors = full.getColors();

            int unmatched;
            if (rebuildPalette)
            {
                int maxColors = bitDepth == 8 ? 256 : 16;
                Palette rebuilt = ncgr.applyImageQuantized(src, maxColors);
                if (!dryRun)
                {
                    writeResource(romHandle, ncgrContainer, ncgrId, ncgr.save());
                    // Splice the rebuilt colours into the NCLR: for 4bpp only the selected 16-colour
                    // sub-palette block, for 8bpp the whole 256. Other sub-palettes are left intact.
                    int blockLen = bitDepth == 8 ? 256 : 16;
                    int subCount = Math.max(1, fullColors.length / blockLen);
                    int blockStart = (bitDepth == 8 ? 0 : Math.max(0, Math.min(paletteIndex, subCount - 1))) * blockLen;
                    int mergedLen = Math.max(fullColors.length, blockStart + blockLen);
                    Color[] merged = new Color[mergedLen];
                    for (int i = 0; i < mergedLen; i++)
                        merged[i] = i < fullColors.length ? fullColors[i] : Color.BLACK;
                    Color[] rc = rebuilt.getColors();
                    for (int i = 0; i < blockLen && i < rc.length; i++)
                        merged[blockStart + i] = rc[i];
                    writeResource(romHandle, nclrContainer, nclrId, new Palette(merged).save());
                }
                unmatched = 0; // a rebuilt palette fits by construction
            }
            else
            {
                // Match against the palette the sprite actually uses: the selected 16-colour sub-palette
                // for 4bpp, the full palette for 8bpp.
                Palette use = full;
                if (bitDepth == 4 && fullColors.length > 16)
                {
                    int subCount = fullColors.length / 16;
                    int idx = Math.max(0, Math.min(paletteIndex, subCount - 1));
                    use = new Palette(Arrays.copyOfRange(fullColors, idx * 16, idx * 16 + 16));
                }
                ncgr.setPalette(use);
                unmatched = ncgr.applyImageMatched(src);
                if (!dryRun)
                    writeResource(romHandle, ncgrContainer, ncgrId, ncgr.save());
            }

            return "{\"ok\":true,\"width\":" + ncgr.getWidth() + ",\"height\":" + ncgr.getHeight()
                    + ",\"unmatched\":" + unmatched + ",\"paletteRebuilt\":" + rebuildPalette
                    + ",\"dryRun\":" + dryRun + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public String importPalette(int romHandle, int nclrContainer, int nclrId, byte[] imageBytes)
    {
        try
        {
            if (imageBytes == null) throw new IllegalArgumentException("no bytes");
            NintendoDsRom rom = rom(romHandle);
            Palette existing = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            int count = existing.getColors().length;

            BufferedImage src = ImageIO.read(new java.io.ByteArrayInputStream(imageBytes));
            if (src == null)
                throw new IllegalArgumentException("Could not decode the imported file as an image.");

            // Collect the image's colours in first-seen raster order (dedup on RGB). An indexed PNG's
            // IndexColorModel is honoured naturally: distinct entries appear as distinct pixel colours.
            java.util.LinkedHashSet<Integer> uniq = new java.util.LinkedHashSet<>();
            outer:
            for (int y = 0; y < src.getHeight(); y++)
                for (int x = 0; x < src.getWidth(); x++)
                {
                    uniq.add(src.getRGB(x, y) & 0xFFFFFF);
                    if (uniq.size() >= count) break outer;
                }

            // Preserve the palette's length so the paired NCGR's indices stay valid: fill from the image,
            // pad the tail with black, truncate the excess.
            Color[] cols = new Color[count];
            int i = 0;
            for (int rgb : uniq) { if (i >= count) break; cols[i++] = new Color(rgb); }
            while (i < count) cols[i++] = Color.BLACK;

            writeResource(romHandle, nclrContainer, nclrId, new Palette(cols).save());
            return "{\"ok\":true,\"colors\":" + count + ",\"unique\":" + uniq.size() + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public String importObj(int romHandle, int container, int id, byte[] objBytes)
    {
        try
        {
            if (objBytes == null || objBytes.length == 0) throw new IllegalArgumentException("no OBJ data");
            rom(romHandle); // validate handle
            String objText = new String(objBytes, StandardCharsets.UTF_8);
            io.github.turtleisaac.nds4j.g3d.ObjImporter obj = io.github.turtleisaac.nds4j.g3d.ObjImporter.parse(objText);
            float[] pos = obj.getPositions();
            int[] tris = obj.getTriangles();
            if (tris.length < 3) throw new IllegalArgumentException("OBJ has no triangles.");

            byte[] nsbmd = io.github.turtleisaac.nds4j.g3d.ModelBuilder.buildUntextured("model", pos, tris);
            writeResource(romHandle, container, id, nsbmd);
            return "{\"ok\":true,\"vertices\":" + (pos.length / 3) + ",\"triangles\":" + (tris.length / 3)
                    + ",\"textured\":false}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public String importObjTextured(int romHandle, int container, int id, byte[] payload)
    {
        try
        {
            // One byte[] (the proven CheerpJ shape): [u32 LE objLen][obj UTF-8][texture image bytes].
            if (payload == null || payload.length < 4) throw new IllegalArgumentException("no payload");
            int objLen = (payload[0] & 0xFF) | (payload[1] & 0xFF) << 8 | (payload[2] & 0xFF) << 16 | (payload[3] & 0xFF) << 24;
            if (objLen < 0 || 4 + objLen > payload.length) throw new IllegalArgumentException("bad payload framing");
            rom(romHandle);

            String objText = new String(payload, 4, objLen, StandardCharsets.UTF_8);
            byte[] texBytes = Arrays.copyOfRange(payload, 4 + objLen, payload.length);
            io.github.turtleisaac.nds4j.g3d.ObjImporter obj = io.github.turtleisaac.nds4j.g3d.ObjImporter.parse(objText);
            float[] pos = obj.getPositions();
            int[] tris = obj.getTriangles();
            if (tris.length < 3) throw new IllegalArgumentException("OBJ has no triangles.");
            if (!obj.hasTexcoords()) throw new IllegalArgumentException("The OBJ has no texture coordinates (vt) to map the texture.");

            BufferedImage tex = ImageIO.read(new java.io.ByteArrayInputStream(texBytes));
            if (tex == null) throw new IllegalArgumentException("Could not decode the texture image.");
            float[] uv = obj.texcoordsInTexels(tex.getWidth(), tex.getHeight());
            byte[] nsbmd = io.github.turtleisaac.nds4j.g3d.ModelBuilder.buildTextured("model", pos, uv, tris, tex);
            writeResource(romHandle, container, id, nsbmd);
            return "{\"ok\":true,\"vertices\":" + (pos.length / 3) + ",\"triangles\":" + (tris.length / 3)
                    + ",\"textured\":true}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public String importScreenPng(int romHandle, int nscrContainer, int nscrId, int ncgrContainer, int ncgrId,
                                  int nclrContainer, int nclrId, boolean dedupFlips, boolean rebuildPalette,
                                  int numSubPalettes, boolean dryRun, byte[] pngBytes)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Screen screen = new Screen(resolve(rom, nscrContainer, nscrId));
            // The existing NCGR is the template: it supplies the bit depth and the tileset's storage width.
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);

            BufferedImage src = ImageIO.read(new java.io.ByteArrayInputStream(pngBytes));
            if (src == null)
                throw new IllegalArgumentException("Could not decode the imported file as an image.");
            if (src.getWidth() != screen.getWidth() || src.getHeight() != screen.getHeight())
                return "{\"ok\":false,\"error\":" + jstr(String.format(
                        "Imported image is %dx%d but the screen is %dx%d — they must match.",
                        src.getWidth(), src.getHeight(), screen.getWidth(), screen.getHeight())) + "}";

            Screen.ImportResult result;
            if (rebuildPalette)
            {
                int subs = numSubPalettes > 0 ? numSubPalettes : Math.max(1, pal.getColors().length / 16);
                result = screen.applyImageRebuildingPalette(src, ncgr, subs, dedupFlips);
            }
            else
            {
                result = screen.applyImage(src, ncgr, pal, dedupFlips);
            }

            if (!dryRun)
            {
                // Persist the rebuilt tileset, the rewritten tilemap, and (on rebuild) the new palette.
                writeResource(romHandle, ncgrContainer, ncgrId, result.ncgr.save());
                writeResource(romHandle, nscrContainer, nscrId, screen.save());
                if (rebuildPalette)
                    writeResource(romHandle, nclrContainer, nclrId, result.palette.save());
            }

            return "{\"ok\":true,\"uniqueTiles\":" + result.uniqueTiles
                    + ",\"unmatched\":" + result.unmatchedPixels
                    + ",\"paletteRebuilt\":" + rebuildPalette
                    + ",\"dryRun\":" + dryRun + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + "}";
        }
    }

    @Override
    public byte[] saveRom(int romHandle)
    {
        try
        {
            // updateDeviceCapacity=false, per Nds4j's own examples — the cartridge size is unchanged;
            // save() recomputes the FAT so growing/shrinking individual files is fine.
            byte[] out = rom(romHandle).save(false);
            lastError = "";
            return out;
        }
        catch (Throwable t)
        {
            lastError = describe(t);
            return new byte[0];
        }
    }

    @Override
    public String lastError()
    {
        return lastError;
    }

    // --- 3D (static models) ------------------------------------------------------------------

    @Override
    public String getModelSetInfo(int romHandle, int container, int id)
    {
        try
        {
            ModelSet ms = new ModelSet(resolve(rom(romHandle), container, id));
            List<Model> models = ms.getModels();
            StringBuilder sb = new StringBuilder("{\"hasEmbeddedTextures\":")
                    .append(ms.hasEmbeddedTextures()).append(",\"models\":[");
            for (int i = 0; i < models.size(); i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(models.get(i).getName()));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getAnimationSetInfo(int romHandle, int container, int id)
    {
        try
        {
            SkeletalAnimationSet set = new SkeletalAnimationSet(resolve(rom(romHandle), container, id));
            List<SkeletalAnimationSet.Animation> anims = set.getAnimations();
            StringBuilder sb = new StringBuilder("{\"animations\":[");
            for (int i = 0; i < anims.size(); i++)
            {
                if (i > 0) sb.append(',');
                sb.append("{\"name\":").append(jstr(anims.get(i).getName()))
                        .append(",\"frameCount\":").append(anims.get(i).getFrameCount()).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String exportModelGltf(int romHandle, int nsbmdContainer, int nsbmdId, int modelIndex,
                                  int nsbtxContainer, int nsbtxId, int nsbcaContainer, int nsbcaId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            ModelSet ms = new ModelSet(resolve(rom, nsbmdContainer, nsbmdId));
            List<Model> models = ms.getModels();
            if (modelIndex < 0 || modelIndex >= models.size())
                return "ERROR: model index " + modelIndex + " out of range (" + models.size() + ")";

            // Textures are optional: an explicit NSBTX, else the embedded TEX0, else untextured
            // (GltfExporter accepts a null TextureSet and emits materials without textures).
            TextureSet tex = null;
            if (nsbtxId >= 0)
                tex = new TextureSet(resolve(rom, nsbtxContainer, nsbtxId));
            else if (ms.hasEmbeddedTextures())
                tex = ms.getEmbeddedTextures();

            Model model = models.get(modelIndex);
            if (nsbcaId >= 0)
            {
                // Bake the NSBCA's skeletal animations into the glTF (three.js plays them natively).
                SkeletalAnimationSet anims = new SkeletalAnimationSet(resolve(rom, nsbcaContainer, nsbcaId));
                return GltfExporter.toGltf(model, tex, anims.getAnimations(), null);
            }
            return GltfExporter.toGltf(model, tex);
        }
        catch (Throwable t)
        {
            return "ERROR: " + describe(t);
        }
    }

    @Override
    public String decodeTextureSet(int romHandle, int container, int id)
    {
        try
        {
            TextureSet ts = new TextureSet(resolve(rom(romHandle), container, id));
            StringBuilder sb = new StringBuilder("{\"textures\":[");
            boolean first = true;
            for (TextureSet.Texture tex : ts.getTextures())
            {
                String png;
                try { png = pngDataUrl(ts.getImage(tex)); }
                catch (Throwable e) { continue; } // skip textures that fail to decode
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":").append(jstr(tex.getName()))
                        .append(",\"width\":").append(tex.getWidth())
                        .append(",\"height\":").append(tex.getHeight())
                        .append(",\"png\":").append(jstr(png))
                        .append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getModelRig(int romHandle, int container, int id, int modelIndex)
    {
        try
        {
            Model m = new ModelSet(resolve(rom(romHandle), container, id)).getModels().get(modelIndex);
            List<Model.Mesh> meshes = m.getMeshes();
            StringBuilder sb = new StringBuilder("{\"nodeCount\":").append(m.getNodeCount()).append(",\"meshes\":[");
            for (int i = 0; i < meshes.size(); i++)
            {
                if (i > 0) sb.append(',');
                Model.Mesh mesh = meshes.get(i);
                sb.append("{\"material\":").append(jstr(mesh.getMaterial().getName()))
                        .append(",\"node\":").append(mesh.getNodeIndex()).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- 3D animation tracks with no glTF path (driven in three.js from this data) ------------

    @Override
    public String getMaterialColorAnim(int romHandle, int container, int id, int animIndex)
    {
        try
        {
            MaterialColorAnimationSet set = new MaterialColorAnimationSet(resolve(rom(romHandle), container, id));
            MaterialColorAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();
            StringBuilder sb = new StringBuilder("{\"frameCount\":").append(fc).append(",\"materials\":[");
            boolean first = true;
            for (MaterialColorAnimationSet.MaterialColor mc : anim.getMaterials())
            {
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":").append(jstr(mc.getName())).append(",\"diffuse\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(jstr(String.format("#%06x", mc.getDiffuse().rgbAt(f) & 0xFFFFFF)));
                }
                sb.append("],\"alpha\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(String.format("%.4f", mc.getAlpha().at(f) / 31.0));
                }
                sb.append("]}");
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getVisibilityAnim(int romHandle, int container, int id, int animIndex)
    {
        try
        {
            VisibilityAnimationSet set = new VisibilityAnimationSet(resolve(rom(romHandle), container, id));
            VisibilityAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();
            int nc = anim.getNodeCount();
            StringBuilder sb = new StringBuilder("{\"frameCount\":").append(fc)
                    .append(",\"nodeCount\":").append(nc).append(",\"visible\":[");
            for (int n = 0; n < nc; n++)
            {
                if (n > 0) sb.append(',');
                sb.append('[');
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(anim.isVisible(n, f) ? '1' : '0');
                }
                sb.append(']');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getTexturePatternAnim(int romHandle, int nsbtpContainer, int nsbtpId, int animIndex,
                                        int nsbmdContainer, int nsbmdId, int nsbtxContainer, int nsbtxId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            TexturePatternAnimationSet set = new TexturePatternAnimationSet(resolve(rom, nsbtpContainer, nsbtpId));
            TexturePatternAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();

            TextureSet tex = null;
            try
            {
                if (nsbtxId >= 0)
                    tex = new TextureSet(resolve(rom, nsbtxContainer, nsbtxId));
                else if (nsbmdId >= 0)
                    tex = new ModelSet(resolve(rom, nsbmdContainer, nsbmdId)).getEmbeddedTextures();
            }
            catch (Throwable e) { tex = null; } // no textures available — still return frame patterns

            java.util.LinkedHashSet<String> texNames = new java.util.LinkedHashSet<>();
            StringBuilder mats = new StringBuilder("[");
            boolean first = true;
            for (TexturePatternAnimationSet.MaterialPattern mp : anim.getMaterials())
            {
                if (!first) mats.append(',');
                first = false;
                mats.append("{\"name\":").append(jstr(mp.getName())).append(",\"frames\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) mats.append(',');
                    String tn = mp.at(f).getTexture();
                    texNames.add(tn);
                    mats.append(jstr(tn));
                }
                mats.append("]}");
            }
            mats.append(']');

            StringBuilder texs = new StringBuilder("{");
            boolean tf = true;
            for (String tn : texNames)
            {
                String dataUrl;
                try { dataUrl = pngDataUrl(tex.getImage(tn)); }
                catch (Throwable e) { continue; }
                if (!tf) texs.append(',');
                tf = false;
                texs.append(jstr(tn)).append(':').append(jstr(dataUrl));
            }
            texs.append('}');

            return "{\"frameCount\":" + fc + ",\"materials\":" + mats + ",\"textures\":" + texs + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String renderParticles(int romHandle, int container, int id, int width, int height, int frameCount)
    {
        try
        {
            ParticleSet set = new ParticleSet(resolve(rom(romHandle), container, id));
            java.util.List<BufferedImage> frames = new ParticleRenderer(width, height).render(set, frameCount);
            StringBuilder sb = new StringBuilder("{\"emitterCount\":").append(set.getEmitterCount())
                    .append(",\"frames\":[");
            for (int i = 0; i < frames.size(); i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(pngDataUrl(frames.get(i))));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- resolution helpers ------------------------------------------------------------------

    private NintendoDsRom rom(int handle)
    {
        NintendoDsRom rom = roms.get(handle);
        if (rom == null) throw new IllegalArgumentException("no ROM for handle " + handle);
        return rom;
    }

    private Narc narc(int handle)
    {
        Narc narc = narcs.get(handle);
        if (narc == null) throw new IllegalArgumentException("no NARC for handle " + handle);
        return narc;
    }

    /** Raw (as-stored) bytes for a (container,id): container &lt; 0 =&gt; ROM file, else NARC entry. */
    private byte[] resolveRaw(NintendoDsRom rom, int container, int id)
    {
        return container < 0 ? rom.getFile(id) : narc(container).getFile(id);
    }

    /** Resolved bytes, LZ-decompressed if needed — the form the format parsers expect. */
    private byte[] resolve(NintendoDsRom rom, int container, int id)
    {
        return maybeDecompress(resolveRaw(rom, container, id));
    }

    /**
     * Decompress {@code raw} if it looks LZ-compressed, but fall back to the raw bytes if decompression
     * fails: {@link NitroLz#isCompressed} is a header-nibble heuristic that false-positives on some
     * uncompressed files (e.g. sub-files of Platinum's area_build.narc), where decompress would
     * otherwise throw an ArrayIndexOutOfBoundsException from a bogus back-reference.
     */
    private static byte[] maybeDecompress(byte[] raw)
    {
        if (!NitroLz.isCompressed(raw))
            return raw;
        try
        {
            return NitroLz.decompress(raw);
        }
        catch (Throwable t)
        {
            return raw;
        }
    }

    /** 0 tilesWidth/bitDepth => Nds4j reads the geometry from the NCGR header. */
    private IndexedImage ncgr(NintendoDsRom rom, int container, int id, int tilesWidth)
    {
        return ncgr(rom, container, id, tilesWidth, true);
    }

    /**
     * As {@link #ncgr(NintendoDsRom, int, int, int)}, but with an explicit scan direction. Only matters for
     * scanned (bitmap) NCGRs: Pt/HG/SS scan front-to-back, Diamond/Pearl back-to-front — decoding a D/P
     * scanned sprite front-to-back yields garbled static. The game DB supplies the direction per NARC.
     */
    private IndexedImage ncgr(NintendoDsRom rom, int container, int id, int tilesWidth, boolean scanFrontToBack)
    {
        return new IndexedImage(resolve(rom, container, id), tilesWidth, 0, 1, 1, scanFrontToBack);
    }

    // --- encoding helpers --------------------------------------------------------------------

    private static String imageJson(BufferedImage img)
    {
        return imageJson(img, 1);
    }

    private static String imageJson(BufferedImage img, int subPalettes)
    {
        return "{\"width\":" + img.getWidth() + ",\"height\":" + img.getHeight()
                + ",\"subPalettes\":" + subPalettes
                + ",\"png\":" + jstr(pngDataUrl(img)) + "}";
    }

    /**
     * Render a scanned (bitmap) NCGR directly — its pixels already ARE the assembled sprite, so an NCER
     * can't be (and needn't be) composed over it. The {@code "scanned":true} flag lets the UI note that
     * the composed cell/animation view was replaced by the raw bitmap.
     */
    private static String scannedNcgrJson(IndexedImage ncgr, boolean transparent)
    {
        BufferedImage img = transparent ? ncgr.getTransparentImage() : ncgr.getImage();
        return "{\"width\":" + img.getWidth() + ",\"height\":" + img.getHeight()
                + ",\"subPalettes\":1,\"scanned\":true,\"png\":" + jstr(pngDataUrl(img)) + "}";
    }

    private static String pngDataUrl(BufferedImage img)
    {
        try
        {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + base64(baos.toByteArray());
        }
        catch (Exception e)
        {
            throw new RuntimeException("PNG encode failed: " + e.getMessage(), e);
        }
    }

    private static String base64(byte[] b)
    {
        return Base64.getEncoder().encodeToString(b);
    }

    private static String hex(Color c)
    {
        return String.format("#%02x%02x%02x", c.getRed(), c.getGreen(), c.getBlue());
    }

    private static String magic(byte[] d)
    {
        return d == null || d.length < 4 ? "" : new String(d, 0, 4, StandardCharsets.ISO_8859_1);
    }

    /** Friendly format name from the 4-char stamp (stamps are byte-reversed on disk). */
    private static String formatOf(byte[] d)
    {
        switch (magic(d))
        {
            case "NARC": return "NARC";
            case "RGCN": return "NCGR";
            case "RLCN": case "RPCN": return "NCLR";
            case "RCSN": return "NSCR";
            case "RECN": return "NCER";
            case "RNAN": return "NANR";
            case "BMD0": return "NSBMD";
            case "BTX0": return "NSBTX";
            case "BCA0": return "NSBCA";
            case "BTP0": return "NSBTP";
            case "BTA0": return "NSBTA";
            case "BVA0": return "NSBVA";
            case "BMA0": return "NSBMA";
            case " APS": return "SPA";
            default: return "";
        }
    }

    private static String describe(Throwable t)
    {
        String msg = t.getMessage();
        return t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg);
    }

    private static String err(Throwable t)
    {
        return "{\"error\":" + jstr(describe(t)) + "}";
    }

    /** Encode a Java string as a JSON string literal (quotes + minimal escaping). null -&gt; "null". */
    private static String jstr(String s)
    {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++)
        {
            char c = s.charAt(i);
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
        return sb.append('"').toString();
    }
}
