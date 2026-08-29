/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Exercises the facade's JSON contract and 2D-decode paths against a real ROM (skipped if none is
 * provided; see {@link TestRoms}). These cover the pieces most likely to regress: the never-throw
 * error contract, tree/NARC listing, sub-palette selection, and pairing-driven decode.
 */
@DisplayName("CheerpjFacade contract + 2D decode")
class CheerpjFacadeTest
{
    private static byte[] romBytes;
    private static CheerpjFacade svc;
    private static int rom;

    @BeforeAll
    static void open()
    {
        romBytes = TestRoms.require("HeartGold.nds");
        svc = new CheerpjFacade();
        String res = svc.openRom(romBytes);
        assertThat(res).contains("\"ok\":true");
        rom = intField(res, "handle");
    }

    @Test
    @DisplayName("openRom reports the received byte length")
    void openRomOk()
    {
        String res = svc.openRom(romBytes);
        assertThat(res).contains("\"ok\":true");
        assertThat(intField(res, "len")).isEqualTo(romBytes.length);
    }

    @Test
    @DisplayName("openRom rejects garbage with a structured error, never an exception")
    void openRomBad()
    {
        String res = svc.openRom(new byte[64]);
        assertThat(res).contains("\"ok\":false").contains("\"error\":");
    }

    @Test
    @DisplayName("getRomInfo returns a 4-char game code and a file count")
    void romInfo()
    {
        String info = svc.getRomInfo(rom);
        assertThat(strField(info, "gameCode")).hasSize(4);
        assertThat(intField(info, "numFiles")).isGreaterThan(0);
    }

    @Test
    @DisplayName("listTree yields a nested filesystem JSON")
    void tree()
    {
        String t = svc.listTree(rom);
        assertThat(t).startsWith("{").contains("\"folders\":[").contains("\"files\":[");
    }

    @Test
    @DisplayName("a graphics NARC opens, lists typed entries, and decodes an NCGR + palette")
    void narcAndDecode()
    {
        int[] found = findGraphicsNarc();
        Assumptions.assumeTrue(found != null, "no NCGR+NCLR NARC found in ROM");
        int narc = found[0], ncgr = found[1], nclr = found[2];

        String img = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0);
        assertThat(img).contains("data:image/png;base64,");
        assertThat(intField(img, "width")).isGreaterThan(0);
        assertThat(intField(img, "height")).isGreaterThan(0);
        assertThat(intField(img, "subPalettes")).isGreaterThanOrEqualTo(1);

        String pal = svc.decodePalette(rom, narc, nclr);
        assertThat(intField(pal, "count")).isGreaterThan(0);
        assertThat(pal).contains("\"#");
    }

    @Test
    @DisplayName("paletteIndex selects a different 16-colour sub-palette for 4bpp graphics")
    void subPaletteChangesPixels()
    {
        int[] sp = findMultiPaletteNcgr();
        Assumptions.assumeTrue(sp != null, "no 4bpp NCGR with multiple sub-palettes found");
        int narc = sp[0], ncgr = sp[1], nclr = sp[2];

        String a = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0);
        String b = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 1);
        assertThat(intField(a, "subPalettes")).isGreaterThan(1);
        assertThat(strField(a, "png")).isNotEqualTo(strField(b, "png"));
    }

    @Test
    @DisplayName("exportRaw returns base64 of the stored bytes")
    void exportRaw()
    {
        String res = svc.exportRaw(rom, -1, 0);
        assertThat(intField(res, "size")).isGreaterThan(0);
        assertThat(strField(res, "base64")).isNotEmpty();
    }

    @Test
    @DisplayName("an NSBMD model exports to a self-contained glTF document")
    void modelExportsGltf()
    {
        int[] found = findTexturedModel();
        Assumptions.assumeTrue(found != null, "no NSBMD with embedded textures found in ROM");
        int container = found[0], id = found[1];

        String info = svc.getModelSetInfo(rom, container, id);
        assertThat(info).contains("\"hasEmbeddedTextures\":true").contains("\"models\":[");

        String gltf = svc.exportModelGltf(rom, container, id, 0, 0, -1);
        assertThat(gltf).doesNotStartWith("ERROR:");
        assertThat(gltf).contains("\"asset\"").contains("\"meshes\"").contains("\"accessors\"");
        // self-contained: geometry + textures inlined as data URIs
        assertThat(gltf).contains("data:");
    }

    // --- ROM scanning helpers -----------------------------------------------------------------

    /** First NARC that carries both an NCGR and an NCLR: {narcHandle, ncgrIndex, nclrIndex} or null. */
    private int[] findGraphicsNarc()
    {
        int numFiles = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < numFiles; f++)
        {
            if (!"NARC".equals(formatField(svc.detectFormat(rom, -1, f))))
                continue;
            String open = svc.openNarc(rom, f);
            if (open.contains("\"error\""))
                continue;
            int narc = intField(open, "narcHandle");
            String list = svc.listNarc(narc);
            Integer ncgr = firstIndexOfFormat(list, "NCGR");
            Integer nclr = firstIndexOfFormat(list, "NCLR");
            if (ncgr != null && nclr != null)
                return new int[]{narc, ncgr, nclr};
        }
        return null;
    }

    /** First NARC NCGR whose paired NCLR yields more than one 16-colour sub-palette. */
    private int[] findMultiPaletteNcgr()
    {
        int numFiles = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < numFiles; f++)
        {
            if (!"NARC".equals(formatField(svc.detectFormat(rom, -1, f))))
                continue;
            String open = svc.openNarc(rom, f);
            if (open.contains("\"error\""))
                continue;
            int narc = intField(open, "narcHandle");
            String list = svc.listNarc(narc);
            Integer nclr = firstIndexOfFormat(list, "NCLR");
            if (nclr == null)
                continue;
            for (int ncgr : indicesOfFormat(list, "NCGR"))
            {
                String img = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0);
                if (!img.contains("\"error\"") && intField(img, "subPalettes") > 1)
                    return new int[]{narc, ncgr, nclr};
            }
        }
        return null;
    }

    /** First NSBMD (loose or in a NARC) that carries embedded textures: {container, id} or null. */
    private int[] findTexturedModel()
    {
        int numFiles = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < numFiles; f++)
        {
            String fmt = formatField(svc.detectFormat(rom, -1, f));
            if ("NSBMD".equals(fmt))
            {
                if (svc.getModelSetInfo(rom, -1, f).contains("\"hasEmbeddedTextures\":true"))
                    return new int[]{-1, f};
            }
            else if ("NARC".equals(fmt))
            {
                String open = svc.openNarc(rom, f);
                if (open.contains("\"error\""))
                    continue;
                int narc = intField(open, "narcHandle");
                Integer nsbmd = firstIndexOfFormat(svc.listNarc(narc), "NSBMD");
                if (nsbmd != null
                        && svc.getModelSetInfo(rom, narc, nsbmd).contains("\"hasEmbeddedTextures\":true"))
                    return new int[]{narc, nsbmd};
            }
        }
        return null;
    }

    private static Integer firstIndexOfFormat(String listJson, String fmt)
    {
        List<Integer> l = indicesOfFormat(listJson, fmt);
        return l.isEmpty() ? null : l.get(0);
    }

    private static List<Integer> indicesOfFormat(String listJson, String fmt)
    {
        List<Integer> out = new ArrayList<>();
        Matcher m = Pattern.compile("\\{\"index\":(\\d+),\"size\":\\d+,\"format\":\"([^\"]*)\"\\}").matcher(listJson);
        while (m.find())
            if (m.group(2).equals(fmt))
                out.add(Integer.parseInt(m.group(1)));
        return out;
    }

    // --- tiny JSON field readers (avoids a JSON dependency in tests) --------------------------

    /** Non-asserting: the "format" value, or "" when absent (e.g. an {"error":...} result). */
    private static String formatField(String json)
    {
        Matcher m = Pattern.compile("\"format\":\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : "";
    }

    private static int intField(String json, String key)
    {
        Matcher m = Pattern.compile("\"" + key + "\":(-?\\d+)").matcher(json);
        assertThat(m.find()).as("integer field '%s' present", key).isTrue();
        return Integer.parseInt(m.group(1));
    }

    /**
     * Reads a string field via indexOf rather than a regex — the values here (base64 PNGs, titles,
     * game codes) contain no quotes or escapes, and a backtracking regex over a multi-KB base64
     * string overflows the stack.
     */
    private static String strField(String json, String key)
    {
        String needle = "\"" + key + "\":\"";
        int i = json.indexOf(needle);
        assertThat(i).as("string field '%s' present", key).isGreaterThanOrEqualTo(0);
        int start = i + needle.length();
        int end = json.indexOf('"', start);
        return json.substring(start, end);
    }
}
