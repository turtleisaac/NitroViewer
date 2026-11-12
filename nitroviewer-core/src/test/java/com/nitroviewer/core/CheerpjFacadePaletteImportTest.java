/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.turtleisaac.nds4j.images.Palette;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

/** {@link CheerpjFacade#importPalette} on a synthetic ds-rom folder, so it runs without a retail ROM. */
@DisplayName("CheerpjFacade importPalette")
class CheerpjFacadePaletteImportTest
{
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Color[] original = PaletteSwatchTest.withDuplicates(16);
    private CheerpjFacade facade;
    private int rom;
    private int nclr;

    @BeforeEach
    void openRom() throws IOException
    {
        facade = new CheerpjFacade();
        rom = JSON.readTree(facade.openUnpackedRom(extractZip(new Palette(original).save()))).get("handle").asInt();

        for (JsonNode file : JSON.readTree(facade.listTree(rom)).get("files"))
        {
            if (file.get("name").asText().equals("pal.nclr"))
                nclr = file.get("id").asInt();
        }
    }

    @Test
    @DisplayName("re-importing the exported swatch PNG leaves every index unchanged")
    void swatchRoundTrip() throws IOException
    {
        JsonNode res = JSON.readTree(facade.importPalette(rom, -1, nclr, png(PaletteSwatchTest.grid(original, 16))));

        assertThat(colors())
                .containsExactly(hex(original));
        assertThat(res.get("ok").asBoolean())
                .isTrue();
        assertThat(res.get("bySwatch").asBoolean())
                .isTrue();
        assertThat(res.get("unique").asInt())
                .isEqualTo(13);
    }

    @Test
    @DisplayName("an image that is not a swatch grid fills the palette with its distinct colors")
    void otherImageUsesDistinctColors() throws IOException
    {
        BufferedImage img = new BufferedImage(3, 1, BufferedImage.TYPE_INT_RGB);
        img.setRGB(0, 0, 0xF80000);
        img.setRGB(1, 0, 0x00F800);
        img.setRGB(2, 0, 0xF80000);

        JsonNode res = JSON.readTree(facade.importPalette(rom, -1, nclr, png(img)));

        assertThat(res.get("bySwatch").asBoolean())
                .isFalse();
        assertThat(res.get("unique").asInt())
                .isEqualTo(2);
        assertThat(colors())
                .startsWith("#f80000", "#00f800", "#000000")
                .hasSize(16);
    }

    @Test
    @DisplayName("missing or undecodable bytes return a structured error and leave the palette alone")
    void rejectsBadInput() throws IOException
    {
        assertThat(facade.importPalette(rom, -1, nclr, null))
                .contains("\"ok\":false")
                .contains("no bytes");
        assertThat(facade.importPalette(rom, -1, nclr, new byte[] { 1, 2, 3 }))
                .contains("\"ok\":false")
                .contains("Could not decode");
        assertThat(colors())
                .containsExactly(hex(original));
    }

    private String[] colors() throws IOException
    {
        JsonNode list = JSON.readTree(facade.decodePalette(rom, -1, nclr)).get("colors");
        String[] out = new String[list.size()];
        for (int i = 0; i < out.length; i++)
            out[i] = list.get(i).asText().toLowerCase();

        return out;
    }

    private static String[] hex(Color[] colors)
    {
        String[] out = new String[colors.length];
        for (int i = 0; i < colors.length; i++)
            out[i] = String.format("#%06x", colors[i].getRGB() & 0xFFFFFF);

        return out;
    }

    private static byte[] png(BufferedImage img) throws IOException
    {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    /** A minimal ds-rom extract folder, zipped, holding one palette at files/pal.nclr. */
    private static byte[] extractZip(byte[] nclrBytes) throws IOException
    {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out))
        {
            put(zip, "config.yaml", "header: header.yaml\narm9_bin: arm9/arm9.bin\narm7_bin: arm7/arm7.bin\nfiles_dir: files/\n".getBytes(StandardCharsets.UTF_8));
            put(zip, "header.yaml", "title: PALTEST\ngamecode: PALT\n".getBytes(StandardCharsets.UTF_8));
            put(zip, "arm9/arm9.bin", new byte[64]);
            put(zip, "arm7/arm7.bin", new byte[32]);
            put(zip, "files/pal.nclr", nclrBytes);
        }

        return out.toByteArray();
    }

    private static void put(ZipOutputStream zip, String name, byte[] data) throws IOException
    {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(data);
        zip.closeEntry();
    }
}
