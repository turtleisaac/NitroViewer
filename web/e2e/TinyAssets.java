import io.github.turtleisaac.nds4j.g3d.ImdImporter;
import io.github.turtleisaac.nds4j.g3d.ModelBuilder;
import io.github.turtleisaac.nds4j.g3d.ModelSet;
import io.github.turtleisaac.nds4j.g3d.TextureSet;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;

import java.awt.Color;
import java.nio.file.Files;
import java.nio.file.Path;

/** Writes a tiny sprite, texture, and model that Nds4j can decode. Not taken from a ROM. */
public class TinyAssets
{
    public static void main(String[] args) throws Exception
    {
        Path dir = Path.of(args[0]);
        Color[] colors = new Color[16];
        colors[0] = Color.BLACK;
        colors[1] = new Color(220, 40, 40);
        for (int i = 2; i < colors.length; i++)
            colors[i] = Color.BLACK;
        Palette palette = new Palette(colors);

        IndexedImage sprite = new IndexedImage(8, 8, 4, palette);
        for (int y = 0; y < 8; y++)
            for (int x = 0; x < 8; x++)
                sprite.setPixelValue(x, y, 1);
        byte[] ncgr = sprite.save();
        byte[] nclr = palette.save();
        new IndexedImage(ncgr, 0, 0, 1, 1, true);

        String bitmap = "1111 1111 1111 1111\n".repeat(4);
        String paletteWords = "0000 001f 0000 0000 0000 0000 0000 0000";
        String imd = ""
                + "<tex_image name=\"dot\" width=\"8\" height=\"8\" color0_mode=\"color\">"
                + "<bitmap>" + bitmap + "</bitmap></tex_image>"
                + "<tex_palette name=\"dot\">" + paletteWords + "</tex_palette>";
        byte[] nsbtx = ImdImporter.toNsbtx(imd);
        TextureSet textures = new TextureSet(nsbtx);
        if (textures.getTextures().isEmpty() || textures.getImage(textures.getTextures().get(0)) == null)
            throw new IllegalStateException("texture did not decode");

        byte[] nsbmd = ModelBuilder.buildUntextured(
                "tri",
                new float[] {-1f, -1f, 0f, 1f, -1f, 0f, 0f, 1f, 0f},
                new int[] {0, 1, 2});
        if (new ModelSet(nsbmd).getModels().isEmpty())
            throw new IllegalStateException("model did not decode");

        Files.write(dir.resolve("sprite.ncgr"), ncgr);
        Files.write(dir.resolve("sprite.nclr"), nclr);
        Files.write(dir.resolve("texture.nsbtx"), nsbtx);
        Files.write(dir.resolve("model.nsbmd"), nsbmd);
    }
}
