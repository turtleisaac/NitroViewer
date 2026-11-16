/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.Narc;
import io.github.turtleisaac.nds4j.framework.MemBuf;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("decodeNanr reports a tileset that does not cover the cell")
class IncompatibleTilesetTest
{
    @Test
    @DisplayName("an OAM tile past a one-tile NCGR is an incompatible-tileset code, not a raw JVM error")
    void tilePastTileset() throws Exception
    {
        CheerpjFacade facade = new CheerpjFacade();
        int rom = open(facade, archive(4));
        int narc = narcHandle(facade.openNarc(rom, 0));

        String json = facade.decodeNanr(rom, narc, 3, narc, 2, narc, 0, narc, 1, 0, 0, true);

        assertThat(json)
                .contains("\"code\":\"incompatible-tileset\"");
        assertThat(json)
                .doesNotContain("NegativeArraySizeException")
                .doesNotContain("ArrayIndexOutOfBoundsException")
                .doesNotContain("ArithmeticException");

        String missing = facade.decodeNanr(rom, narc, 99, narc, 2, narc, 0, narc, 1, 0, 0, true);
        assertThat(missing)
                .contains("\"error\"")
                .doesNotContain("incompatible-tileset");
    }

    @Test
    @DisplayName("tile 0 of that NCGR still decodes")
    void tileInsideTileset() throws Exception
    {
        CheerpjFacade facade = new CheerpjFacade();
        int rom = open(facade, archive(0));
        int narc = narcHandle(facade.openNarc(rom, 0));

        String json = facade.decodeNanr(rom, narc, 3, narc, 2, narc, 0, narc, 1, 0, 0, true);

        assertThat(json)
                .contains("\"width\":")
                .doesNotContain("\"error\"");
    }

    private static int open(CheerpjFacade facade, byte[] narcBytes) throws Exception
    {
        Path root = Files.createTempDirectory("nv-fit");
        try
        {
            Files.createDirectories(root.resolve("arm9"));
            Files.createDirectories(root.resolve("arm7"));
            Files.createDirectories(root.resolve("files"));
            Files.write(root.resolve("config.yaml"), "files_dir: files/\n".getBytes());
            Files.write(root.resolve("header.yaml"), "title: FIT\ngamecode: FIT0\n".getBytes());
            Files.write(root.resolve("arm9/arm9.bin"), new byte[16]);
            Files.write(root.resolve("arm7/arm7.bin"), new byte[16]);
            Files.write(root.resolve("files/sprites.narc"), narcBytes);
            String opened = facade.openUnpackedRom(zip(root));
            assertThat(opened)
                    .contains("\"ok\":true");
            return field(opened, "handle");
        }
        finally
        {
            delete(root);
        }
    }

    /** NARC members: 0 NCGR, 1 NCLR, 2 NCER, 3 NANR. The OAM names {@code tile}. */
    private static byte[] archive(int tile) throws Exception
    {
        Color[] colors = new Color[16];
        for (int i = 0; i < colors.length; i++)
            colors[i] = Color.BLACK;

        colors[1] = Color.RED;
        IndexedImage ncgr = new IndexedImage(8, 8, 4, new Palette(colors));
        ncgr.setPixelValue(1, 1, 1);
        Narc narc = new Narc();
        narc.addFile(ncgr.save());
        narc.addFile(ncgr.getPalette().save());
        narc.addFile(ncer(tile));
        narc.addFile(nanr());
        return narc.save();
    }

    private static byte[] ncer(int tile)
    {
        int sectionSize = 0x20 + 8 + 6;
        MemBuf buf = MemBuf.create();
        buf.writer()
                .writeString("RECN")
                .writeShort((short) 0xFEFF)
                .writeShort((short) 0x0100)
                .writeInt(0x10 + sectionSize)
                .writeShort((short) 0x10)
                .writeShort((short) 1);
        buf.writer()
                .writeString("KBEC")
                .writeInt(sectionSize)
                .writeShort((short) 1)
                .writeShort((short) 0)
                .writeInt(0x18)
                .writeInt(0)
                .writeInt(0)
                .writeInt(0)
                .writeInt(0);
        buf.writer()
                .writeShort((short) 1)
                .writeShort((short) 0)
                .writeInt(0);
        buf.writer()
                .writeByte((byte) 0)
                .writeByte((byte) 0)
                .writeShort((short) 0)
                .writeShort((short) tile);
        return buf.reader().getBuffer();
    }

    private static byte[] nanr()
    {
        int sectionSize = 0x3C;
        MemBuf buf = MemBuf.create();
        buf.writer()
                .writeString("RNAN")
                .writeShort((short) 0xFEFF)
                .writeShort((short) 0x0100)
                .writeInt(0x10 + sectionSize)
                .writeShort((short) 0x10)
                .writeShort((short) 1);
        buf.writer()
                .writeString("KNBA")
                .writeInt(sectionSize)
                .writeShort((short) 1)
                .writeShort((short) 1)
                .writeInt(0x18)
                .writeInt(0x28)
                .writeInt(0x30)
                .writeInt(0)
                .writeInt(0);
        buf.writer()
                .writeShort((short) 1)
                .writeShort((short) 0)
                .writeInt(0)
                .writeInt(1)
                .writeInt(0);
        buf.writer()
                .writeInt(0)
                .writeShort((short) 4)
                .writeShort((short) 0xBEEF);
        buf.writer()
                .writeShort((short) 0)
                .writeShort((short) 0);
        return buf.reader().getBuffer();
    }

    private static byte[] zip(Path root) throws Exception
    {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ZipOutputStream zos = new ZipOutputStream(baos);
        Files.walk(root).filter(Files::isRegularFile).forEach(file -> {
            try
            {
                zos.putNextEntry(new ZipEntry(root.relativize(file).toString().replace('\\', '/')));
                Files.copy(file, zos);
                zos.closeEntry();
            }
            catch (Exception e)
            {
                throw new RuntimeException(e);
            }
        });
        zos.close();
        return baos.toByteArray();
    }

    private static void delete(Path root) throws Exception
    {
        if (!Files.exists(root))
            return;

        Files.walk(root)
                .sorted((a, b) -> b.compareTo(a))
                .forEach(path -> {
                    try
                    {
                        Files.deleteIfExists(path);
                    }
                    catch (Exception e)
                    {
                        throw new RuntimeException(e);
                    }
                });
    }

    private static int narcHandle(String json)
    {
        assertThat(json)
                .doesNotContain("\"error\"");
        return field(json, "narcHandle");
    }

    private static int field(String json, String key)
    {
        String needle = "\"" + key + "\":";
        int at = json.indexOf(needle);
        assertThat(at)
                .isGreaterThanOrEqualTo(0);
        int i = at + needle.length();
        int j = i;
        while (j < json.length() && Character.isDigit(json.charAt(j)))
            j++;

        return Integer.parseInt(json.substring(i, j));
    }
}
