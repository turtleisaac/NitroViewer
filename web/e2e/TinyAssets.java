import io.github.turtleisaac.nds4j.g3d.ImdImporter;
import io.github.turtleisaac.nds4j.g3d.ModelBuilder;
import io.github.turtleisaac.nds4j.g3d.ModelSet;
import io.github.turtleisaac.nds4j.g3d.TextureSet;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;
import io.github.turtleisaac.nds4j.sound.Sequence;
import io.github.turtleisaac.nds4j.sound.SequenceNotes;
import io.github.turtleisaac.nds4j.sound.SoundArchive;

import java.awt.Color;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Writes a tiny sprite, texture, model, and sound archive that Nds4j can decode. Not taken from a ROM.
 *  Deliberately avoids MemBuf, so these tests still run when MemBuf is broken. */
public class TinyAssets
{
    public static void main(String[] args) throws Exception
    {
        Path dir = Path.of(args[0]);
        writeSprite(dir);
        writeTexture(dir);
        writeModel(dir);
        Files.write(dir.resolve("sound.sdat"), soundArchive());
    }

    static void writeSprite(Path dir) throws Exception
    {
        Palette palette = spritePalette();
        IndexedImage sprite = filledSprite(palette);
        byte[] ncgr = sprite.save();

        new IndexedImage(ncgr, 0, 0, 1, 1, true);

        Files.write(dir.resolve("sprite.ncgr"), ncgr);
        Files.write(dir.resolve("sprite.nclr"), palette.save());
    }

    static Palette spritePalette()
    {
        Color[] colors = blackColors();
        colors[1] = new Color(220, 40, 40);
        return new Palette(colors);
    }

    static Color[] blackColors()
    {
        Color[] colors = new Color[16];
        for (int i = 0; i < colors.length; i++)
            colors[i] = Color.BLACK;
        return colors;
    }

    static IndexedImage filledSprite(Palette palette)
    {
        IndexedImage sprite = new IndexedImage(8, 8, 4, palette);
        for (int i = 0; i < 64; i++)
            sprite.setPixelValue(i % 8, i / 8, 1);
        return sprite;
    }

    static void writeTexture(Path dir) throws Exception
    {
        String bitmap = "1111 1111 1111 1111\n".repeat(4);
        String paletteWords = "0000 001f 0000 0000 0000 0000 0000 0000";
        String imd = ""
                + "<tex_image name=\"dot\" width=\"8\" height=\"8\" color0_mode=\"color\">"
                + "<bitmap>" + bitmap + "</bitmap></tex_image>"
                + "<tex_palette name=\"dot\">" + paletteWords + "</tex_palette>";

        byte[] nsbtx = ImdImporter.toNsbtx(imd);
        checkTexture(new TextureSet(nsbtx));

        Files.write(dir.resolve("texture.nsbtx"), nsbtx);
    }

    static void checkTexture(TextureSet textures)
    {
        if (textures.getTextures().isEmpty())
            throw new IllegalStateException("texture did not decode");

        checkTextureImage(textures);
    }

    static void checkTextureImage(TextureSet textures)
    {
        if (textures.getImage(textures.getTextures().get(0)) == null)
            throw new IllegalStateException("texture did not decode");
    }

    static void writeModel(Path dir) throws Exception
    {
        byte[] nsbmd = ModelBuilder.buildUntextured(
                "tri",
                new float[] {-1f, -1f, 0f, 1f, -1f, 0f, 0f, 1f, 0f},
                new int[] {0, 1, 2});
        checkModel(nsbmd);

        Files.write(dir.resolve("model.nsbmd"), nsbmd);
    }

    static void checkModel(byte[] nsbmd)
    {
        if (new ModelSet(nsbmd).getModels().isEmpty())
            throw new IllegalStateException("model did not decode");
    }

    /** One named sequence whose note roll is what made the inspector wider than the window. */
    static byte[] soundArchive()
    {
        byte[] events = new byte[] { 0x3C, 0x7F, 24, (byte) 0xFF };
        byte[] sseq = sseq(events);
        byte[] name = "SEQ_SE_SW_CHAMPIRIS_01".getBytes(StandardCharsets.ISO_8859_1);

        int nameAt = 0x30;
        int symbSize = nameAt + name.length + 1;
        int infoSize = 0x3C;
        int fatSize = 28;
        int symbOff = 0x40;
        int infoOff = align(symbOff + symbSize, 4);
        int fatOff = align(infoOff + infoSize, 4);
        int fileOff = align(fatOff + fatSize, 4);
        int sseqAt = align(fileOff + 12, 32);

        byte[] out = new byte[sseqAt + sseq.length];
        writeHeader(out, symbOff, symbSize, infoOff, infoSize, fatOff, fatSize, fileOff);
        writeSymbols(out, symbOff, symbSize, nameAt, name);
        writeInfo(out, infoOff, infoSize);
        writeFat(out, fatOff, fatSize, sseqAt, sseq.length);
        writeFileBlock(out, fileOff, sseqAt, sseq);

        checkArchive(out);
        return out;
    }

    static void writeHeader(byte[] out, int symbOff, int symbSize, int infoOff, int infoSize,
                            int fatOff, int fatSize, int fileOff)
    {
        putAscii(out, 0, "SDAT");
        putLe(out, 4, 0xFEFF, 2);
        putLe(out, 6, 0x0100, 2);
        putLe(out, 8, out.length, 4);
        putLe(out, 12, 0x40, 2);
        putLe(out, 14, 4, 2);
        putLe(out, 0x10, symbOff, 4);
        putLe(out, 0x14, symbSize, 4);
        putLe(out, 0x18, infoOff, 4);
        putLe(out, 0x1C, infoSize, 4);
        putLe(out, 0x20, fatOff, 4);
        putLe(out, 0x24, fatSize, 4);
        putLe(out, 0x28, fileOff, 4);
        putLe(out, 0x2C, out.length - fileOff, 4);
    }

    static void writeSymbols(byte[] out, int symbOff, int symbSize, int nameAt, byte[] name)
    {
        putAscii(out, symbOff, "SYMB");
        putLe(out, symbOff + 4, symbSize, 4);
        putLe(out, symbOff + 8, 0x28, 4);
        putLe(out, symbOff + 0x28, 1, 4);
        putLe(out, symbOff + 0x2C, nameAt, 4);

        System.arraycopy(name, 0, out, symbOff + nameAt, name.length);
    }

    static void writeInfo(byte[] out, int infoOff, int infoSize)
    {
        putAscii(out, infoOff, "INFO");
        putLe(out, infoOff + 4, infoSize, 4);
        putLe(out, infoOff + 8, 0x28, 4);
        putLe(out, infoOff + 0x28, 1, 4);
        putLe(out, infoOff + 0x2C, 0x30, 4);
        putLe(out, infoOff + 0x30, 0, 2);
        putLe(out, infoOff + 0x34, 0, 2);

        out[infoOff + 0x36] = 127;
        out[infoOff + 0x37] = 64;
        out[infoOff + 0x38] = 64;
        out[infoOff + 0x39] = 64;
    }

    static void writeFat(byte[] out, int fatOff, int fatSize, int sseqAt, int sseqLen)
    {
        putAscii(out, fatOff, "FAT ");
        putLe(out, fatOff + 4, fatSize, 4);
        putLe(out, fatOff + 8, 1, 4);
        putLe(out, fatOff + 12, sseqAt, 4);
        putLe(out, fatOff + 16, sseqLen, 4);
    }

    static void writeFileBlock(byte[] out, int fileOff, int sseqAt, byte[] sseq)
    {
        putAscii(out, fileOff, "FILE");
        putLe(out, fileOff + 4, out.length - fileOff, 4);
        putLe(out, fileOff + 8, 1, 4);

        System.arraycopy(sseq, 0, out, sseqAt, sseq.length);
    }

    static void checkArchive(byte[] out)
    {
        SoundArchive archive = SoundArchive.fromBytes(out);
        checkSequenceCount(archive);
        checkSequenceName(archive);
        checkNotes(archive);
    }

    static void checkSequenceCount(SoundArchive archive)
    {
        if (archive.getRecordCount(SoundArchive.RecordType.SEQUENCE) != 1)
            throw new IllegalStateException("sound archive has no sequence");
    }

    static void checkSequenceName(SoundArchive archive)
    {
        if (!"SEQ_SE_SW_CHAMPIRIS_01".equals(archive.getName(SoundArchive.RecordType.SEQUENCE, 0)))
            throw new IllegalStateException("sequence name did not round-trip");
    }

    static void checkNotes(SoundArchive archive)
    {
        byte[] file = archive.getFileFor(SoundArchive.RecordType.SEQUENCE, 0);
        if (SequenceNotes.extract(Sequence.fromBytes(file)).notes.isEmpty())
            throw new IllegalStateException("sequence has no notes");
    }

    static byte[] sseq(byte[] events)
    {
        byte[] file = new byte[0x1C + events.length];
        putAscii(file, 0, "SSEQ");
        putLe(file, 4, 0xFEFF, 2);
        putLe(file, 6, 0x0100, 2);
        putLe(file, 8, file.length, 4);
        putLe(file, 12, 0x10, 2);
        putLe(file, 14, 1, 2);
        putAscii(file, 16, "DATA");
        putLe(file, 20, file.length - 16, 4);
        putLe(file, 24, 0x1C, 4);

        System.arraycopy(events, 0, file, 0x1C, events.length);
        return file;
    }

    static int align(int value, int boundary)
    {
        return (value + boundary - 1) / boundary * boundary;
    }

    static void putAscii(byte[] buf, int offset, String text)
    {
        for (int i = 0; i < text.length(); i++)
            buf[offset + i] = (byte) text.charAt(i);
    }

    static void putLe(byte[] buf, int offset, int value, int bytes)
    {
        for (int i = 0; i < bytes; i++)
            buf[offset + i] = (byte) (value >> (8 * i));
    }
}
