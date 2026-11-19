/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/** Header fields SpriteFacts appends for pairing. */
@DisplayName("SpriteFacts")
class SpriteFactsTest
{
    /**
     * Empty and non-graphic files add nothing.
     */
    @Test
    void skipsMissingAndUnknown()
    {
        assertThat(json(null)).isEmpty();
        assertThat(json(new byte[8])).isEmpty();
        byte[] text = new byte[32];
        stamp(text, 0, "TEXT");
        assertThat(json(text)).isEmpty();
    }

    /**
     * A 4bpp tileset reports depth 3 and its tile-data size.
     */
    @Test
    void ncgrFields()
    {
        byte[] data = new byte[0x30];
        stamp(data, 0, "RGCN");
        stamp(data, 0x10, "RAHC");
        put32(data, 0x1C, 3);
        put32(data, 0x28, 64);

        assertThat(json(data)).isEqualTo(",\"depth\":3,\"tileBytes\":64");
    }

    /**
     * A depth other than 3 or 4 is left off.
     */
    @Test
    void ncgrIgnoresOtherDepths()
    {
        byte[] data = new byte[0x30];
        stamp(data, 0, "RGCN");
        stamp(data, 0x10, "RAHC");
        put32(data, 0x1C, 7);
        put32(data, 0x28, 32);

        assertThat(json(data)).isEqualTo(",\"tileBytes\":32");
    }

    /**
     * Palette color count is half the TTLP size field.
     */
    @Test
    void nclrColors()
    {
        byte[] rlcn = palette("RLCN", 0x200);
        byte[] rpcn = palette("RPCN", 0x20);

        assertThat(json(rlcn)).isEqualTo(",\"colors\":256");
        assertThat(json(rpcn)).isEqualTo(",\"colors\":16");
    }

    /**
     * An odd palette size is not a color count.
     */
    @Test
    void nclrSkipsOddSize()
    {
        assertThat(json(palette("RLCN", 3))).isEmpty();
    }

    /**
     * Each legal OBJ shape and size is reported in tiles, and a second OBJ is comma-separated.
     */
    @Test
    void ncerShapes()
    {
        expectBox(0, 0, 0, 1, 1);
        expectBox(0, 1, 0, 2, 2);
        expectBox(0, 2, 0, 4, 4);
        expectBox(0, 3, 0, 8, 8);
        expectBox(1, 0, 0, 2, 1);
        expectBox(1, 1, 0, 4, 1);
        expectBox(1, 2, 0, 4, 2);
        expectBox(1, 3, 0, 8, 4);
        expectBox(2, 0, 0, 1, 2);
        expectBox(2, 1, 0, 1, 4);
        expectBox(2, 2, 0, 2, 4);
        expectBox(2, 3, 0, 4, 8);
    }

    /**
     * A disabled OBJ is omitted and a shown one stays.
     */
    @Test
    void ncerSkipsDisabled()
    {
        String listed = json(ncer(0, 0x02, 0, 0, 0x00, 0, 3));

        assertThat(listed).contains("\"tile\":3");
        assertThat(listed).doesNotContain("\"tile\":0,");
    }

    /**
     * An affine OBJ is kept even when the disable bit is set.
     */
    @Test
    void ncerKeepsAffine()
    {
        String listed = json(ncer(0, 0x03, 0, 1, 0, 0, 0));

        assertThat(listed).contains("\"tile\":1");
    }

    /**
     * 256-color mode is the attribute bit, not a guess.
     */
    @Test
    void ncerColors()
    {
        String listed = json(ncer(0, 0x20, 0, 2, 0, 0, 0));

        assertThat(listed).contains("\"colors\":256");
    }

    /**
     * A prohibited shape, a partition, or a boundary above 3 drops the bank.
     */
    @Test
    void ncerSkipsUnreadable()
    {
        assertThat(json(ncer(0, 0xC0, 0, 0, 0, 0, 0))).isEmpty();
        byte[] parted = ncer(0, 0x00, 0, 0, 0, 0, 0);
        put32(parted, 0x24, 8);
        assertThat(json(parted)).isEmpty();
        byte[] shift = ncer(0, 0x00, 0, 0, 0, 0, 0);
        put32(shift, 0x20, 4);
        assertThat(json(shift)).isEmpty();
    }

    /**
     * A 16-byte cell descriptor still reaches its OBJ.
     */
    @Test
    void ncerExtendedCell()
    {
        String listed = json(ncer(1, 0x00, 0, 6, 0, 0, 0));

        assertThat(listed).contains("\"boundary\":0").contains("\"tile\":6");
    }

    /**
     * The highest 10-bit tile number in the map is kept.
     */
    @Test
    void nscrMaxTile()
    {
        byte[] data = new byte[0x28];
        stamp(data, 0, "RCSN");
        stamp(data, 0x10, "NRCS");
        put32(data, 0x20, 4);
        put16(data, 0x24, 1);
        put16(data, 0x26, 0xFC09);

        assertThat(json(data)).isEqualTo(",\"maxTile\":9");
    }

    /**
     * A screen whose declared data runs past the file is skipped.
     */
    @Test
    void nscrSkipsTruncated()
    {
        byte[] data = new byte[0x24];
        stamp(data, 0, "RCSN");
        stamp(data, 0x10, "NRCS");
        put32(data, 0x20, 4);

        assertThat(json(data)).isEmpty();
    }

    /**
     * Checks one shape and size against the listing.
     * @param shape OBJ shape
     * @param size OBJ size
     * @param tile tile number
     * @param wide expected width in tiles
     * @param high expected height in tiles
     */
    private static void expectBox(int shape, int size, int tile, int wide, int high)
    {
        int attr0 = shape << 6;
        int attr1 = size << 14;
        String listed = json(ncer(0, attr0, attr1, tile, attr0, attr1, tile + 1));

        assertThat(listed).contains("\"tile\":" + tile + ",\"wide\":" + wide + ",\"high\":" + high);
        assertThat(listed).contains("\"tile\":" + (tile + 1) + ",\"wide\":" + wide + ",\"high\":" + high);
    }

    /**
     * Fields appended for these bytes.
     * @param data file bytes
     * @return the JSON fragment
     */
    private static String json(byte[] data)
    {
        StringBuilder out = new StringBuilder();
        SpriteFacts.append(out, data);
        return out.toString();
    }

    /**
     * An NCLR or NCPR with the given palette size.
     * @param magic file stamp
     * @param size palette data size in bytes
     * @return file bytes
     */
    private static byte[] palette(String magic, int size)
    {
        byte[] data = new byte[0x28];
        stamp(data, 0, magic);
        stamp(data, 0x10, "TTLP");
        put32(data, 0x20, size);
        return data;
    }

    /**
     * An NCER with one cell and two OBJs.
     * @param bank cell-descriptor kind
     * @param attr0 first attribute-0 high byte
     * @param attr1 first attribute 1
     * @param tile first tile number
     * @param attr0b second attribute-0 high byte
     * @param attr1b second attribute 1
     * @param tileb second tile number
     * @return file bytes
     */
    private static byte[] ncer(int bank, int attr0, int attr1, int tile, int attr0b, int attr1b, int tileb)
    {
        byte[] data = new byte[0x60];
        stamp(data, 0, "RECN");
        stamp(data, 0x10, "KBEC");
        put16(data, 0x18, 1);
        put16(data, 0x1A, bank);
        int desc = bank == 1 ? 16 : 8;
        put16(data, 0x30, 2);
        int oam = 0x30 + desc;
        putObj(data, oam, attr0, attr1, tile);
        putObj(data, oam + 6, attr0b, attr1b, tileb);
        return data;
    }

    /**
     * Writes one 6-byte OBJ.
     * @param data file bytes
     * @param at offset
     * @param attr0 attribute-0 high byte
     * @param attr1 attribute 1
     * @param tile tile number
     */
    private static void putObj(byte[] data, int at, int attr0, int attr1, int tile)
    {
        data[at + 1] = (byte) attr0;
        put16(data, at + 2, attr1);
        put16(data, at + 4, tile);
    }

    /**
     * Writes a four-character stamp.
     * @param data file bytes
     * @param at offset
     * @param text stamp
     */
    private static void stamp(byte[] data, int at, String text)
    {
        byte[] raw = text.getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(raw, 0, data, at, 4);
    }

    /**
     * Writes a little-endian 16-bit value.
     * @param data file bytes
     * @param at offset
     * @param value value
     */
    private static void put16(byte[] data, int at, int value)
    {
        data[at] = (byte) value;
        data[at + 1] = (byte) (value >> 8);
    }

    /**
     * Writes a little-endian 32-bit value.
     * @param data file bytes
     * @param at offset
     * @param value value
     */
    private static void put32(byte[] data, int at, int value)
    {
        put16(data, at, value);
        put16(data, at + 2, value >> 16);
    }
}
