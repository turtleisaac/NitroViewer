/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("PaletteSwatch image reading")
class PaletteSwatchTest
{
    /** Builds a 16-column swatch grid like PaletteViewer's export, leaving unused cells transparent. */
    static BufferedImage grid(Color[] colors, int cell)
    {
        int rows = (colors.length + PaletteSwatch.COLUMNS - 1) / PaletteSwatch.COLUMNS;
        BufferedImage img = new BufferedImage(PaletteSwatch.COLUMNS * cell, rows * cell, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        for (int i = 0; i < colors.length; i++)
        {
            g.setColor(colors[i]);
            g.fillRect((i % PaletteSwatch.COLUMNS) * cell, (i / PaletteSwatch.COLUMNS) * cell, cell, cell);
        }

        g.dispose();
        return img;
    }

    /** {@code n} shades with index 2 repeated at 5 and 9, and index 0 at 12. */
    static Color[] withDuplicates(int n)
    {
        Color[] colors = new Color[n];
        for (int i = 0; i < n; i++)
            colors[i] = new Color(8 * (i % 32), 8 * ((i * 3) % 32), 8 * ((i * 7) % 32));

        colors[5] = colors[2];
        colors[9] = colors[2];
        colors[12] = colors[0];
        return colors;
    }

    @Test
    @DisplayName("an exported grid is read by position, keeping repeated colors at their indices")
    void readsGridByPosition()
    {
        Color[] colors = withDuplicates(16);

        PaletteSwatch read = PaletteSwatch.read(grid(colors, 16), 16);

        assertThat(read.bySwatch)
                .isTrue();
        assertThat(read.colors)
                .containsExactly(colors);
        assertThat(read.unique)
                .isEqualTo(13);
    }

    @Test
    @DisplayName("a scaled-up grid and a one-pixel strip are both read by position")
    void readsScaledGridAndStrip()
    {
        Color[] colors = withDuplicates(32);

        assertThat(PaletteSwatch.read(grid(colors, 40), 32).colors)
                .containsExactly(colors);
        assertThat(PaletteSwatch.read(grid(withDuplicates(16), 1), 16).colors)
                .containsExactly(withDuplicates(16));
    }

    @Test
    @DisplayName("a partial last row is read and its empty cells are ignored")
    void readsPartialLastRow()
    {
        Color[] colors = withDuplicates(20);

        PaletteSwatch read = PaletteSwatch.read(grid(colors, 16), 20);

        assertThat(read.bySwatch)
                .isTrue();
        assertThat(read.colors)
                .containsExactly(colors);
    }

    @Test
    @DisplayName("a grid-shaped image with a non-solid cell falls back to distinct colors")
    void nonSolidCellFallsBack()
    {
        Color[] colors = withDuplicates(16);
        BufferedImage img = grid(colors, 16);
        img.setRGB(16 * 15 + 3, 3, Color.WHITE.getRGB());

        PaletteSwatch read = PaletteSwatch.read(img, 16);

        assertThat(read.bySwatch)
                .isFalse();
        assertThat(read.unique)
                .isEqualTo(14);
        assertThat(read.colors[5])
                .isEqualTo(colors[6]);
        assertThat(read.colors[15])
                .isEqualTo(Color.BLACK);
    }

    @Test
    @DisplayName("a non-solid cell in a later row also falls back")
    void nonSolidCellInSecondRowFallsBack()
    {
        BufferedImage img = grid(withDuplicates(32), 16);
        img.setRGB(16 * 3 + 5, 16 + 7, Color.WHITE.getRGB());

        assertThat(PaletteSwatch.read(img, 32).bySwatch)
                .isFalse();
    }

    @Test
    @DisplayName("an image of another shape supplies its distinct colors, capped at the palette size")
    void otherShapeFallsBack()
    {
        BufferedImage img = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 10; x++)
            img.setRGB(x, 0, new Color(8 * x, 0, 0).getRGB());

        PaletteSwatch read = PaletteSwatch.read(img, 4);

        assertThat(read.bySwatch)
                .isFalse();
        assertThat(read.unique)
                .isEqualTo(4);
        assertThat(read.colors)
                .containsExactly(Color.BLACK, new Color(8, 0, 0), new Color(16, 0, 0), new Color(24, 0, 0));
    }

    @Test
    @DisplayName("gridCell rejects images whose width or height does not fit the grid")
    void gridCellRejectsOtherShapes()
    {
        assertThat(PaletteSwatch.gridCell(new BufferedImage(256, 16, BufferedImage.TYPE_INT_RGB), 16))
                .isEqualTo(16);
        assertThat(PaletteSwatch.gridCell(new BufferedImage(260, 16, BufferedImage.TYPE_INT_RGB), 16))
                .isEqualTo(0);
        assertThat(PaletteSwatch.gridCell(new BufferedImage(256, 32, BufferedImage.TYPE_INT_RGB), 16))
                .isEqualTo(0);
        assertThat(PaletteSwatch.gridCell(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), 16))
                .isEqualTo(0);
    }
}
