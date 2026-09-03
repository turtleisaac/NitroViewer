/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BMG / NFTR / NMCR+NMAR facade coverage. Unlike {@link CheerpjFacadeTest} (which opportunistically
 * scans whatever ROM {@code -Drom.name} selects), these formats are rare enough that the default
 * HeartGold fixture doesn't carry any: BMG + NFTR are confirmed present in Phantom Hourglass, and
 * NMCR/NMAR in White2's {@code a/0/0/4} NARC (see the NitroViewer HANDOFF's format-scan notes), so
 * each test opens that specific ROM via {@link TestRoms#requireNamed} rather than the shared fixture.
 */
@DisplayName("CheerpjFacade text (BMG) / font (NFTR) / multi-cell (NMCR+NMAR)")
class CheerpjFacadeTextFontMultiCellTest
{
    @Test
    @DisplayName("BMG: decode lists real messages, escapes flagged; edit round-trips through saveRom")
    void bmgDecodeAndEdit()
    {
        byte[] romBytes = TestRoms.requireNamed("Legend of Zelda, The - Phantom Hourglass.nds");
        CheerpjFacade svc = new CheerpjFacade();
        int rom = intField(svc.openRom(romBytes), "handle");

        Integer bmgId = firstRomFileOfFormat(svc, rom, "BMG");
        Assumptions.assumeTrue(bmgId != null, "no top-level BMG file found");

        String decoded = svc.decodeBmg(rom, -1, bmgId);
        assertThat(decoded).doesNotContain("\"error\"");
        assertThat(intField(decoded, "count")).isGreaterThan(0);
        assertThat(decoded).contains("\"messages\":[");

        // Find a message index with actual (non-null) text to edit.
        Matcher m = Pattern.compile("\\{\"text\":\"((?:[^\"\\\\]|\\\\.)*)\",\"isNull\":false").matcher(decoded);
        Assumptions.assumeTrue(m.find(), "no non-null message found");
        int msgIndex = 0; // decodeBmg preserves INF1 order starting at 0; the first match is message 0's
        // text field only if it happens to be non-null -- walk to find which index actually matched.
        java.util.List<String> texts = new java.util.ArrayList<>();
        Matcher all = Pattern.compile("\"isNull\":(true|false)").matcher(decoded);
        while (all.find()) texts.add(all.group(1));
        for (int i = 0; i < texts.size(); i++)
        {
            if ("false".equals(texts.get(i))) { msgIndex = i; break; }
        }

        String edit = svc.setBmgMessage(rom, -1, bmgId, msgIndex, "NitroViewer test message".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(edit).contains("\"ok\":true");

        String redecoded = svc.decodeBmg(rom, -1, bmgId);
        assertThat(redecoded).contains("NitroViewer test message");

        byte[] saved = svc.saveRom(rom);
        assertThat(saved.length).isGreaterThan(0);

        CheerpjFacade svc2 = new CheerpjFacade();
        int rom2 = intField(svc2.openRom(saved), "handle");
        String reread = svc2.decodeBmg(rom2, -1, bmgId);
        assertThat(reread).as("edit persisted through saveRom + reopen").contains("NitroViewer test message");
    }

    @Test
    @DisplayName("BMG: escape sequences round-trip through the [type:hexdata] bracket syntax")
    void bmgEscapeRoundTrip()
    {
        byte[] romBytes = TestRoms.requireNamed("Legend of Zelda, The - Phantom Hourglass.nds");
        CheerpjFacade svc = new CheerpjFacade();
        int rom = intField(svc.openRom(romBytes), "handle");

        Integer bmgId = firstRomFileOfFormat(svc, rom, "BMG");
        Assumptions.assumeTrue(bmgId != null, "no top-level BMG file found");

        String decoded = svc.decodeBmg(rom, -1, bmgId);
        Matcher m = Pattern.compile("\\{\"text\":\"((?:[^\"\\\\]|\\\\.)*?)\",\"isNull\":false,\"hasEscapes\":true\\}").matcher(decoded);
        Assumptions.assumeTrue(m.find(), "no escape-bearing message found");
        int escIndex = indexOfNthMatch(decoded, m.start());
        String origText = unescapeJson(m.group(1));
        Assumptions.assumeTrue(origText.contains("["), "matched message unexpectedly has no bracket token");

        // Re-saving the EXACT unedited text must be byte-identical: the bracket syntax round-trips.
        byte[] rawBefore = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom, -1, bmgId), "base64"));
        assertThat(svc.setBmgMessage(rom, -1, bmgId, escIndex, origText.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .contains("\"ok\":true");
        byte[] rawAfter = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom, -1, bmgId), "base64"));
        assertThat(rawAfter).as("unedited resave of bracket-token text is byte-identical").isEqualTo(rawBefore);

        // Editing plain text elsewhere in the message must leave the escape token itself intact.
        Matcher tokenMatch = Pattern.compile("\\[\\d{1,3}:[0-9a-fA-F]*\\]").matcher(origText);
        assertThat(tokenMatch.find()).as("has at least one bracket token").isTrue();
        String token = tokenMatch.group();
        String edited = "EDITED PREFIX -- " + origText;
        assertThat(svc.setBmgMessage(rom, -1, bmgId, escIndex, edited.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .contains("\"ok\":true");
        String redecoded = svc.decodeBmg(rom, -1, bmgId);
        assertThat(redecoded).contains("EDITED PREFIX").contains(jsonEscape(token));
    }

    private static int indexOfNthMatch(String json, int charOffset)
    {
        // Count "isNull" occurrences before charOffset to get the message's ordinal (INF1 order).
        Matcher all = Pattern.compile("\"isNull\":(true|false)").matcher(json.substring(0, charOffset));
        int count = 0;
        while (all.find()) count++;
        return count;
    }

    private static String unescapeJson(String s)
    {
        return s.replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\");
    }

    private static String jsonEscape(String s)
    {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    @Test
    @DisplayName("NFTR: meta + glyph sheet + string render decode; glyph pixel edit round-trips")
    void nftrDecodeAndEdit()
    {
        byte[] romBytes = TestRoms.requireNamed("Legend of Zelda, The - Phantom Hourglass.nds");
        CheerpjFacade svc = new CheerpjFacade();
        int rom = intField(svc.openRom(romBytes), "handle");

        Integer nftrId = firstRomFileOfFormat(svc, rom, "NFTR");
        Assumptions.assumeTrue(nftrId != null, "no top-level NFTR file found");

        String meta = svc.decodeFontMeta(rom, -1, nftrId);
        assertThat(meta).doesNotContain("\"error\"");
        int numGlyphs = intField(meta, "numGlyphs");
        assertThat(numGlyphs).isGreaterThan(0);
        assertThat(intField(meta, "cellWidth")).isGreaterThan(0);
        assertThat(intField(meta, "cellHeight")).isGreaterThan(0);

        String sheet = svc.renderFontGlyphSheet(rom, -1, nftrId, 16, 2);
        assertThat(sheet).contains("data:image/png;base64,");

        String str = svc.renderFontString(rom, -1, nftrId, 2, "Hello".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(str).contains("data:image/png;base64,");
        assertThat(intField(str, "width")).isGreaterThan(0);

        // Round-trip glyph 0's own pixels back onto itself: bytes must be unchanged (documented
        // same-size, re-quantised invariant of NitroFont.GlyphData.setGlyphPixels).
        String before = svc.decodeFontGlyphPixels(rom, -1, nftrId, 0);
        assertThat(before).doesNotContain("\"error\"");
        byte[] beforeNftr = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom, -1, nftrId), "base64"));
        byte[] pixels = java.util.Base64.getDecoder().decode(strField(before, "pixels"));
        assertThat(svc.setFontGlyphPixels(rom, -1, nftrId, 0, pixels)).contains("\"ok\":true");
        byte[] afterNftr = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom, -1, nftrId), "base64"));
        assertThat(afterNftr).as("re-setting a glyph's own pixels round-trips byte-exact").isEqualTo(beforeNftr);

        // Now actually invert glyph 0's pixels and confirm the bytes DO change, and it survives saveRom.
        byte[] inverted = new byte[pixels.length];
        for (int i = 0; i < pixels.length; i++) inverted[i] = (byte) (255 - (pixels[i] & 0xFF));
        assertThat(svc.setFontGlyphPixels(rom, -1, nftrId, 0, inverted)).contains("\"ok\":true");
        byte[] editedNftr = java.util.Base64.getDecoder().decode(strField(svc.exportRaw(rom, -1, nftrId), "base64"));
        assertThat(editedNftr).as("inverting pixels changed the NFTR bytes").isNotEqualTo(afterNftr);

        byte[] saved = svc.saveRom(rom);
        CheerpjFacade svc2 = new CheerpjFacade();
        int rom2 = intField(svc2.openRom(saved), "handle");
        byte[] reread = java.util.Base64.getDecoder().decode(strField(svc2.exportRaw(rom2, -1, nftrId), "base64"));
        assertThat(reread).as("glyph edit persisted through saveRom + reopen").isEqualTo(editedNftr);
    }

    @Test
    @DisplayName("NMCR/NMAR: meta decode + full render through the NCER/NCGR/NCLR chain")
    void nmcrNmarDecode()
    {
        byte[] romBytes = TestRoms.requireNamed("White2.nds");
        CheerpjFacade svc = new CheerpjFacade();
        int rom = intField(svc.openRom(romBytes), "handle");

        // a/0/0/4 is the known fixture NARC (romFileId 351) carrying paired NCGR/NCER/NMCR/NMAR entries.
        String open = svc.openNarc(rom, 351);
        Assumptions.assumeTrue(!open.contains("\"error\""), "fixture NARC a/0/0/4 (romFileId 351) not openable");
        int narc = intField(open, "narcHandle");
        String list = svc.listNarc(narc);

        Integer nmcr = firstIndexOfFormat(list, "NMCR");
        Integer nmar = firstIndexOfFormat(list, "NMAR");
        Integer ncer = firstIndexOfFormat(list, "NCER");
        Integer ncgr = firstIndexOfFormat(list, "NCGR");
        Integer nclr = firstIndexOfFormat(list, "NCLR");
        Assumptions.assumeTrue(nmcr != null && nmar != null && ncer != null && ncgr != null && nclr != null,
                "fixture NARC is missing one of NMCR/NMAR/NCER/NCGR/NCLR");

        String nmcrMeta = svc.decodeNmcrMeta(rom, narc, nmcr);
        assertThat(nmcrMeta).doesNotContain("\"error\"");
        assertThat(intField(nmcrMeta, "multiCellCount")).isGreaterThan(0);

        String nmcrImg = svc.decodeNmcr(rom, narc, nmcr, narc, ncer, narc, ncgr, narc, nclr, 0, true);
        assertThat(nmcrImg).as("NMCR render").contains("data:image/png;base64,");
        assertThat(intField(nmcrImg, "width")).isGreaterThan(0);

        String nmarMeta = svc.decodeNmarMeta(rom, narc, nmar);
        assertThat(nmarMeta).doesNotContain("\"error\"");
        assertThat(nmarMeta).contains("\"animations\":[");

        String nmarImg = svc.decodeNmar(rom, narc, nmar, narc, nmcr, narc, ncer, narc, ncgr, narc, nclr, 0, 0, true);
        assertThat(nmarImg).as("NMAR render").contains("data:image/png;base64,");
        assertThat(intField(nmarImg, "width")).isGreaterThan(0);
    }

    // --- helpers (mirroring CheerpjFacadeTest's style) --------------------------------------------

    private static Integer firstRomFileOfFormat(CheerpjFacade svc, int rom, String format)
    {
        int numFiles = intField(svc.getRomInfo(rom), "numFiles");
        for (int f = 0; f < numFiles; f++)
        {
            String det = svc.detectFormat(rom, -1, f);
            if (format.equals(strField(det, "format")))
                return f;
        }
        return null;
    }

    private static Integer firstIndexOfFormat(String listNarcJson, String format)
    {
        Matcher m = Pattern.compile("\\{\"index\":(\\d+),\"size\":\\d+,\"format\":\"" + format + "\"\\}")
                .matcher(listNarcJson);
        return m.find() ? Integer.parseInt(m.group(1)) : null;
    }

    private static int intField(String json, String key)
    {
        Matcher m = Pattern.compile("\"" + key + "\":(-?\\d+)").matcher(json);
        assertThat(m.find()).as("integer field '%s' present in %s", key, json).isTrue();
        return Integer.parseInt(m.group(1));
    }

    private static String strField(String json, String key)
    {
        String needle = "\"" + key + "\":\"";
        int i = json.indexOf(needle);
        assertThat(i).as("string field '%s' present in %s", key, json).isGreaterThanOrEqualTo(0);
        int start = i + needle.length();
        int end = json.indexOf('"', start);
        return json.substring(start, end);
    }
}
