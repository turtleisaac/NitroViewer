/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.NintendoDsRom;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CheerpjFacade#openUnpackedRom} — the Nds4j {@code fromUnpacked} path. Error-contract tests
 * always run; the unpack round-trip is ROM-gated via {@link TestRoms}.
 */
@DisplayName("CheerpjFacade openUnpackedRom")
class CheerpjFacadeUnpackedTest
{
    @Test
    @DisplayName("openUnpackedRom rejects garbage with a structured error, never an exception")
    void openUnpackedRomBad()
    {
        String res = new CheerpjFacade().openUnpackedRom(new byte[64]);
        assertThat(res).contains("\"ok\":false").contains("\"error\":");
        assertThat(intField(res, "len")).isEqualTo(64);
    }

    @Test
    @DisplayName("openUnpackedRom rejects a zip that is not an unpacked ROM folder")
    void openUnpackedRomMissingHeader() throws Exception
    {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ZipOutputStream zos = new ZipOutputStream(baos);
        zos.putNextEntry(new ZipEntry("readme.txt"));
        zos.write("not a rom".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        zos.closeEntry();
        zos.close();
        String res = new CheerpjFacade().openUnpackedRom(baos.toByteArray());
        assertThat(res).contains("\"ok\":false");
        assertThat(res).contains("unpacked");
    }

    @Test
    @DisplayName("openUnpackedRom reads a STORED zip (the format the frontend packs)")
    void openUnpackedRomStoredZip() throws Exception
    {
        byte[] payload = "not a rom".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        CRC32 crc = new CRC32();
        crc.update(payload);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ZipOutputStream zos = new ZipOutputStream(baos);
        zos.setMethod(ZipOutputStream.STORED);
        ZipEntry e = new ZipEntry("readme.txt");
        e.setMethod(ZipEntry.STORED);
        e.setSize(payload.length);
        e.setCompressedSize(payload.length);
        e.setCrc(crc.getValue());
        zos.putNextEntry(e);
        zos.write(payload);
        zos.closeEntry();
        zos.close();
        String res = new CheerpjFacade().openUnpackedRom(baos.toByteArray());
        // Extract succeeded (not "zip contained no files") — fail is "not an unpacked ROM".
        assertThat(res).contains("\"ok\":false").contains("unpacked");
        assertThat(res).doesNotContain("the zip contained no files");
    }

    @Test
    @DisplayName("openUnpackedRom loads a ds-rom extract folder (config.yaml)")
    void openUnpackedRomDsRomExtract() throws Exception
    {
        Path tmp = Files.createTempDirectory("nv-dsrom");
        try
        {
            Path root = tmp.resolve("extract");
            Files.createDirectories(root.resolve("arm9"));
            Files.createDirectories(root.resolve("arm7"));
            Files.createDirectories(root.resolve("files/a"));
            Files.write(root.resolve("config.yaml"), (
                    "header: header.yaml\n"
                            + "arm9_bin: arm9/arm9.bin\n"
                            + "arm7_bin: arm7/arm7.bin\n"
                            + "files_dir: files/\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Files.write(root.resolve("header.yaml"),
                    "title: DSROM\ngamecode: DSRM\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Files.write(root.resolve("arm9/arm9.bin"), new byte[64]);
            Files.write(root.resolve("arm7/arm7.bin"), new byte[32]);
            Files.write(root.resolve("files/a/note.txt"), "hi".getBytes(java.nio.charset.StandardCharsets.UTF_8));

            CheerpjFacade fresh = new CheerpjFacade();
            String res = fresh.openUnpackedRom(zipTree(root, ""));
            assertThat(res).contains("\"ok\":true");
            int handle = intField(res, "handle");
            String info = fresh.getRomInfo(handle);
            assertThat(strField(info, "gameCode")).isEqualTo("DSRM");
            assertThat(strField(info, "title").trim()).isEqualTo("DSROM");
            String tree = fresh.listTree(handle);
            assertThat(tree).contains("note.txt").doesNotContain("\"error\"");

            int wrapped = intField(fresh.openUnpackedRom(zipTree(root, "outer/")), "handle");
            assertThat(strField(fresh.getRomInfo(wrapped), "gameCode")).isEqualTo("DSRM");
        }
        finally
        {
            deleteTree(tmp);
        }
    }

    @Test
    @DisplayName("openUnpackedRom loads via NintendoDsRom.fromUnpacked after Nds4j unpack")
    void openUnpackedRomFromNds4jUnpack() throws Exception
    {
        byte[] romBytes = TestRoms.require("HeartGold.nds");
        Path tmp = Files.createTempDirectory("nv-unpacked-test");
        try
        {
            Path unpacked = tmp.resolve("rom");
            new NintendoDsRom(romBytes).unpack(unpacked.toFile());

            CheerpjFacade fresh = new CheerpjFacade();
            byte[] zip = zipTree(unpacked, "");
            String res = fresh.openUnpackedRom(zip);
            assertThat(res).contains("\"ok\":true");
            assertThat(intField(res, "len")).isEqualTo(zip.length);
            int handle = intField(res, "handle");

            String info = fresh.getRomInfo(handle);
            NintendoDsRom packed = new NintendoDsRom(romBytes);
            assertThat(strField(info, "gameCode")).isEqualTo(packed.getGameCode());
            assertThat(intField(info, "numFiles")).isEqualTo(packed.getNumFiles());

            String tree = fresh.listTree(handle);
            assertThat(tree).startsWith("{").contains("\"folders\":[").contains("\"files\":[");
            assertThat(tree).doesNotContain("\"error\"");

            // A wrapping folder (OS zip of the directory) and a PokEditor <project>/rom/ layout
            // must resolve to the same fromUnpacked root.
            int wrapped = intField(fresh.openUnpackedRom(zipTree(unpacked, "outer/")), "handle");
            assertThat(strField(fresh.getRomInfo(wrapped), "gameCode")).isEqualTo(strField(info, "gameCode"));
            int project = intField(fresh.openUnpackedRom(zipTree(unpacked, "MyProject/rom/")), "handle");
            assertThat(intField(fresh.getRomInfo(project), "numFiles")).isEqualTo(intField(info, "numFiles"));
        }
        finally
        {
            deleteTree(tmp);
        }
    }

    /** ZIP {@code root}'s files with {@code prefix} prepended to every entry name ("" = at zip root). */
    private static byte[] zipTree(final Path root, final String prefix) throws IOException
    {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        final ZipOutputStream zos = new ZipOutputStream(baos);
        Files.walkFileTree(root, new SimpleFileVisitor<Path>()
        {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException
            {
                String rel = root.relativize(file).toString().replace('\\', '/');
                zos.putNextEntry(new ZipEntry(prefix + rel));
                Files.copy(file, zos);
                zos.closeEntry();
                return FileVisitResult.CONTINUE;
            }
        });
        zos.close();
        return baos.toByteArray();
    }

    private static void deleteTree(Path root) throws IOException
    {
        if (root == null || !Files.exists(root)) return;
        Files.walkFileTree(root, new SimpleFileVisitor<Path>()
        {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException
            {
                Files.deleteIfExists(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException
            {
                Files.deleteIfExists(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static int intField(String json, String key)
    {
        Matcher m = Pattern.compile("\"" + key + "\":(-?\\d+)").matcher(json);
        assertThat(m.find()).as("integer field '%s' present", key).isTrue();
        return Integer.parseInt(m.group(1));
    }

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
