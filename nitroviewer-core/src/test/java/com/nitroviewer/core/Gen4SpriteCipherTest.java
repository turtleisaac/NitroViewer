/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.framework.MemBuf;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Synthetic checks for {@link Gen4SpriteCipher}. No ROM data.
 */
@DisplayName("Gen 4 sprite cipher")
class Gen4SpriteCipherTest
{
    @Test
    @DisplayName("unscramble(scramble(x)) restores pixels, and the key word decodes to 0")
    void roundTripBothDirections()
    {
        byte[] plain = new byte[] {
                0x10, 0x32, 0x54, 0x76, (byte) 0x98, (byte) 0xBA, 0x00, 0x00
        };
        assertRoundTrip(plain, 0xBEEF, true); // backward, last word is the key

        byte[] forwardPlain = new byte[] {
                0x00, 0x00, 0x54, 0x76, (byte) 0x98, (byte) 0xBA, 0x21, 0x43
        };
        assertRoundTrip(forwardPlain, 0x00CD, false);
    }


    @Test
    @DisplayName("a known backward keystream matches the LCG, not a second call of the same helper")
    void knownBackwardVector()
    {
        // words 0x1111, 0x2222, 0x0000; seed 0x00AB -> 0x8E9C, 0xE160, 0x00AB
        byte[] data = new byte[] { 0x11, 0x11, 0x22, 0x22, 0x00, 0x00, 0x7F };
        Gen4SpriteCipher.scramble(data, 0, 6, 0x00AB, true);
        assertThat(data)
                .containsExactly(0x9C, 0x8E, 0x60, (byte) 0xE1, (byte) 0xAB, 0x00, 0x7F);

        Gen4SpriteCipher.unscramble(data, 0, 6, true);
        assertThat(data)
                .containsExactly(0x11, 0x11, 0x22, 0x22, 0x00, 0x00, 0x7F);
    }


    @Test
    @DisplayName("detection names the ciphered archives and leaves everything else alone")
    void detectsOnlyKnownSprites()
    {
        assertThat(Gen4SpriteCipher.frontToBack("ADAE", "/poketool/pokegra/pokegra.narc", 3))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("APAJ", "/poketool/pokegra/otherpoke.narc", 0))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("ADAE", "/poketool/trgra/trbgra.narc", 0))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("ADAE", "/poketool/trgra/trfgra.narc", 2))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("ADAE", "/poketool/trgra/trbgra.narc", 1))
                .isNull(); // palette

        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/pokegra/pl_pokegra.narc", 2361))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("CPUJ", "/poketool/pokegra/pl_otherpoke.narc", 1))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/pokegra/pokegra.narc", 3))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/trgra/trbgra.narc", 0))
                .isNull();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/trgra/trbgra.narc", 4))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/trgra/trfgra.narc", 9))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/trgra/trbgra.narc", 5))
                .isNull();

        assertThat(Gen4SpriteCipher.frontToBack("IPKE", "/a/0/0/4", 2361))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("IPGJ", "/a/1/1/4", 8))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("IPKE", "/a/0/0/6", 0))
                .isNull();
        assertThat(Gen4SpriteCipher.frontToBack("IPKE", "/a/0/0/6", 4))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("IPGE", "/a/0/5/8", 4))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("IPKS", "/a/0/5/8", 14))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("IPGP", "/pbr/pokegra.narc", 3))
                .isFalse();
        assertThat(Gen4SpriteCipher.frontToBack("IPKE", "/pbr/otherpoke.narc", 1))
                .isFalse();

        assertThat(Gen4SpriteCipher.frontToBack("cpue", "poketool/trgra/trbgra.narc", 4))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/poketool/trgra/trbgra.narc/", 4))
                .isTrue();
        assertThat(Gen4SpriteCipher.frontToBack("ABCD", "/poketool/pokegra/pokegra.narc", 0))
                .isNull();
        assertThat(Gen4SpriteCipher.frontToBack("CPUE", "/graphic/font.narc", 0))
                .isNull();
        assertThat(Gen4SpriteCipher.frontToBack(null, "/a/0/0/4", 0))
                .isNull();
        assertThat(Gen4SpriteCipher.frontToBack("IPKE", null, 4))
                .isNull();
    }


    @Test
    @DisplayName("the key word is the first pixels forward and the last pixels backward")
    void seedPixelsSitAtTheKeyWord()
    {
        assertThat(Gen4SpriteCipher.isSeedPixel(0, 0, 160, 80, 4, false))
                .isTrue();
        assertThat(Gen4SpriteCipher.isSeedPixel(3, 0, 160, 80, 4, false))
                .isTrue();
        assertThat(Gen4SpriteCipher.isSeedPixel(4, 0, 160, 80, 4, false))
                .isFalse();
        assertThat(Gen4SpriteCipher.isSeedPixel(159, 79, 160, 80, 4, true))
                .isTrue();
        assertThat(Gen4SpriteCipher.isSeedPixel(156, 79, 160, 80, 4, true))
                .isTrue();
        assertThat(Gen4SpriteCipher.isSeedPixel(155, 79, 160, 80, 4, true))
                .isFalse();
        assertThat(Gen4SpriteCipher.isSeedPixel(0, 0, 160, 80, 4, true))
                .isFalse();
        assertThat(Gen4SpriteCipher.isSeedPixel(1, 0, 80, 80, 8, false))
                .isTrue(); // 8bpp, 2 pixels per word
        assertThat(Gen4SpriteCipher.isSeedPixel(2, 0, 80, 80, 8, false))
                .isFalse();
    }


    @Test
    @DisplayName("Nds4j decrypts a synthetic ciphered NCGR and re-encrypts it to the same pixels")
    void nds4jAgreesAndRoundTrips()
    {
        int[] forward = pixels(64, false);
        byte[] forwardNcgr = cipheredNcgr(forward, 0x1357, false);
        assertPixels(load(forwardNcgr, true), forward);
        assertThat(load(forwardNcgr, true).save())
                .containsExactly(forwardNcgr);
        byte[] resaved = new IndexedImage(load(forwardNcgr, true).save(), 0, 0, 1, 1, true).save();
        assertThat(resaved)
                .containsExactly(forwardNcgr);
        assertPixels(load(resaved, true), forward);

        IndexedImage edited = load(forwardNcgr, true);
        edited.setPixelValue(5, 1, 3);
        byte[] editedBytes = edited.save();
        IndexedImage reloaded = load(editedBytes, true);
        assertThat(reloaded.getPixelValue(5, 1))
                .isEqualTo(3);
        assertThat(reloaded.getPixelValue(0, 0))
                .isEqualTo(0);
        assertThat(word(editedBytes, 0))
                .isEqualTo(word(forwardNcgr, 0)); // key word unchanged

        int[] backward = pixels(64, true);
        byte[] backwardNcgr = cipheredNcgr(backward, 0x2468, true);
        assertPixels(load(backwardNcgr, false), backward);
        assertThat(load(backwardNcgr, true).getPixelValue(0, 1))
                .isNotEqualTo(backward[8]); // wrong direction
        assertThat(load(backwardNcgr, false).save())
                .containsExactly(backwardNcgr);

        IndexedImage backwardEdited = load(backwardNcgr, false);
        backwardEdited.setPixelValue(5, 1, 3);
        byte[] backwardEditedBytes = backwardEdited.save();
        int[] editedPixels = backward.clone();
        editedPixels[8 + 5] = 3;
        assertThat(backwardEditedBytes)
                .containsExactly(cipheredNcgr(editedPixels, 0x2468, true));
        assertThat(load(backwardEditedBytes, false).save())
                .containsExactly(backwardEditedBytes);
    }


    @Test
    @DisplayName("a scanned 8bpp NCGR is refused before anything is written")
    void scanned8bppSaveIsRefused() throws Exception
    {
        byte[] file = scanned8bppNcgr();
        IndexedImage image = load(file, true);
        assertThat(image.getBitDepth())
                .isEqualTo(8);
        assertThat(image.isScanned())
                .isTrue();
        assertThatThrownBy(image::save)
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("8bpp not supported yet");

        CheerpjFacade facade = new CheerpjFacade();
        String opened = facade.openUnpackedRom(unpackedZip(file));
        assertThat(jsonBool(opened, "ok"))
                .isTrue();
        int handle = jsonInt(opened, "handle");

        String set = facade.setNcgrPixels(handle, -1, 0, 1, false, new byte[] { 1, 2, 3 });
        assertThat(jsonBool(set, "ok"))
                .isFalse();
        assertThat(jsonString(set, "error"))
                .isEqualTo("Saving scanned 8bpp sprites is not supported yet.");
        String imported = facade.importPng(handle, -1, 0, -1, 0, 0, 1, false, false, false, new byte[] { 1 });
        assertThat(jsonBool(imported, "ok"))
                .isFalse();
        assertThat(jsonString(imported, "error"))
                .isEqualTo("Saving scanned 8bpp sprites is not supported yet.");
        assertThat(jsonBase64(facade.exportFile(handle, -1, 0)))
                .containsExactly(file);
    }


    @Test
    @DisplayName("a scanned sheet with no cipher key reports ciphered false and keeps its first pixels")
    void plainScannedSheetHasNoCipherKey() throws Exception
    {
        byte[] plain = plainScannedNcgr();
        CheerpjFacade facade = new CheerpjFacade();
        String opened = facade.openUnpackedRom(unpackedZip(plain));
        assertThat(jsonBool(opened, "ok"))
                .isTrue();
        String decoded = facade.decodeNcgrIndexed(jsonInt(opened, "handle"), -1, 0, 1, true);
        assertThat(jsonBool(decoded, "scanned"))
                .isTrue();
        assertThat(jsonBool(decoded, "ciphered"))
                .isFalse();
        assertThat(jsonBool(decoded, "seedAtEnd"))
                .isFalse();
        byte[] pixels = jsonBase64Field(decoded, "pixels");
        assertThat(pixels[0] & 0xFF)
                .isEqualTo(1);
        assertThat(pixels[1] & 0xFF)
                .isEqualTo(2);
        assertThat(pixels[2] & 0xFF)
                .isEqualTo(3);
        assertThat(pixels[3] & 0xFF)
                .isEqualTo(4);

        byte[] backward = cipheredNcgr(pixels(64, true), 0x2468, true);
        String backOpen = facade.openUnpackedRom(unpackedZip(backward));
        String back = facade.decodeNcgrIndexed(jsonInt(backOpen, "handle"), -1, 0, 1, false);
        assertThat(jsonBool(back, "scanned"))
                .isTrue();
        assertThat(jsonBool(back, "ciphered"))
                .isTrue();
        assertThat(jsonBool(back, "seedAtEnd"))
                .isTrue();

        byte[] forward = cipheredNcgr(pixels(64, false), 0x1357, false);
        String frontOpen = facade.openUnpackedRom(unpackedZip(forward));
        String front = facade.decodeNcgrIndexed(jsonInt(frontOpen, "handle"), -1, 0, 1, true);
        assertThat(jsonBool(front, "scanned"))
                .isTrue();
        assertThat(jsonBool(front, "ciphered"))
                .isTrue();
        assertThat(jsonBool(front, "seedAtEnd"))
                .isFalse();
    }


    @Test
    @DisplayName("exact game code beats a wildcard, cipher beats render, and a per-entry hint beats both")
    void directionPrecedenceAgrees()
    {
        // Same document as grouping.test.ts "cipher direction precedence".
        String json = "{\"games\":{"
                + "\"zzz*\":{\"title\":\"Wildcard\",\"narcs\":{\"/conflict.narc\":{"
                + "\"render\":{\"scanDirection\":\"front-to-back\"},"
                + "\"cipher\":{\"scanDirection\":\"back-to-front\",\"indexMod\":5,\"indexRem\":4},"
                + "\"entries\":{\"4\":{\"scanDirection\":\"front-to-back\"}}"
                + "}}},"
                + "\"ZZZE\":{\"title\":\"Exact\",\"narcs\":{\"/conflict.narc\":{"
                + "\"render\":{\"scanDirection\":\"back-to-front\"}"
                + "}}}"
                + "}}";

        assertThat(GameDb.frontToBackIn(json, "ZZZE", "/conflict.narc", 4))
                .isFalse();
        assertThat(GameDb.frontToBackIn(json, "zzze", "/conflict.narc", 4))
                .isFalse();
        assertThat(GameDb.frontToBackIn(json, "ZZZJ", "/conflict.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBackIn(json, "ZZZJ", "/conflict.narc", 9))
                .isFalse();
        assertThat(GameDb.frontToBackIn(json, "ZZZJ", "/conflict.narc", 4))
                .isTrue();
    }


    @Test
    @DisplayName("an ordinary tiled NCGR is identical either direction")
    void unencryptedTilesIgnoreDirection()
    {
        int[] pixels = new int[64];
        for (int i = 0; i < pixels.length; i++)
        {
            pixels[i] = 1;
        }

        byte[] ncgr = ncgr(pack4(pixels), false);
        IndexedImage front = load(ncgr, true);
        IndexedImage back = load(ncgr, false);
        assertThat(front.isScanned())
                .isFalse();
        for (int i = 0; i < 64; i++)
        {
            assertThat(front.getPixelValue(i % 8, i / 8))
                    .isEqualTo(1);
            assertThat(back.getPixelValue(i % 8, i / 8))
                    .isEqualTo(1);
        }

        assertThat(front.save())
                .containsExactly(back.save());
    }

    /** Checks that unscramble(scramble(plain)) restores plain. */
    private static void assertRoundTrip(byte[] plain, int seed, boolean fromEnd)
    {
        byte[] data = plain.clone();
        Gen4SpriteCipher.scramble(data, 0, data.length, seed, fromEnd);
        assertThat(data)
                .isNotEqualTo(plain);
        Gen4SpriteCipher.unscramble(data, 0, data.length, fromEnd);
        assertThat(data)
                .containsExactly(plain);
    }

    /** 8x8 4bpp. The key word is colour 0. */
    private static int[] pixels(int n, boolean seedAtEnd)
    {
        int[] pixels = new int[n];
        for (int i = 0; i < n; i++)
        {
            pixels[i] = (i * 3 + 1) & 0xF;
        }

        int seed = Gen4SpriteCipher.seedPixelCount(4);
        if (seedAtEnd)
        {
            for (int i = n - seed; i < n; i++)
            {
                pixels[i] = 0;
            }
        }
        else
        {
            for (int i = 0; i < seed; i++)
            {
                pixels[i] = 0;
            }
        }
        return pixels;
    }

    /** Builds a scanned NCGR whose pixels are ciphered with <code>seed</code>. */
    private static byte[] cipheredNcgr(int[] pixels, int seed, boolean fromEnd)
    {
        byte[] packed = pack4(pixels);
        Gen4SpriteCipher.scramble(packed, 0, packed.length, seed, fromEnd);
        return ncgr(packed, true);
    }

    /** Packs palette indices into 4bpp bytes. */
    private static byte[] pack4(int[] pixels)
    {
        byte[] out = new byte[pixels.length / 2];
        for (int i = 0; i < out.length; i++)
        {
            out[i] = (byte) ((pixels[i * 2] & 0xF) | ((pixels[i * 2 + 1] & 0xF) << 4));
        }

        return out;
    }

    /** One 8x8 tile. <code>lineBuffer</code> sets the scanned flag. */
    private static byte[] ncgr(byte[] pixels, boolean lineBuffer)
    {
        int total = 0x30 + pixels.length;
        byte[] file = new byte[total];
        file[0] = 'R';
        file[1] = 'G';
        file[2] = 'C';
        file[3] = 'N';
        file[4] = (byte) 0xFE;
        file[5] = (byte) 0xFF;
        file[6] = 1;
        putInt(file, 8, total);
        file[12] = 0x10;
        file[14] = 1;
        file[16] = 'R';
        file[17] = 'A';
        file[18] = 'H';
        file[19] = 'C';
        putInt(file, 20, pixels.length + 0x20);
        putShort(file, 24, 1);
        putShort(file, 26, 1);
        putInt(file, 28, 3); // 4bpp
        file[0x24] = (byte) (lineBuffer ? 1 : 0);
        putInt(file, 0x28, pixels.length);
        file[0x2C] = 0x18; // Nds4j's character-header template; save() leaves these four bytes in place
        System.arraycopy(pixels, 0, file, 0x30, pixels.length);
        return file;
    }

    /** Loads an NCGR with the given scan direction. */
    private static IndexedImage load(byte[] ncgr, boolean frontToBack)
    {
        return new IndexedImage(ncgr, 0, 0, 1, 1, frontToBack);
    }

    /** Asserts an 8x8 image matches <code>pixels</code> in row-major order. */
    private static void assertPixels(IndexedImage image, int[] pixels)
    {
        assertThat(image.getWidth())
                .isEqualTo(8);
        assertThat(image.getHeight())
                .isEqualTo(8);
        for (int i = 0; i < pixels.length; i++)
        {
            assertThat(image.getPixelValue(i % 8, i / 8))
                    .as("pixel %s", i)
                    .isEqualTo(pixels[i]);
        }
    }

    /** Returns the pixel payload of an NCGR, starting at 0x30. */
    private static byte[] pixelsOf(byte[] ncgr)
    {
        byte[] pixels = new byte[ncgr.length - 0x30];
        System.arraycopy(ncgr, 0x30, pixels, 0, pixels.length);
        return pixels;
    }

    /** Reads a little-endian word from the pixel payload. */
    private static int word(byte[] ncgr, int wordIndex)
    {
        int at = 0x30 + wordIndex * 2;
        return (ncgr[at] & 0xFF) | ((ncgr[at + 1] & 0xFF) << 8);
    }

    /** Writes a little-endian short. */
    private static void putShort(byte[] file, int at, int value)
    {
        file[at] = (byte) (value & 0xFF);
        file[at + 1] = (byte) ((value >> 8) & 0xFF);
    }

    /** Writes a little-endian int. */
    private static void putInt(byte[] file, int at, int value)
    {
        file[at] = (byte) (value & 0xFF);
        file[at + 1] = (byte) ((value >> 8) & 0xFF);
        file[at + 2] = (byte) ((value >> 16) & 0xFF);
        file[at + 3] = (byte) ((value >> 24) & 0xFF);
    }

    /** One 8x8 scanned 8bpp tile. */
    private static byte[] scanned8bppNcgr()
    {
        byte[] pixels = new byte[64];
        for (int i = 0; i < pixels.length; i++)
        {
            pixels[i] = (byte) (i < 2 ? 0 : i);
        }

        MemBuf buf = MemBuf.create();
        MemBuf.MemBufWriter w = buf.writer();
        w.writeString("RGCN");
        w.writeBytes(0xFE, 0xFF);
        w.writeShort((short) 1);
        w.writeInt(0x30 + pixels.length);
        w.writeShort((short) 0x10);
        w.writeShort((short) 1);
        w.writeString("RAHC");
        w.writeInt(pixels.length + 0x20);
        w.writeShort((short) 1);
        w.writeShort((short) 1);
        w.writeInt(4); // 8bpp
        w.writeInt(0); // unspecified size, mapping type
        w.writeByte((byte) 1); // line buffer
        w.writeBytes(0, 0, 0);
        w.writeInt(pixels.length);
        w.writeBytes(0x18, 0, 0, 0); // same template bytes save() keeps at 0x2C
        w.write(pixels);
        return buf.reader().getBuffer();
    }

    /** A 0x200 header that passes Nds4j's unpacked-ROM checks. Game code TEST. */
    private static byte[] unpackedHeader()
    {
        MemBuf buf = MemBuf.create();
        MemBuf.MemBufWriter w = buf.writer();
        w.writeString("SYNTHETIC", 12);
        w.writeString("TEST", 4);
        w.writeString("01", 2);
        w.writeBytes(0, 0, 0);
        w.write(new byte[7]);
        w.writeBytes(0, 0, 0, 0);
        w.writeInt(0x4000);
        w.writeInt(0x02000000);
        w.writeInt(0x02000000);
        w.writeInt(4);
        w.writeInt(0x8000);
        w.writeInt(0x037F8000);
        w.writeInt(0x037F8000);
        w.writeInt(4);
        w.write(new byte[0x200 - w.getPosition()]);
        return buf.reader().getBuffer();
    }

    /** Zips an ndstool-style unpacked ROM holding one loose NCGR. */
    private static byte[] unpackedZip(byte[] ncgr) throws Exception
    {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        ZipOutputStream zip = new ZipOutputStream(bos);
        putZip(zip, "header.bin", unpackedHeader());
        putZip(zip, "arm9.bin", new byte[4]);
        putZip(zip, "arm7.bin", new byte[4]);
        putZip(zip, "y9.bin", new byte[0]);
        putZip(zip, "y7.bin", new byte[0]);
        putZip(zip, "banner.bin", new byte[4]);
        putZip(zip, "data/sprite.NCGR", ncgr);
        zip.close();
        return bos.toByteArray();
    }

    /** Adds one zip entry. */
    private static void putZip(ZipOutputStream zip, String name, byte[] bytes) throws Exception
    {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    /** Returns one field's raw JSON value from a flat object. */
    private static String jsonRaw(String json, String field)
    {
        String key = "\"" + field + "\":";
        int at = json.indexOf(key);
        assertThat(at)
                .isGreaterThanOrEqualTo(0);
        int start = at + key.length();
        if (json.charAt(start) == '"')
        {
            int end = start + 1;
            while (end < json.length() && json.charAt(end) != '"')
            {
                end++;
            }

            return json.substring(start, end + 1);
        }

        int end = start;
        while (end < json.length() && json.charAt(end) != ',' && json.charAt(end) != '}')
        {
            end++;
        }

        return json.substring(start, end);
    }


    /** Reads a boolean field from a flat JSON object. */
    private static boolean jsonBool(String json, String field)
    {
        String value = jsonRaw(json, field);
        if ("true".equals(value))
            return true;
        if ("false".equals(value))
            return false;
        throw new AssertionError(field + " is not a boolean");
    }


    /** Reads a string field from a flat JSON object. */
    private static String jsonString(String json, String field)
    {
        String raw = jsonRaw(json, field);
        assertThat(raw)
                .startsWith("\"")
                .endsWith("\"");
        return raw.substring(1, raw.length() - 1);
    }


    /** Reads an int field from a flat JSON object. */
    private static int jsonInt(String json, String field)
    {
        String key = "\"" + field + "\":";
        int at = json.indexOf(key);
        assertThat(at)
                .isGreaterThanOrEqualTo(0);
        int start = at + key.length();
        int end = start;
        if (json.charAt(end) == '-')
            end++;
        while (end < json.length() && Character.isDigit(json.charAt(end)))
        {
            end++;
        }

        return Integer.parseInt(json.substring(start, end));
    }


    /** Decodes the base64 field of an export JSON object. */
    private static byte[] jsonBase64(String json)
    {
        return jsonBase64Field(json, "base64");
    }


    /** Decodes one base64 string field of a flat JSON object. */
    private static byte[] jsonBase64Field(String json, String field)
    {
        String key = "\"" + field + "\":\"";
        int at = json.indexOf(key);
        assertThat(at)
                .isGreaterThanOrEqualTo(0);
        int start = at + key.length();
        int end = json.indexOf('"', start);
        return Base64.getDecoder().decode(json.substring(start, end));
    }


    /** One 8x8 line-buffer tile plus SOPC, so Nds4j treats it as a plain scan with ink in the first word. */
    private static byte[] plainScannedNcgr()
    {
        byte[] pixels = new byte[32];
        pixels[0] = 0x21;
        pixels[1] = 0x43;
        int charSection = pixels.length + 0x20;
        int total = 0x10 + charSection + 0x10;
        MemBuf buf = MemBuf.create();
        MemBuf.MemBufWriter w = buf.writer();
        w.writeString("RGCN");
        w.writeBytes(0xFE, 0xFF);
        w.writeShort((short) 1);
        w.writeInt(total);
        w.writeShort((short) 0x10);
        w.writeShort((short) 2);
        w.writeString("RAHC");
        w.writeInt(charSection);
        w.writeShort((short) 1);
        w.writeShort((short) 1);
        w.writeInt(3);
        w.writeInt(0);
        w.writeByte((byte) 1);
        w.writeBytes(0, 0, 0);
        w.writeInt(pixels.length);
        w.writeBytes(0x18, 0, 0, 0);
        w.write(pixels);
        w.writeString("SOPC");
        w.writeInt(0x10);
        w.write(new byte[8]);
        return buf.reader().getBuffer();
    }
}
