/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.Narc;
import io.github.turtleisaac.nds4j.NintendoDsRom;
import io.github.turtleisaac.nds4j.framework.NitroLz;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;
import io.github.turtleisaac.nds4j.images.Screen;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
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

        String img = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0, true);
        assertThat(img).contains("data:image/png;base64,");
        assertThat(intField(img, "width")).isGreaterThan(0);
        assertThat(intField(img, "height")).isGreaterThan(0);
        assertThat(intField(img, "subPalettes")).isGreaterThanOrEqualTo(1);

        String pal = svc.decodePalette(rom, narc, nclr);
        assertThat(intField(pal, "count")).isGreaterThan(0);
        assertThat(pal).contains("\"#");
    }

    @Test
    @DisplayName("paletteIndex selects a different 16-color sub-palette for 4bpp graphics")
    void subPaletteChangesPixels()
    {
        int[] sp = findMultiPaletteNcgr();
        Assumptions.assumeTrue(sp != null, "no 4bpp NCGR with multiple sub-palettes found");
        int narc = sp[0], ncgr = sp[1], nclr = sp[2];

        String a = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0, true);
        String b = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 1, true);
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
    @DisplayName("importRaw over a NARC sub-file survives saveRom + reopen; siblings unchanged")
    void narcImportRoundTrip()
    {
        // Discover stable file identities using the shared read-only facade; mutate a private one so
        // the shared ROM other tests decode from is never touched (JUnit method order is arbitrary).
        int[] found = firstNarcWithTwoFiles();
        Assumptions.assumeTrue(found != null, "no NARC with >= 2 sub-files found");
        int romFileId = found[0], target = found[2], sibling = found[3];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, romFileId), "narcHandle");

        // Snapshot an untouched sibling so we can prove no collateral damage.
        String siblingBefore = strField(s1.exportRaw(r1, narc1, sibling), "base64");

        byte[] payload = "NITROVIEWER-IMPORT-TEST-PAYLOAD".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        assertThat(s1.importRaw(r1, narc1, target, payload)).contains("\"ok\":true");

        byte[] saved = s1.saveRom(r1);
        assertThat(saved.length).as("saveRom produced a non-empty ROM").isGreaterThan(0);

        // Re-open the freshly-saved ROM image in a clean facade and read the edited NARC back.
        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        int narc2 = intField(s2.openNarc(r2, romFileId), "narcHandle");

        String reread = strField(s2.exportRaw(r2, narc2, target), "base64");
        assertThat(java.util.Base64.getDecoder().decode(reread)).isEqualTo(payload);

        String siblingAfter = strField(s2.exportRaw(r2, narc2, sibling), "base64");
        assertThat(siblingAfter).as("untouched sibling unchanged").isEqualTo(siblingBefore);
    }

    @Test
    @DisplayName("importPng (match) recolors an NCGR, propagates to bytes, survives saveRom + reopen")
    void importPngMatchRoundTrip() throws Exception
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        int romFileId = g[0], ncgr = g[2], nclr = g[3];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, romFileId), "narcHandle");

        String dec = s1.decodeNcgr(r1, narc1, ncgr, narc1, nclr, 0, false, 0, true);
        int w = intField(dec, "width"), h = intField(dec, "height");
        byte[] ncgrBefore = java.util.Base64.getDecoder().decode(strField(s1.exportRaw(r1, narc1, ncgr), "base64"));

        // Paint a checkerboard of two DISTINCT existing palette colors → exact matches (unmatched 0),
        // and guaranteed to differ from whatever the sprite held (unless it was already that pattern).
        String palJson = s1.decodePalette(r1, narc1, nclr);
        String[] two = twoDistinctHex(palJson);
        Assumptions.assumeTrue(two != null, "palette has fewer than 2 distinct colors");
        byte[] png = checkerPng(w, h, hexColor(two[0]), hexColor(two[1]));

        String dry = s1.importPng(r1, narc1, ncgr, narc1, nclr, 0, 0, false, true, png);
        assertThat(dry).contains("\"ok\":true");
        assertThat(intField(dry, "unmatched")).as("exact palette colors fit").isEqualTo(0);

        assertThat(s1.importPng(r1, narc1, ncgr, narc1, nclr, 0, 0, false, false, png)).contains("\"ok\":true");
        byte[] ncgrAfter = java.util.Base64.getDecoder().decode(strField(s1.exportRaw(r1, narc1, ncgr), "base64"));
        assertThat(ncgrAfter).as("import changed the NCGR bytes").isNotEqualTo(ncgrBefore);

        byte[] saved = s1.saveRom(r1);
        assertThat(saved.length).isGreaterThan(0);

        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        int narc2 = intField(s2.openNarc(r2, romFileId), "narcHandle");
        assertThat(intField(s2.decodeNcgr(r2, narc2, ncgr, narc2, nclr, 0, false, 0, true), "width")).isEqualTo(w);
        byte[] reread = java.util.Base64.getDecoder().decode(strField(s2.exportRaw(r2, narc2, ncgr), "base64"));
        assertThat(reread).as("edit persisted through save + reopen").isEqualTo(ncgrAfter);
    }

    @Test
    @DisplayName("importPng (rebuild) rewrites the NCLR sub-palette, survives saveRom + reopen")
    void importPngRebuildRoundTrip() throws Exception
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        int romFileId = g[0], ncgr = g[2], nclr = g[3];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, romFileId), "narcHandle");
        String palBefore = s1.decodePalette(r1, narc1, nclr);

        int w = intField(s1.decodeNcgr(r1, narc1, ncgr, narc1, nclr, 0, false, 0, true), "width");
        int h = intField(s1.decodeNcgr(r1, narc1, ncgr, narc1, nclr, 0, false, 0, true), "height");
        byte[] png = gradientPng(w, h); // many colors → forces a real median-cut

        assertThat(s1.importPng(r1, narc1, ncgr, narc1, nclr, 0, 0, true, false, png)).contains("\"paletteRebuilt\":true");

        byte[] saved = s1.saveRom(r1);
        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        int narc2 = intField(s2.openNarc(r2, romFileId), "narcHandle");
        String palAfter = s2.decodePalette(r2, narc2, nclr);
        assertThat(palAfter).as("rebuilt palette differs from original").isNotEqualTo(palBefore);
    }

    @Test
    @DisplayName("importPng rejects a size mismatch with a structured error")
    void importPngSizeMismatch() throws Exception
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, g[0]), "narcHandle");
        byte[] tiny = solidPng(8, 8, java.awt.Color.RED); // almost certainly the wrong size
        String res = s1.importPng(r1, narc1, g[2], narc1, g[3], 0, 0, false, false, tiny);
        // either it matched an 8x8 sprite (fine) or it reported a structured size error — never threw
        assertThat(res).contains("\"ok\":");
    }

    @Test
    @DisplayName("setPaletteColors edits one slot, preserves count, survives saveRom + reopen")
    void setPaletteColorsRoundTrip()
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        int romFileId = g[0], nclr = g[3];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, romFileId), "narcHandle");

        String palBefore = s1.decodePalette(r1, narc1, nclr);
        int count = intField(palBefore, "count");
        Assumptions.assumeTrue(count >= 1, "empty palette");

        // Pack the existing colors, then paint slot 0 magenta (snaps to BGR555 #f800f8).
        String[] hexes = allHex(palBefore);
        byte[] rgb = packRgb(hexes);
        rgb[0] = (byte) 0xFF;
        rgb[1] = 0;
        rgb[2] = (byte) 0xFF;

        String res = s1.setPaletteColors(r1, narc1, nclr, rgb);
        assertThat(res).contains("\"ok\":true");
        assertThat(intField(res, "colors")).isEqualTo(count);
        assertThat(intField(res, "changed")).isGreaterThanOrEqualTo(1);

        String palAfter = s1.decodePalette(r1, narc1, nclr);
        assertThat(intField(palAfter, "count")).isEqualTo(count);
        assertThat(firstHex(palAfter, 0).toLowerCase()).isEqualTo("#f800f8");

        byte[] saved = s1.saveRom(r1);
        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        int narc2 = intField(s2.openNarc(r2, romFileId), "narcHandle");
        assertThat(firstHex(s2.decodePalette(r2, narc2, nclr), 0).toLowerCase()).isEqualTo("#f800f8");
        assertThat(intField(s2.decodePalette(r2, narc2, nclr), "count")).isEqualTo(count);
    }

    @Test
    @DisplayName("setPaletteColors rejects a length mismatch with a structured error")
    void setPaletteColorsLengthMismatch()
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, g[0]), "narcHandle");
        String res = s1.setPaletteColors(r1, narc1, g[3], new byte[]{1, 2, 3});
        assertThat(res).contains("\"ok\":false").contains("\"error\":");
    }

    @Test
    @DisplayName("decodeNcgrIndexed + setNcgrPixels round-trips a pixel edit through saveRom")
    void setNcgrPixelsRoundTrip()
    {
        int[] g = findGraphicsNarcWithRomFile();
        Assumptions.assumeTrue(g != null, "no NCGR+NCLR NARC found");
        int romFileId = g[0], ncgr = g[2];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");
        int narc1 = intField(s1.openNarc(r1, romFileId), "narcHandle");

        String dec = s1.decodeNcgrIndexed(r1, narc1, ncgr, 0, true);
        int w = intField(dec, "width"), h = intField(dec, "height");
        int depth = intField(dec, "bitDepth");
        Assumptions.assumeTrue(w > 0 && h > 0, "empty sprite");
        byte[] before = java.util.Base64.getDecoder().decode(strField(dec, "pixels"));
        assertThat(before.length).isEqualTo(w * h);

        // Skip the scanned-image encryption word (first 4 4bpp / 2 8bpp pixels always read as 0).
        int max = (1 << depth) - 1;
        int flip = Math.min(before.length - 1, Math.max(8, before.length / 2));
        byte[] painted = java.util.Arrays.copyOf(before, before.length);
        painted[flip] = (byte) (((painted[flip] & 0xFF) ^ 1) & max);

        String write = s1.setNcgrPixels(r1, narc1, ncgr, 0, true, painted);
        assertThat(write).contains("\"ok\":true");
        assertThat(intField(write, "width")).isEqualTo(w);

        byte[] after = java.util.Base64.getDecoder().decode(
                strField(s1.decodeNcgrIndexed(r1, narc1, ncgr, 0, true), "pixels"));
        assertThat(after[flip] & 0xFF).as("edited pixel persisted").isEqualTo(painted[flip] & 0xFF);

        byte[] saved = s1.saveRom(r1);
        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        int narc2 = intField(s2.openNarc(r2, romFileId), "narcHandle");
        byte[] reread = java.util.Base64.getDecoder().decode(
                strField(s2.decodeNcgrIndexed(r2, narc2, ncgr, 0, true), "pixels"));
        assertThat(reread[flip] & 0xFF).as("edit persisted through save + reopen").isEqualTo(painted[flip] & 0xFF);
    }

    @Test
    @DisplayName("importRaw over a top-level ROM file survives saveRom + reopen")
    void romFileImportRoundTrip()
    {
        // Overwrite a NARC ROM file wholesale with a distinctive payload — round-trips the ROM's own
        // FAT/file table without needing a valid inner structure.
        int[] found = firstNarcWithTwoFiles();
        Assumptions.assumeTrue(found != null, "no NARC ROM file found");
        int romFileId = found[0];

        CheerpjFacade s1 = new CheerpjFacade();
        int r1 = intField(s1.openRom(romBytes), "handle");

        byte[] payload = new byte[4096];
        for (int i = 0; i < payload.length; i++) payload[i] = (byte) (i * 7 + 3);
        assertThat(s1.importRaw(r1, -1, romFileId, payload)).contains("\"ok\":true");

        byte[] saved = s1.saveRom(r1);
        assertThat(saved.length).isGreaterThan(0);

        CheerpjFacade s2 = new CheerpjFacade();
        int r2 = intField(s2.openRom(saved), "handle");
        String reread = strField(s2.exportRaw(r2, -1, romFileId), "base64");
        assertThat(java.util.Base64.getDecoder().decode(reread)).isEqualTo(payload);
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

        String gltf = svc.exportModelGltf(rom, container, id, 0, 0, -1, 0, -1);
        assertThat(gltf).doesNotStartWith("ERROR:");
        assertThat(gltf).contains("\"asset\"").contains("\"meshes\"").contains("\"accessors\"");
        // self-contained: geometry + textures inlined as data URIs
        assertThat(gltf).contains("data:");
    }

    @Test
    @DisplayName("a model paired with an NSBCA exports glTF with skeletal animations")
    void animatedModelExportsGltf()
    {
        int[] found = findAnimatableModel();
        Assumptions.assumeTrue(found != null, "no NARC with NSBMD (embedded textures) + NSBCA found");
        int narc = found[0], nsbmd = found[1], nsbca = found[2];

        String gltf = svc.exportModelGltf(rom, narc, nsbmd, 0, 0, -1, narc, nsbca);
        assertThat(gltf).doesNotStartWith("ERROR:");
        assertThat(gltf).contains("\"animations\"").contains("\"samplers\"").contains("\"channels\"");
    }

    @Test
    @DisplayName("an NSBTX decodes to named PNG textures")
    void textureSetDecodes()
    {
        int[] found = findTextureSet();
        Assumptions.assumeTrue(found != null, "no NSBTX found in ROM");
        String res = svc.decodeTextureSet(rom, found[0], found[1]);
        assertThat(res).doesNotContain("\"error\"").contains("\"textures\":[");
        assertThat(res).contains("data:image/png;base64,").contains("\"width\":").contains("\"name\":");
    }

    @Test
    @DisplayName("NSBMA / NSBVA / NSBTP tracks decode to per-frame data (Platinum)")
    void animationTracksDecode()
    {
        byte[] plat = TestRoms.require("Platinum.nds"); // skips if Platinum isn't present
        CheerpjFacade s = new CheerpjFacade();
        int r = intField(s.openRom(plat), "handle");
        java.util.Map<String, int[]> tracks = findTracks(s, r);

        int[] bma = tracks.get("NSBMA");
        Assumptions.assumeTrue(bma != null, "no NSBMA found in Platinum");
        String ma = s.getMaterialColorAnim(r, bma[0], bma[1], 0);
        assertThat(ma).doesNotContain("\"error\"").contains("\"frameCount\":").contains("\"diffuse\":").contains("\"alpha\":");

        int[] bva = tracks.get("NSBVA");
        if (bva != null)
        {
            String va = s.getVisibilityAnim(r, bva[0], bva[1], 0);
            assertThat(va).doesNotContain("\"error\"").contains("\"nodeCount\":").contains("\"visible\":");
        }

        int[] btp = tracks.get("NSBTP");
        if (btp != null)
        {
            String tp = s.getTexturePatternAnim(r, btp[0], btp[1], 0, -1, -1, -1, -1);
            assertThat(tp).doesNotContain("\"error\"").contains("\"frameCount\":").contains("\"materials\":");
        }
    }

    @Test
    @DisplayName("an SPA particle effect renders to frames (Platinum)")
    void particlesRender()
    {
        byte[] plat = TestRoms.require("Platinum.nds");
        CheerpjFacade s = new CheerpjFacade();
        int r = intField(s.openRom(plat), "handle");
        int[] spa = findFirst(s, r, "SPA");
        Assumptions.assumeTrue(spa != null, "no SPA found in Platinum");
        String res = s.renderParticles(r, spa[0], spa[1], 96, 96, 6);
        assertThat(res).doesNotContain("\"error\"").contains("\"frames\":[").contains("data:image/png;base64,");
    }

    @Test
    @DisplayName("a scanned (bitmap) NCGR viewed as an NCER renders directly instead of erroring (Platinum trbgra)")
    void scannedNcgrNcerFallback()
    {
        byte[] plat = TestRoms.require("Platinum.nds"); // skips if Platinum isn't present
        CheerpjFacade s = new CheerpjFacade();
        int r = intField(s.openRom(plat), "handle");
        int id = findFileByName(s, r, "trbgra.narc");
        Assumptions.assumeTrue(id >= 0, "trbgra.narc not found in Platinum");
        int nh = intField(s.openNarc(r, id), "narcHandle");

        // NCER #32 + scanned NCGR #19 + NCLR #11 used to throw "Can't use a scanned image with an NCER".
        String res = s.decodeNcer(r, nh, 32, nh, 19, nh, 11, 0, true);
        assertThat(res).doesNotContain("\"error\"");
        assertThat(res).contains("\"scanned\":true").contains("data:image/png");
        assertThat(intField(res, "width")).isGreaterThan(0);
    }

    @Test
    @DisplayName("a NARC whose sub-file trips the LZ heuristic (Platinum area_build.narc) still lists")
    void lzFalsePositiveNarcLists()
    {
        byte[] plat = TestRoms.require("Platinum.nds");
        CheerpjFacade s = new CheerpjFacade();
        int r = intField(s.openRom(plat), "handle");
        int id = findFileByName(s, r, "area_build.narc");
        Assumptions.assumeTrue(id >= 0, "area_build.narc not found in Platinum");
        String open = s.openNarc(r, id);
        assertThat(open).doesNotContain("\"error\"");
        String list = s.listNarc(intField(open, "narcHandle"));
        assertThat(list).doesNotContain("\"error\"").contains("\"files\":[");
    }

    private int findFileByName(CheerpjFacade s, int r, String name)
    {
        Matcher m = Pattern.compile("\\{\"name\":\"" + Pattern.quote(name) + "\",\"id\":(\\d+)\\}")
                .matcher(s.listTree(r));
        return m.find() ? Integer.parseInt(m.group(1)) : -1;
    }

    /** First file (loose or in a NARC) of the given format. */
    private int[] findFirst(CheerpjFacade s, int r, String fmt)
    {
        int n = intField(s.getRomInfo(r), "numFiles");
        for (int f = 0; f < n; f++)
        {
            String ff = formatField(s.detectFormat(r, -1, f));
            if (fmt.equals(ff))
                return new int[]{-1, f};
            if ("NARC".equals(ff))
            {
                String o = s.openNarc(r, f);
                if (o.contains("\"error\""))
                    continue;
                Integer i = firstIndexOfFormat(s.listNarc(intField(o, "narcHandle")), fmt);
                if (i != null)
                    return new int[]{intField(o, "narcHandle"), i};
            }
        }
        return null;
    }

    /** One pass over the ROM collecting the first NSBMA/NSBVA/NSBTP (loose or in a NARC). */
    private java.util.Map<String, int[]> findTracks(CheerpjFacade s, int r)
    {
        String[] want = {"NSBMA", "NSBVA", "NSBTP"};
        java.util.Map<String, int[]> out = new java.util.HashMap<>();
        int n = intField(s.getRomInfo(r), "numFiles");
        for (int f = 0; f < n && out.size() < want.length; f++)
        {
            String ff = formatField(s.detectFormat(r, -1, f));
            if ("NARC".equals(ff))
            {
                String o = s.openNarc(r, f);
                if (o.contains("\"error\""))
                    continue;
                int nh = intField(o, "narcHandle");
                String list = s.listNarc(nh);
                for (String w : want)
                    if (!out.containsKey(w))
                    {
                        Integer i = firstIndexOfFormat(list, w);
                        if (i != null) out.put(w, new int[]{nh, i});
                    }
            }
            else
            {
                for (String w : want)
                    if (w.equals(ff) && !out.containsKey(w))
                        out.put(w, new int[]{-1, f});
            }
        }
        return out;
    }

    // --- ROM scanning helpers -----------------------------------------------------------------

    /** First NSBTX (loose or in a NARC): {container, id} or null. */
    private int[] findTextureSet()
    {
        int numFiles = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < numFiles; f++)
        {
            String fmt = formatField(svc.detectFormat(rom, -1, f));
            if ("NSBTX".equals(fmt))
                return new int[]{-1, f};
            if ("NARC".equals(fmt))
            {
                String open = svc.openNarc(rom, f);
                if (open.contains("\"error\""))
                    continue;
                int narc = intField(open, "narcHandle");
                Integer t = firstIndexOfFormat(svc.listNarc(narc), "NSBTX");
                if (t != null)
                    return new int[]{narc, t};
            }
        }
        return null;
    }

    /** First NARC ROM file holding >= 2 sub-files: {romFileId, narcHandle, index0, index1} or null. */
    private int[] firstNarcWithTwoFiles()
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
            if (narcFileCount(narc) >= 2)
                return new int[]{f, narc, 0, 1};
        }
        return null;
    }

    private int narcFileCount(int narcHandle)
    {
        // count "index": occurrences in the listNarc JSON
        String list = svc.listNarc(narcHandle);
        int count = 0, i = 0;
        while ((i = list.indexOf("\"index\":", i)) >= 0) { count++; i += 8; }
        return count;
    }

    /** Like {@link #findGraphicsNarc()} but includes the ROM file id: {romFileId, narcHandle, ncgr, nclr}. */
    private int[] findGraphicsNarcWithRomFile()
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
                return new int[]{f, narc, ncgr, nclr};
        }
        return null;
    }

    /** Every "#rrggbb" color in a decodePalette JSON, in order. */
    private static String[] allHex(String palJson)
    {
        Matcher m = Pattern.compile("#[0-9a-fA-F]{6}").matcher(palJson);
        java.util.List<String> out = new java.util.ArrayList<>();
        while (m.find()) out.add(m.group());
        return out.toArray(new String[0]);
    }

    private static byte[] packRgb(String[] hexes)
    {
        byte[] rgb = new byte[hexes.length * 3];
        for (int i = 0; i < hexes.length; i++)
        {
            int v = Integer.parseInt(hexes[i].substring(1), 16);
            rgb[i * 3] = (byte) ((v >> 16) & 0xFF);
            rgb[i * 3 + 1] = (byte) ((v >> 8) & 0xFF);
            rgb[i * 3 + 2] = (byte) (v & 0xFF);
        }
        return rgb;
    }

    /** The {@code i}-th "#rrggbb" color in a decodePalette JSON. */
    private static String firstHex(String palJson, int i)
    {
        Matcher m = Pattern.compile("#[0-9a-fA-F]{6}").matcher(palJson);
        String last = "#000000";
        for (int k = 0; k <= i && m.find(); k++) last = m.group();
        return last;
    }

    private static java.awt.Color hexColor(String hex)
    {
        return new java.awt.Color(Integer.parseInt(hex.substring(1), 16));
    }

    /** The first two distinct "#rrggbb" colors in a decodePalette JSON, or null if fewer than two. */
    private static String[] twoDistinctHex(String palJson)
    {
        Matcher m = Pattern.compile("#[0-9a-fA-F]{6}").matcher(palJson);
        String first = null;
        while (m.find())
        {
            String c = m.group();
            if (first == null) first = c;
            else if (!c.equalsIgnoreCase(first)) return new String[]{first, c};
        }
        return null;
    }

    private static byte[] checkerPng(int w, int h, java.awt.Color a, java.awt.Color b) throws Exception
    {
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                img.setRGB(x, y, (((x / 4) + (y / 4)) % 2 == 0 ? a : b).getRGB());
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    private static byte[] solidPng(int w, int h, java.awt.Color c) throws Exception
    {
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) img.setRGB(x, y, c.getRGB());
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    private static byte[] gradientPng(int w, int h) throws Exception
    {
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                img.setRGB(x, y, new java.awt.Color((x * 255) / Math.max(1, w - 1), (y * 255) / Math.max(1, h - 1), 128).getRGB());
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

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

    /** First NARC NCGR whose paired NCLR yields more than one 16-color sub-palette. */
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
                String img = svc.decodeNcgr(rom, narc, ncgr, narc, nclr, 0, true, 0, true);
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

    /** First NARC holding an NSBMD (with embedded textures) AND an NSBCA: {narc, nsbmd, nsbca} or null. */
    private int[] findAnimatableModel()
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
            Integer nsbmd = firstIndexOfFormat(list, "NSBMD");
            Integer nsbca = firstIndexOfFormat(list, "NSBCA");
            if (nsbmd != null && nsbca != null
                    && svc.getModelSetInfo(rom, narc, nsbmd).contains("\"hasEmbeddedTextures\":true"))
                return new int[]{narc, nsbmd, nsbca};
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

    private static final String CUBE_OBJ =
            "v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\n" +
            "f 1 2 3\nf 1 3 4\nf 5 7 6\nf 5 8 7\nf 1 5 6\nf 1 6 2\n" +
            "f 2 6 7\nf 2 7 3\nf 3 7 8\nf 3 8 4\nf 4 8 5\nf 4 5 1\n";

    @Test
    @DisplayName("importObj re-encodes a Wavefront OBJ into a parsable NSBMD (write path)")
    void importObjRoundTrip()
    {
        // Replace a ROM file's bytes with the cube mesh, then read it back through the model parser.
        byte[] objBytes = CUBE_OBJ.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String res = svc.importObj(rom, -1, 200, objBytes);
        assertThat(res).contains("\"ok\":true");
        assertThat(intField(res, "triangles")).isEqualTo(12); // a cube = 12 triangles
        assertThat(intField(res, "vertices")).isEqualTo(8);   // ObjImporter dedups to 8 unique corners

        // The written bytes must parse as an NSBMD holding one model named "model".
        String info = svc.getModelSetInfo(rom, -1, 200);
        assertThat(info).contains("\"models\":[\"model\"]");

        // And it survives a full ROM save → reopen (the real edit-then-download flow).
        byte[] saved = svc.saveRom(rom);
        assertThat(saved.length).isGreaterThan(0);
        String reopen = svc.openRom(saved);
        int rom2 = intField(reopen, "handle");
        assertThat(svc.getModelSetInfo(rom2, -1, 200)).contains("\"models\":[\"model\"]");
    }

    @Test
    @DisplayName("importObjTextured builds a model with an embedded texture from a framed OBJ+image payload")
    void importObjTexturedRoundTrip() throws Exception
    {
        String obj = "v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\n"
                + "vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n"
                + "f 1/1 2/2 3/3 4/4\nf 6/1 5/2 8/3 7/4\nf 5/1 1/2 4/3 8/4\n"
                + "f 2/1 6/2 7/3 3/4\nf 4/1 3/2 7/3 8/4\nf 5/1 6/2 2/3 1/4\n";
        byte[] objBytes = obj.getBytes(java.nio.charset.StandardCharsets.UTF_8);

        BufferedImage tex = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB); // power-of-two
        for (int y = 0; y < 8; y++)
            for (int x = 0; x < 8; x++)
                tex.setRGB(x, y, new Color(x * 32, y * 32, 128).getRGB());
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(tex, "png", png);
        byte[] texBytes = png.toByteArray();

        // Frame: [u32 LE objLen][obj][texture]
        byte[] payload = new byte[4 + objBytes.length + texBytes.length];
        payload[0] = (byte) objBytes.length;
        payload[1] = (byte) (objBytes.length >> 8);
        payload[2] = (byte) (objBytes.length >> 16);
        payload[3] = (byte) (objBytes.length >> 24);
        System.arraycopy(objBytes, 0, payload, 4, objBytes.length);
        System.arraycopy(texBytes, 0, payload, 4 + objBytes.length, texBytes.length);

        String res = svc.importObjTextured(rom, -1, 210, payload);
        assertThat(res).contains("\"ok\":true").contains("\"textured\":true");
        assertThat(intField(res, "triangles")).isEqualTo(12); // 6 quads fan-triangulated
        assertThat(svc.getModelSetInfo(rom, -1, 210)).contains("\"hasEmbeddedTextures\":true");
    }

    @Test
    @DisplayName("importObj rejects empty/garbage input with a structured error")
    void importObjBad()
    {
        assertThat(svc.importObj(rom, -1, 200, new byte[0])).contains("\"ok\":false");
        assertThat(svc.importObj(rom, -1, 200, "not an obj".getBytes())).contains("\"ok\":false");
    }

    @Test
    @DisplayName("importScreenPng decomposes a background into NSCR+NCGR, survives save→reopen")
    void importScreenPngWritesTilemap() throws Exception
    {
        // Build a self-contained NSCR/NCGR/NCLR triple and stage it into a fresh ROM handle, so the test
        // doesn't depend on locating a matching trio in the game.
        int rom2 = intField(svc.openRom(romBytes), "handle");

        Color[] colors = new Color[16];
        for (int i = 0; i < 16; i++) colors[i] = new Color(i * 16, (i * 7) & 0xFF, 255 - i * 16);
        Palette pal = new Palette(colors);
        byte[] nclrBytes = pal.save();
        IndexedImage template = new IndexedImage(8, 8, 4, pal); // 4bpp, 1 tile per row
        Screen blank = new Screen(16, 16, 0);

        int nscrId = 100, ncgrId = 101, nclrId = 102;
        assertThat(svc.importRaw(rom2, -1, nscrId, blank.save())).contains("\"ok\":true");
        assertThat(svc.importRaw(rom2, -1, ncgrId, template.save())).contains("\"ok\":true");
        assertThat(svc.importRaw(rom2, -1, nclrId, nclrBytes)).contains("\"ok\":true");

        // Paint with the palette's POST-SAVE colors (DS palettes quantise to BGR555), so the match is exact.
        Color[] realColors = new Palette(nclrBytes, 0).getColors();
        BufferedImage bg = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < 16; y++)
            for (int x = 0; x < 16; x++)
                bg.setRGB(x, y, realColors[(x + y * 16) % 16].getRGB());
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(bg, "png", png);
        byte[] pngBytes = png.toByteArray();

        // Dry run: perfect fit, and it must NOT write (the NSCR bytes stay the blank we staged).
        String nscrBefore = strField(svc.exportRaw(rom2, -1, nscrId), "base64");
        String dry = svc.importScreenPng(rom2, -1, nscrId, -1, ncgrId, -1, nclrId, true, false, 0, true, pngBytes);
        assertThat(dry).contains("\"ok\":true").contains("\"unmatched\":0").contains("\"dryRun\":true");
        assertThat(strField(svc.exportRaw(rom2, -1, nscrId), "base64"))
                .as("dry run must not modify the NSCR")
                .isEqualTo(nscrBefore);

        // Real import (match mode): writes the tileset + tilemap.
        String res = svc.importScreenPng(rom2, -1, nscrId, -1, ncgrId, -1, nclrId, true, false, 0, false, pngBytes);
        assertThat(res).contains("\"ok\":true").contains("\"unmatched\":0");
        assertThat(intField(res, "uniqueTiles")).isGreaterThan(0);

        // Save the whole ROM, reopen, and decode the screen — it must still render at 16x16.
        byte[] saved = svc.saveRom(rom2);
        assertThat(saved.length).isGreaterThan(0);
        int rom3 = intField(svc.openRom(saved), "handle");
        String decoded = svc.decodeNscr(rom3, -1, nscrId, -1, ncgrId, -1, nclrId, false);
        assertThat(decoded).doesNotContain("\"error\"");
        assertThat(intField(decoded, "width")).isEqualTo(16);
        assertThat(intField(decoded, "height")).isEqualTo(16);
    }

    @Test
    @DisplayName("importScreenPng with rebuildPalette rewrites the NCLR too")
    void importScreenPngRebuildsPalette() throws Exception
    {
        int rom2 = intField(svc.openRom(romBytes), "handle");

        Color[] colors = new Color[16];
        for (int i = 0; i < 16; i++) colors[i] = Color.BLACK; // start all-black so a rebuild must change it
        Palette pal = new Palette(colors);
        IndexedImage template = new IndexedImage(8, 8, 4, pal);
        Screen blank = new Screen(16, 16, 0);

        int nscrId = 110, ncgrId = 111, nclrId = 112;
        svc.importRaw(rom2, -1, nscrId, blank.save());
        svc.importRaw(rom2, -1, ncgrId, template.save());
        svc.importRaw(rom2, -1, nclrId, pal.save());

        // A colorful background the all-black palette can't match — rebuild must synthesise a new NCLR.
        BufferedImage bg = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < 16; y++)
            for (int x = 0; x < 16; x++)
                bg.setRGB(x, y, new Color((x * 16) & 0xFF, (y * 16) & 0xFF, 128).getRGB());
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(bg, "png", png);

        String nclrBefore = strField(svc.exportRaw(rom2, -1, nclrId), "base64");
        String res = svc.importScreenPng(rom2, -1, nscrId, -1, ncgrId, -1, nclrId, true, true, 1, false, png.toByteArray());
        assertThat(res).contains("\"ok\":true").contains("\"paletteRebuilt\":true");
        assertThat(strField(svc.exportRaw(rom2, -1, nclrId), "base64"))
                .as("rebuild must rewrite the NCLR")
                .isNotEqualTo(nclrBefore);
    }

    @Test
    @DisplayName("importCellPng writes a rendered NCER cell back to the NCGR, reproducing it exactly")
    void importCellPngRoundTrip()
    {
        // Find a NARC with a coherent NCER+NCGR+NCLR bundle whose cell composes (non-scanned NCGR).
        NintendoDsRom probe = new NintendoDsRom(romBytes);
        int romFileId = -1, ncerI = -1, ncgrI = -1, nclrI = -1;
        outer:
        for (int f = 0; f < probe.getNumFiles(); f++)
        {
            byte[] file = probe.getFile(f);
            if (file.length < 4 || !new String(file, 0, 4, java.nio.charset.StandardCharsets.ISO_8859_1).equals("NARC"))
                continue;
            Narc narc;
            try { narc = new Narc(file); } catch (RuntimeException e) { continue; }
            int ce = -1, cg = -1, cl = -1;
            for (int i = 0; i < narc.getNumFiles(); i++)
            {
                byte[] sub = narc.getFile(i);
                String m = sub.length >= 4 ? new String(sub, 0, 4, java.nio.charset.StandardCharsets.ISO_8859_1) : "";
                if (m.equals("RECN") && ce < 0) ce = i;
                else if (m.equals("RGCN") && cg < 0) cg = i;
                else if (m.equals("RLCN") && cl < 0) cl = i;
            }
            if (ce >= 0 && cg >= 0 && cl >= 0) { romFileId = f; ncerI = ce; ncgrI = cg; nclrI = cl; break outer; }
        }
        Assumptions.assumeTrue(romFileId >= 0, "no NCER+NCGR+NCLR bundle found in the test ROM");

        int rom2 = intField(svc.openRom(romBytes), "handle");
        int narc = intField(svc.openNarc(rom2, romFileId), "narcHandle");
        int cells = intField(svc.decodeNcerMeta(rom2, narc, ncerI), "cellCount");
        Assumptions.assumeTrue(cells > 0, "NCER has no cells");

        // Render cell 0 (opaque), import it straight back, and re-render — it must be byte-identical PNG,
        // with a perfect palette fit. Skip scanned bundles (decodeNcer returns them as raw bitmaps).
        String dec = svc.decodeNcer(rom2, narc, ncerI, narc, ncgrI, narc, nclrI, 0, false);
        Assumptions.assumeFalse(dec.contains("\"scanned\":true"), "cell's NCGR is scanned; not composable");
        String pngBefore = strField(dec, "png");
        byte[] pngBytes = java.util.Base64.getDecoder().decode(pngBefore.substring(pngBefore.indexOf(',') + 1));

        String res = svc.importCellPng(rom2, narc, ncerI, narc, ncgrI, narc, nclrI, 0, false, false, pngBytes);
        assertThat(res).contains("\"ok\":true").contains("\"unmatched\":0");

        String pngAfter = strField(svc.decodeNcer(rom2, narc, ncerI, narc, ncgrI, narc, nclrI, 0, false), "png");
        assertThat(pngAfter).as("re-rendered cell is identical after the write-back").isEqualTo(pngBefore);

        // Rebuild mode: build a NEW palette from a transparent-render of the cell and write it back too.
        String pngT = strField(svc.decodeNcer(rom2, narc, ncerI, narc, ncgrI, narc, nclrI, 0, true), "png");
        byte[] pngTBytes = java.util.Base64.getDecoder().decode(pngT.substring(pngT.indexOf(',') + 1));
        String nclrBefore = strField(svc.exportRaw(rom2, narc, nclrI), "base64");
        String rb = svc.importCellPng(rom2, narc, ncerI, narc, ncgrI, narc, nclrI, 0, true, false, pngTBytes);
        assertThat(rb).contains("\"ok\":true").contains("\"paletteRebuilt\":true");
        assertThat(strField(svc.exportRaw(rom2, narc, nclrI), "base64"))
                .as("rebuild rewrites the NCLR").isNotEqualTo(nclrBefore);
    }

    @Test
    @DisplayName("exportNarcZip/importNarcZip round-trips a whole NARC's contents, through save→reopen")
    void narcZipRoundTrip() throws Exception
    {
        // Find a real NARC with a couple of files to exercise the folder export/import.
        NintendoDsRom probe = new NintendoDsRom(romBytes);
        int narcId = -1;
        for (int i = 0; i < probe.getNumFiles(); i++)
        {
            byte[] f = probe.getFile(i);
            if (f.length >= 4 && new String(f, 0, 4, java.nio.charset.StandardCharsets.ISO_8859_1).equals("NARC"))
            {
                try { if (new Narc(f).getNumFiles() >= 2) { narcId = i; break; } }
                catch (RuntimeException ignored) { }
            }
        }
        Assumptions.assumeTrue(narcId >= 0, "no multi-file NARC found in the test ROM");

        int rom2 = intField(svc.openRom(romBytes), "handle");
        List<byte[]> before = unzip(base64Field(svc.exportNarcZip(rom2, -1, narcId)));
        assertThat(before.size()).isGreaterThanOrEqualTo(2);

        // Re-import the exact zip; a re-export must yield byte-identical contents (content round-trip).
        String imp = svc.importNarcZip(rom2, -1, narcId, base64Field(svc.exportNarcZip(rom2, -1, narcId)));
        assertThat(imp).contains("\"ok\":true").contains("\"count\":" + before.size());
        List<byte[]> after = unzip(base64Field(svc.exportNarcZip(rom2, -1, narcId)));
        assertThat(after.size()).isEqualTo(before.size());
        for (int i = 0; i < before.size(); i++)
            assertThat(after.get(i)).as("sub-file #%d after round-trip", i).isEqualTo(before.get(i));

        // And the contents survive a whole-ROM save → reopen.
        int rom3 = intField(svc.openRom(svc.saveRom(rom2)), "handle");
        List<byte[]> saved = unzip(base64Field(svc.exportNarcZip(rom3, -1, narcId)));
        assertThat(saved.size()).isEqualTo(before.size());
        assertThat(saved.get(0)).isEqualTo(before.get(0));
    }

    @Test
    @DisplayName("SDAT is detected and lists sequences; a sequence has notes")
    void sdatListener()
    {
        int sdatId = findFormat("SDAT");
        Assumptions.assumeTrue(sdatId >= 0, "no SDAT in ROM");
        assertThat(formatField(svc.detectFormat(rom, -1, sdatId))).isEqualTo("SDAT");

        String info = svc.getSdatInfo(rom, -1, sdatId);
        assertThat(info).contains("\"sequences\":[").contains("\"waveArchives\":[");
        Matcher seq = Pattern.compile("\"sequences\":\\[\\{\"index\":(\\d+)").matcher(info);
        assertThat(seq.find()).as("at least one sequence").isTrue();
        int seqIndex = Integer.parseInt(seq.group(1));
        assertThat(intField(info, "bankId")).isGreaterThanOrEqualTo(0);

        String notes = svc.getSequenceNotes(rom, -1, sdatId, seqIndex);
        assertThat(notes).contains("\"notes\":[");
        assertThat(intField(notes, "ticks")).isGreaterThanOrEqualTo(0);
    }

    @Test
    @DisplayName("importWav over an SDAT wave rewrites the archive")
    void sdatImportWav()
    {
        int sdatId = findFormat("SDAT");
        Assumptions.assumeTrue(sdatId >= 0, "no SDAT in ROM");
        String info = svc.getSdatInfo(rom, -1, sdatId);
        Assumptions.assumeTrue(info.contains("\"waveCount\":"), "SDAT has no wave archives");

        int rom2 = intField(svc.openRom(romBytes), "handle");
        Matcher arcM = Pattern.compile("\"waveArchives\":\\[\\{\"index\":(\\d+)").matcher(info);
        Assumptions.assumeTrue(arcM.find(), "no wave archives");
        int arc = Integer.parseInt(arcM.group(1));
        String waves = svc.getWaveArchiveInfo(rom2, -1, sdatId, arc);
        Assumptions.assumeTrue(!waves.contains("\"error\""), "wave archive missing");
        Assumptions.assumeTrue(waves.contains("\"index\":"), "wave archive is empty");

        byte[] wav = io.github.turtleisaac.nds4j.sound.WavFile.mono16(new short[128], 16000);
        String res = svc.importWav(rom2, -1, sdatId, arc, 0, wav);
        assertThat(res).contains("\"ok\":true").contains("\"samples\":");
        assertThat(intField(res, "samples")).isGreaterThan(0);
    }

    private int findFormat(String fmt)
    {
        int n = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < n; f++)
            if (fmt.equals(formatField(svc.detectFormat(rom, -1, f))))
                return f;
        return -1;
    }

    /** Decode a facade result's base64 field to bytes. */
    private static byte[] base64Field(String json)
    {
        return java.util.Base64.getDecoder().decode(strField(json, "base64"));
    }

    /** Unpack a ZIP's entries (in stored order) to a list of byte[]. */
    private static List<byte[]> unzip(byte[] zip) throws Exception
    {
        List<byte[]> out = new ArrayList<>();
        java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip));
        java.util.zip.ZipEntry e;
        byte[] chunk = new byte[8192];
        while ((e = zis.getNextEntry()) != null)
        {
            if (e.isDirectory()) continue;
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            int r;
            while ((r = zis.read(chunk)) > 0) buf.write(chunk, 0, r);
            out.add(buf.toByteArray());
        }
        return out;
    }

    @Test
    @DisplayName("a compressed file stays compressed on write, but exports decompressed")
    void writePreservesCompression() throws Exception
    {
        int rom2 = intField(svc.openRom(romBytes), "handle");
        int fileId = 300;

        // Stage a compressed file into the slot (its bytes carry an LZ header).
        byte[] contentA = "the original decompressed contents of a compressed file".getBytes();
        byte[] compressedA = NitroLz.compress(contentA);
        assertThat(NitroLz.isCompressed(compressedA)).isTrue();
        assertThat(svc.importRaw(rom2, -1, fileId, compressedA)).contains("\"ok\":true");
        assertThat(svc.detectFormat(rom2, -1, fileId)).contains("\"compressed\":true");

        // Import NEW, decompressed content over it. It must be RE-COMPRESSED on write…
        byte[] contentB = "TEST edited replacement contents, clearly not a compressed stream".getBytes();
        assertThat(NitroLz.isCompressed(contentB)).isFalse();
        assertThat(svc.importRaw(rom2, -1, fileId, contentB)).contains("\"ok\":true");

        byte[] stored = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom2, -1, fileId), "base64"));
        assertThat(NitroLz.isCompressed(stored)).as("edited compressed file stays compressed on disk").isTrue();
        assertThat(NitroLz.decompress(stored)).as("…and decompresses to the new content").isEqualTo(contentB);

        // …and exportFile hands back the decompressed content, through a save→reopen.
        assertThat(base64Field(svc.exportFile(rom2, -1, fileId))).isEqualTo(contentB);
        int rom3 = intField(svc.openRom(svc.saveRom(rom2)), "handle");
        assertThat(base64Field(svc.exportFile(rom3, -1, fileId))).isEqualTo(contentB);
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
