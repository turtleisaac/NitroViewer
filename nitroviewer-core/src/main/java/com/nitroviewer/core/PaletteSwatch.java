/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

/** Palette colors read from an imported image, by cell position when the image is a swatch grid. */
final class PaletteSwatch
{
    /** Swatch columns in an exported palette PNG (paletteToPng in PaletteViewer.tsx). */
    static final int COLUMNS = 16;

    final Color[] colors;
    final int unique;
    final boolean bySwatch;

    private PaletteSwatch(Color[] colors, int unique, boolean bySwatch)
    {
        this.colors = colors;
        this.unique = unique;
        this.bySwatch = bySwatch;
    }

    /** Reads {@code count} colors: one per cell of a solid swatch grid, else the image's distinct colors padded with black. */
    static PaletteSwatch read(BufferedImage img, int count)
    {
        int cell = gridCell(img, count);
        if (cell > 0 && allSolid(img, count, cell))
        {
            Color[] colors = readGrid(img, count, cell);
            return new PaletteSwatch(colors, new HashSet<>(Arrays.asList(colors)).size(), true);
        }

        Set<Integer> rgbs = distinctRgb(img, count);
        return new PaletteSwatch(padded(rgbs, count), rgbs.size(), false);
    }

    /** Side of one cell when the image is shaped like a {@link #COLUMNS}-wide grid of {@code count} square cells, else 0. */
    static int gridCell(BufferedImage img, int count)
    {
        int rows = (count + COLUMNS - 1) / COLUMNS;
        int cell = img.getWidth() / COLUMNS;
        boolean fits = img.getWidth() == cell * COLUMNS && img.getHeight() == cell * rows;
        return fits ? cell : 0;
    }

    /** True when each of the first {@code count} grid cells is one solid color. */
    static boolean allSolid(BufferedImage img, int count, int cell)
    {
        for (int i = 0; i < count; i++)
        {
            if (!isSolid(img, (i % COLUMNS) * cell, (i / COLUMNS) * cell, cell))
                return false;
        }

        return true;
    }

    /** True when every pixel of the {@code size} square at ({@code x0}, {@code y0}) has the same RGB. */
    static boolean isSolid(BufferedImage img, int x0, int y0, int size)
    {
        int rgb = img.getRGB(x0, y0) & 0xFFFFFF;
        for (int y = y0; y < y0 + size; y++)
        {
            for (int x = x0; x < x0 + size; x++)
            {
                if ((img.getRGB(x, y) & 0xFFFFFF) != rgb)
                    return false;
            }
        }

        return true;
    }

    /** The color of each of the first {@code count} grid cells, in index order. */
    static Color[] readGrid(BufferedImage img, int count, int cell)
    {
        Color[] colors = new Color[count];
        for (int i = 0; i < count; i++)
            colors[i] = new Color(img.getRGB((i % COLUMNS) * cell, (i / COLUMNS) * cell) & 0xFFFFFF);

        return colors;
    }

    /** Up to {@code limit} distinct RGB values in raster order. */
    static Set<Integer> distinctRgb(BufferedImage img, int limit)
    {
        Set<Integer> rgbs = new LinkedHashSet<>();
        for (int y = 0; y < img.getHeight(); y++)
        {
            for (int x = 0; x < img.getWidth() && rgbs.size() < limit; x++)
                rgbs.add(img.getRGB(x, y) & 0xFFFFFF);
        }

        return rgbs;
    }

    /** {@code rgbs} as colors, padded with black to {@code count}. */
    static Color[] padded(Set<Integer> rgbs, int count)
    {
        Color[] colors = new Color[count];
        Arrays.fill(colors, Color.BLACK);

        int i = 0;
        for (int rgb : rgbs)
            colors[i++] = new Color(rgb);

        return colors;
    }
}
