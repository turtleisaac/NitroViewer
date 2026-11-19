/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import java.nio.charset.StandardCharsets;

/**
 * Graphic header fields appended to a NARC listing so pairing can run without a second read.
 */
final class SpriteFacts
{
    /** Not instantiated. */
    private SpriteFacts()
    {
    }

    /** Width in tiles for OBJ shapes square, horizontal, and vertical. */
    private static final int[][] WIDTH = {
            { 1, 2, 4, 8 },
            { 2, 4, 4, 8 },
            { 1, 1, 2, 4 },
    };

    /** Height in tiles for OBJ shapes square, horizontal, and vertical. */
    private static final int[][] HEIGHT = {
            { 1, 2, 4, 8 },
            { 1, 1, 2, 4 },
            { 2, 4, 4, 8 },
    };

    /**
     * Appends the header fields this file can contribute.
     * @param out the listing object being built
     * @param data decompressed file bytes
     */
    static void append(StringBuilder out, byte[] data)
    {
        if (data == null || data.length < 16)
            return;
        if (magic(data, 0, "RGCN"))
            appendNcgr(out, data);
        if (magic(data, 0, "RLCN") || magic(data, 0, "RPCN"))
            appendNclr(out, data);
        if (magic(data, 0, "RECN"))
            appendNcer(out, data);
        if (magic(data, 0, "RCSN"))
            appendNscr(out, data);
    }

    /**
     * Tileset depth and tile-data size.
     * @see <a href="https://problemkaputt.de/gbatek-ds-files-2d-video.htm">GBATEK DS Files - 2D Video</a>
     */
    private static void appendNcgr(StringBuilder out, byte[] data)
    {
        if (!magic(data, 0x10, "RAHC"))
            return;
        field(out, "depth", depth(data));
        field(out, "tileBytes", tileBytes(data));
    }

    /**
     * Palette color count from the TTLP size field.
     * @see <a href="https://problemkaputt.de/gbatek-ds-files-2d-video.htm">GBATEK DS Files - 2D Video</a>
     */
    private static void appendNclr(StringBuilder out, byte[] data)
    {
        field(out, "colors", colors(data));
    }

    /**
     * Cell-bank boundary and enabled OBJs.
     * @see <a href="https://problemkaputt.de/gbatek-ds-files-2d-video.htm">GBATEK DS Files - 2D Video</a>
     */
    private static void appendNcer(StringBuilder out, byte[] data)
    {
        Integer shift = boundary(data);
        if (shift == null)
            return;
        String objects = objectsJson(data);
        if (objects == null)
            return;
        field(out, "boundary", Long.valueOf(shift.longValue()));
        raw(out, "objects", objects);
    }

    /**
     * Highest BG-map tile number.
     * @see <a href="https://problemkaputt.de/gbatek-lcd-vram-bg-screen-data-format-bg-map.htm">GBATEK LCD VRAM BG Screen Data Format</a>
     */
    private static void appendNscr(StringBuilder out, byte[] data)
    {
        field(out, "maxTile", maxTile(data));
    }

    /**
     * Color-depth code 3 or 4, or null.
     * @param data file bytes
     * @return the depth code
     */
    private static Long depth(byte[] data)
    {
        Long value = u32(data, 0x1C);
        if (value == null)
            return null;
        if (value.longValue() != 3 && value.longValue() != 4)
            return null;
        return value;
    }

    /**
     * Declared tile-data size, or null when it is not usable.
     * @param data file bytes
     * @return size in bytes
     */
    private static Long tileBytes(byte[] data)
    {
        Long value = u32(data, 0x28);
        if (value == null || value.longValue() > (64L * 1024L * 1024L))
            return null;
        return value;
    }

    /**
     * Colors implied by the palette size field, or null.
     * @param data file bytes
     * @return color count
     */
    private static Long colors(byte[] data)
    {
        if (!magic(data, 0x10, "TTLP"))
            return null;
        Long size = u32(data, 0x20);
        if (size == null || (size.longValue() % 2L) != 0L)
            return null;
        if (size.longValue() > (64L * 1024L))
            return null;
        return Long.valueOf(size.longValue() / 2L);
    }

    /**
     * 1D boundary shift when the NCER field is 0..3 and no partition is set.
     * @param data file bytes
     * @return the shift, or null
     * @see <a href="https://problemkaputt.de/gbatek-ds-video-objs.htm">GBATEK DS Video OBJs</a>
     */
    private static Integer boundary(byte[] data)
    {
        Long word = u32(data, 0x20);
        Long part = u32(data, 0x24);
        if (word == null || part == null)
            return null;
        if (part.longValue() != 0L)
            return null;
        if (word.longValue() > 3L)
            return null;
        return Integer.valueOf((int) word.longValue());
    }

    /**
     * JSON array of enabled OBJs, or null when the bank cannot be read.
     * @param data file bytes
     * @return a JSON array
     */
    private static String objectsJson(byte[] data)
    {
        if (!magic(data, 0x10, "KBEC"))
            return null;
        Integer cells = u16(data, 0x18);
        Integer kind = u16(data, 0x1A);
        if (cells == null || kind == null)
            return null;
        int desc = cellBytes(kind.intValue());
        if (desc == 0 || cells.intValue() < 0 || cells.intValue() > 1024)
            return null;
        return cellsJson(data, cells.intValue(), desc);
    }

    /**
     * Bytes in one cell descriptor.
     * @param kind bank type 0 or 1
     * @return 8, 16, or 0 when the type is unknown
     */
    private static int cellBytes(int kind)
    {
        if (kind == 0)
            return 8;
        if (kind == 1)
            return 16;
        return 0;
    }

    /**
     * JSON array for every cell, or null if any cell cannot be read.
     * @param data file bytes
     * @param cells cell count
     * @param desc descriptor size
     * @return a JSON array
     */
    private static String cellsJson(byte[] data, int cells, int desc)
    {
        int table = 0x30;
        if (table + (long) cells * desc > data.length)
            return null;
        StringBuilder out = new StringBuilder("[");
        int base = table + cells * desc;
        boolean any = false;
        for (int i = 0; i < cells; i++)
        {
            String chunk = cellJson(data, table + i * desc, base);
            if (chunk == null)
                return null;
            any = appendChunk(out, chunk, any);
        }
        return out.append(']').toString();
    }

    /**
     * Enabled OBJs of one cell, an empty string when none are shown, or null on a bad read.
     * @param data file bytes
     * @param at cell descriptor offset
     * @param oamBase start of the OBJ table
     * @return OBJ JSON, empty, or null
     */
    private static String cellJson(byte[] data, int at, int oamBase)
    {
        Integer count = u16(data, at);
        Long offset = u32(data, at + 4);
        if (count == null || offset == null)
            return null;
        if (count.intValue() < 0 || count.intValue() > 256)
            return null;
        long start = oamBase + offset.longValue();
        if (start > Integer.MAX_VALUE)
            return null;
        return oamsJson(data, (int) start, count.intValue());
    }

    /**
     * Enabled OBJs at one table position.
     * @param data file bytes
     * @param at first OBJ
     * @param count OBJ count
     * @return concatenated OBJ objects, or null
     */
    private static String oamsJson(byte[] data, int at, int count)
    {
        StringBuilder out = new StringBuilder();
        boolean any = false;
        for (int i = 0; i < count; i++)
        {
            String one = oamJson(data, at + i * 6);
            if (one == null)
                return null;
            any = appendChunk(out, one, any);
        }
        return out.toString();
    }

    /**
     * Appends one JSON object, inserting a comma when the builder already has one.
     * @param out destination
     * @param chunk object text, or empty to skip
     * @param any whether an object was already written
     * @return whether an object has been written
     */
    private static boolean appendChunk(StringBuilder out, String chunk, boolean any)
    {
        if (chunk.isEmpty())
            return any;
        if (any)
            out.append(',');
        out.append(chunk);
        return true;
    }

    /**
     * One shown OBJ, empty when it is disabled, or null when it cannot be read.
     * @param data file bytes
     * @param at OBJ offset
     * @return a JSON object, empty, or null
     * @see <a href="https://problemkaputt.de/gbatek-lcd-obj-oam-attributes.htm">GBATEK LCD OBJ - OAM Attributes</a>
     */
    private static String oamJson(byte[] data, int at)
    {
        if (at < 0 || at + 6 > data.length)
            return null;
        int attr0 = data[at + 1] & 0xFF;
        if (!shown(attr0))
            return "";
        int[] box = box(shape(attr0), size(data, at));
        if (box == null)
            return null;
        int tile = u16raw(data, at + 4) & 0x3FF;
        return "{\"tile\":" + tile + ",\"wide\":" + box[0] + ",\"high\":" + box[1] + ",\"colors\":" + colorsOf(attr0) + "}";
    }

    /**
     * True when the OBJ is not disabled.
     * @param attr0 high byte of attribute 0
     * @return whether the OBJ is shown
     */
    private static boolean shown(int attr0)
    {
        if ((attr0 & 1) == 1)
            return true;
        return (attr0 & 2) == 0;
    }

    /**
     * 16 or 256 colors from attribute 0.
     * @param attr0 high byte of attribute 0
     * @return 16 or 256
     */
    private static int colorsOf(int attr0)
    {
        if ((attr0 & 0x20) == 0)
            return 16;
        return 256;
    }

    /**
     * OBJ shape bits.
     * @param attr0 high byte of attribute 0
     * @return shape 0..3
     */
    private static int shape(int attr0)
    {
        return (attr0 >> 6) & 3;
    }

    /**
     * OBJ size bits.
     * @param data file bytes
     * @param at OBJ offset
     * @return size 0..3
     */
    private static int size(byte[] data, int at)
    {
        return (u16raw(data, at + 2) >> 14) & 3;
    }

    /**
     * Width and height in tiles for a legal shape and size.
     * @param shape OBJ shape
     * @param size OBJ size
     * @return {wide, high}, or null when the shape is prohibited
     * @see <a href="https://problemkaputt.de/gbatek-lcd-obj-oam-attributes.htm">GBATEK LCD OBJ - OAM Attributes</a>
     */
    private static int[] box(int shape, int size)
    {
        if (shape < 0 || shape > 2)
            return null;
        return new int[] { WIDTH[shape][size], HEIGHT[shape][size] };
    }

    /**
     * Highest tile number in the screen, or null when the map cannot be read.
     * @param data file bytes
     * @return the maximum tile number
     */
    private static Long maxTile(byte[] data)
    {
        if (!magic(data, 0x10, "NRCS"))
            return null;
        Long bytes = u32(data, 0x20);
        if (!screenBytes(data, bytes))
            return null;
        return Long.valueOf(highestTile(data, (int) bytes.longValue()));
    }

    /**
     * True when the screen-data length sits inside the file.
     * @param data file bytes
     * @param bytes declared data size
     * @return whether the map can be scanned
     */
    private static boolean screenBytes(byte[] data, Long bytes)
    {
        if (bytes == null || (bytes.longValue() % 2L) != 0L)
            return false;
        return 0x24L + bytes.longValue() <= data.length;
    }

    /**
     * Maximum of the low 10 bits of each map entry.
     * @param data file bytes
     * @param bytes map size in bytes
     * @return the highest tile number
     */
    private static int highestTile(byte[] data, int bytes)
    {
        int max = 0;
        int count = bytes / 2;
        for (int i = 0; i < count; i++)
        {
            int tile = u16raw(data, 0x24 + i * 2) & 0x3FF;
            if (tile > max)
                max = tile;
        }
        return max;
    }

    /**
     * Appends a numeric field when the value is present.
     * @param out destination
     * @param name field name
     * @param value field value, or null to skip
     */
    private static void field(StringBuilder out, String name, Long value)
    {
        if (value == null)
            return;
        out.append(",\"").append(name).append("\":").append(value.longValue());
    }

    /**
     * Appends a raw JSON field when the text is present.
     * @param out destination
     * @param name field name
     * @param json field value
     */
    private static void raw(StringBuilder out, String name, String json)
    {
        if (json == null)
            return;
        out.append(",\"").append(name).append("\":").append(json);
    }

    /**
     * True when four bytes at {@code at} match {@code text}.
     * @param data file bytes
     * @param at offset
     * @param text four-character stamp
     * @return whether the stamp matches
     */
    private static boolean magic(byte[] data, int at, String text)
    {
        if (at < 0 || at + 4 > data.length)
            return false;
        return text.equals(new String(data, at, 4, StandardCharsets.ISO_8859_1));
    }

    /**
     * Unsigned 16-bit value, or null past the end of the file.
     * @param data file bytes
     * @param at offset
     * @return the value, or null
     */
    private static Integer u16(byte[] data, int at)
    {
        if (at < 0 || at + 2 > data.length)
            return null;
        return Integer.valueOf(u16raw(data, at));
    }

    /**
     * Unsigned 16-bit value at an offset already known to be in range.
     * @param data file bytes
     * @param at offset
     * @return the value
     */
    private static int u16raw(byte[] data, int at)
    {
        return (data[at] & 0xFF) | ((data[at + 1] & 0xFF) << 8);
    }

    /**
     * Unsigned 32-bit value, or null past the end of the file.
     * @param data file bytes
     * @param at offset
     * @return the value, or null
     */
    private static Long u32(byte[] data, int at)
    {
        if (at < 0 || at + 4 > data.length)
            return null;
        long value = (data[at] & 0xFFL)
                | ((data[at + 1] & 0xFFL) << 8)
                | ((data[at + 2] & 0xFFL) << 16)
                | ((data[at + 3] & 0xFFL) << 24);
        return Long.valueOf(value);
    }
}
