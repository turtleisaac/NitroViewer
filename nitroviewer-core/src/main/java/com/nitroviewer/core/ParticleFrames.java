/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.g3d.ParticleRenderer;
import io.github.turtleisaac.nds4j.g3d.ParticleSet;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.List;

/**
 * SPA preview JSON. A positive rate is forwarded to the renderer, which supplies the frame delays.
 */
final class ParticleFrames
{
    private ParticleFrames()
    {
    }

    /**
     * Renders {@code spa} and returns the preview JSON, including delays when the rate is positive.
     */
    static String render(byte[] spa, int width, int height, int frameCount, double ticksPerSecond) throws IOException
    {
        ParticleSet set = new ParticleSet(spa);
        ParticleRenderer renderer = new ParticleRenderer(width, height);
        applyRate(renderer, ticksPerSecond);
        List<BufferedImage> frames = renderer.render(set, frameCount);
        int[] delays = schedule(renderer, frames.size(), ticksPerSecond);
        return document(set.getEmitterCount(), frames, delays);
    }

    /** Stores a positive rate on the renderer. */
    private static void applyRate(ParticleRenderer renderer, double ticksPerSecond)
    {
        if (ticksPerSecond > 0)
        {
            renderer.ticksPerSecond(ticksPerSecond);
        }
    }

    /** Frame delays from the renderer, or null when no rate was given. */
    private static int[] schedule(ParticleRenderer renderer, int frames, double ticksPerSecond)
    {
        if (ticksPerSecond > 0)
        {
            return renderer.frameDelaysCs(frames);
        }

        return null;
    }

    /** Assembles the preview JSON object. */
    private static String document(int emitterCount, List<BufferedImage> frames, int[] delays) throws IOException
    {
        StringBuilder json = new StringBuilder();
        json.append("{\"emitterCount\":").append(emitterCount).append(",\"frames\":[");
        appendFrames(json, frames);
        json.append(']');
        appendDelays(json, delays);
        json.append('}');
        return json.toString();
    }

    /** Appends each frame as a quoted PNG data URL. */
    private static void appendFrames(StringBuilder json, List<BufferedImage> frames) throws IOException
    {
        for (int index = 0; index < frames.size(); index++)
        {
            if (index > 0)
            {
                json.append(',');
            }

            json.append(quotedPng(frames.get(index)));
        }
    }

    /** Appends {@code delaysCs} when the renderer produced a schedule. */
    private static void appendDelays(StringBuilder json, int[] delays)
    {
        if (delays == null)
        {
            return;
        }

        json.append(",\"delaysCs\":[");
        for (int index = 0; index < delays.length; index++)
        {
            if (index > 0)
            {
                json.append(',');
            }

            json.append(delays[index]);
        }
        json.append(']');
    }

    /** One PNG data URL, quoted for JSON. */
    private static String quotedPng(BufferedImage image) throws IOException
    {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        String encoded = Base64.getEncoder().encodeToString(bytes.toByteArray());
        return "\"data:image/png;base64," + encoded + "\"";
    }
}
