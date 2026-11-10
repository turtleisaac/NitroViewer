/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.framework.MemBuf;

/**
 * Gen 4 (DPPt/HGSS) sprite pixel cipher. <p>
 * Reimplementation of the LCG XOR in DSPRE <code>SpriteScrambling</code> (AGPL-3.0, branch <code>feature/avalonia</code>).
 * Nds4j applies the XOR for a scanned NCGR. Which files, and which way, come from <code>gamedb.json</code>.
 */
public final class Gen4SpriteCipher
{
    public static final int MULTIPLIER = 0x41C64E6D; // 1103515245
    public static final int INCREMENT = 0x6073; // 24691


    /** Not instantiated. */
    private Gen4SpriteCipher()
    {
    }


    /**
     * Returns the scan direction <code>gamedb.json</code> declares for this entry
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path of the NARC
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> if this entry is not ciphered
     */
    public static Boolean frontToBack(String gameCode, String narcPath, int entryIndex)
    {
        if (entryIndex < 0)
            return null;
        return GameDb.frontToBack(gameCode, normalize(narcPath), entryIndex);
    }


    /**
     * Returns how many pixels the key word occupies
     * @param bitDepth an <code>int</code>, 4 or 8
     * @return 4 pixels at 4bpp, 2 at 8bpp
     */
    public static int seedPixelCount(int bitDepth)
    {
        return bitDepth == 8 ? 2 : 4;
    }


    /**
     * Checks whether a pixel is part of the key word. Front-to-back uses the first word, back-to-front the last.
     * @param x an <code>int</code> x in pixels
     * @param y an <code>int</code> y in pixels
     * @param width an <code>int</code> image width
     * @param height an <code>int</code> image height
     * @param bitDepth an <code>int</code>, 4 or 8
     * @param seedAtEnd a <code>boolean</code>, <code>true</code> when the key is the last word
     * @return <code>true</code> if this pixel is part of the key
     */
    public static boolean isSeedPixel(int x, int y, int width, int height, int bitDepth, boolean seedAtEnd)
    {
        if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height)
            return false;

        int n = seedPixelCount(bitDepth);
        int index = y * width + x;
        int total = width * height;
        if (seedAtEnd)
            return index >= total - n;
        return index < n;
    }


    /**
     * Undoes the cipher in place
     * @param fromEnd a <code>boolean</code>, <code>true</code> to walk backward from the last word
     */
    public static void unscramble(byte[] data, int offset, int size, boolean fromEnd)
    {
        apply(data, offset, size, fromEnd, -1);
    }


    /**
     * Applies the cipher in place. The key word's plaintext is forced to 0 first.
     * @param seed an <code>int</code> 16-bit key
     * @param fromEnd a <code>boolean</code>, <code>true</code> to walk backward from the last word
     */
    public static void scramble(byte[] data, int offset, int size, int seed, boolean fromEnd)
    {
        apply(data, offset, size, fromEnd, seed & 0xFFFF);
    }


    /**
     * Runs the cipher in place
     * @param fromEnd a <code>boolean</code>, <code>true</code> to walk backward from the last word
     * @param forcedSeed an <code>int</code> key, or <code>-1</code> to take the key from the data
     */
    private static void apply(byte[] data, int offset, int size, boolean fromEnd, int forcedSeed)
    {
        if (data == null)
            return;

        int words = size / 2;
        if (words <= 0 || offset < 0 || offset > data.length - words * 2)
            return;

        byte[] slice = new byte[words * 2];
        System.arraycopy(data, offset, slice, 0, slice.length);
        MemBuf buf = MemBuf.create(slice);
        MemBuf.MemBufReader reader = buf.reader();
        MemBuf.MemBufWriter writer = buf.writer();

        int keyIndex = fromEnd ? words - 1 : 0;
        if (forcedSeed >= 0)
            writeWord(writer, slice.length, keyIndex, 0);

        int key = forcedSeed >= 0 ? forcedSeed : readWord(reader, keyIndex);
        if (!fromEnd)
        {
            for (int i = 0; i < words; i++)
            {
                writeWord(writer, slice.length, i, readWord(reader, i) ^ (key & 0xFFFF));
                key = key * MULTIPLIER + INCREMENT;
            }
        }
        else
        {
            for (int i = words - 1; i >= 0; i--)
            {
                writeWord(writer, slice.length, i, readWord(reader, i) ^ (key & 0xFFFF));
                key = key * MULTIPLIER + INCREMENT;
            }
        }

        reader.setPosition(0);
        System.arraycopy(reader.getBuffer(), 0, data, offset, slice.length);
    }


    /**
     * Reads a little-endian word
     * @param word an <code>int</code> word index
     * @return the unsigned 16-bit value
     */
    private static int readWord(MemBuf.MemBufReader reader, int word)
    {
        reader.setPosition(word * 2);
        return reader.readUInt16();
    }


    /**
     * Writes a little-endian word. The write cursor is put back at <code>length</code> so the reader can still see the whole buffer.
     * @param length an <code>int</code> byte length of the buffer
     * @param word an <code>int</code> word index
     * @param value an <code>int</code> 16-bit value
     */
    private static void writeWord(MemBuf.MemBufWriter writer, int length, int word, int value)
    {
        writer.setPosition(word * 2);
        writer.writeShort((short) value);
        writer.setPosition(length);
    }


    /**
     * Normalises an FNT path for lookup
     * @param narcPath a <code>String</code> path
     * @return the path with a leading slash, lower-cased
     */
    static String normalize(String narcPath)
    {
        if (narcPath == null)
            return "";

        String path = narcPath.trim().replace('\\', '/').toLowerCase();
        while (path.contains("//"))
        {
            path = path.replace("//", "/");
        }

        if (path.endsWith("/") && path.length() > 1)
            path = path.substring(0, path.length() - 1);
        if (!path.startsWith("/"))
            path = "/" + path;
        return path;
    }
}
