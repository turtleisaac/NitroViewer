/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import io.github.turtleisaac.nds4j.Fnt;
import io.github.turtleisaac.nds4j.Narc;
import io.github.turtleisaac.nds4j.NintendoDsRom;
import io.github.turtleisaac.nds4j.framework.NitroLz;
import io.github.turtleisaac.nds4j.g3d.GltfExporter;
import io.github.turtleisaac.nds4j.g3d.MaterialColorAnimationSet;
import io.github.turtleisaac.nds4j.g3d.Model;
import io.github.turtleisaac.nds4j.g3d.ModelSet;
import io.github.turtleisaac.nds4j.g3d.ParticleRenderer;
import io.github.turtleisaac.nds4j.g3d.ParticleSet;
import io.github.turtleisaac.nds4j.g3d.SkeletalAnimationSet;
import io.github.turtleisaac.nds4j.g3d.TexturePatternAnimationSet;
import io.github.turtleisaac.nds4j.g3d.TextureSet;
import io.github.turtleisaac.nds4j.g3d.VisibilityAnimationSet;
import io.github.turtleisaac.nds4j.images.CellAnimation;
import io.github.turtleisaac.nds4j.images.CellBank;
import io.github.turtleisaac.nds4j.images.IndexedImage;
import io.github.turtleisaac.nds4j.images.Palette;
import io.github.turtleisaac.nds4j.images.Screen;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-browser (CheerpJ) implementation of {@link NitroViewerService} over Nds4j. Instantiated once
 * by the frontend; holds open ROMs and NARCs keyed by integer handles. See the interface for the
 * calling conventions (all returns are JSON; nothing throws across the boundary).
 */
public final class CheerpjFacade implements NitroViewerService
{
    private final Map<Integer, NintendoDsRom> roms = new ConcurrentHashMap<>();
    private final Map<Integer, Narc> narcs = new ConcurrentHashMap<>();
    private final AtomicInteger romSeq = new AtomicInteger(1);
    private final AtomicInteger narcSeq = new AtomicInteger(1);

    // --- session -----------------------------------------------------------------------------

    @Override
    public String openRom(byte[] romBytes)
    {
        int len = romBytes == null ? -1 : romBytes.length;
        try
        {
            int handle = romSeq.getAndIncrement();
            roms.put(handle, new NintendoDsRom(romBytes));
            return "{\"ok\":true,\"handle\":" + handle + ",\"len\":" + len + "}";
        }
        catch (Throwable t)
        {
            return "{\"ok\":false,\"error\":" + jstr(describe(t)) + ",\"len\":" + len + "}";
        }
    }

    @Override
    public String getRomInfo(int romHandle)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            return "{\"title\":" + jstr(rom.getTitle())
                    + ",\"gameCode\":" + jstr(rom.getGameCode())
                    + ",\"numFiles\":" + rom.getNumFiles() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public void closeRom(int romHandle)
    {
        roms.remove(romHandle);
    }

    // --- filesystem --------------------------------------------------------------------------

    @Override
    public String listTree(int romHandle)
    {
        try
        {
            Fnt.Folder root = Fnt.load(rom(romHandle).getFnt());
            StringBuilder sb = new StringBuilder();
            writeFolder(sb, "/", root);
            return sb.toString();
        }
        catch (Throwable t) { return err(t); }
    }

    private void writeFolder(StringBuilder sb, String name, Fnt.Folder folder)
    {
        sb.append("{\"name\":").append(jstr(name)).append(",\"folders\":[");
        boolean first = true;
        for (Map.Entry<String, Fnt.Folder> e : folder.getFolders().entrySet())
        {
            if (!first) sb.append(',');
            first = false;
            writeFolder(sb, e.getKey(), e.getValue());
        }
        sb.append("],\"files\":[");
        int id = folder.getFirstId();
        first = true;
        for (String fileName : folder.getFiles())
        {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(jstr(fileName)).append(",\"id\":").append(id).append('}');
            id++;
        }
        sb.append("]}");
    }

    @Override
    public String detectFormat(int romHandle, int container, int id)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            byte[] raw = resolveRaw(rom, container, id);
            byte[] data = maybeDecompress(raw);
            boolean compressed = data != raw;
            return "{\"format\":" + jstr(formatOf(data))
                    + ",\"compressed\":" + compressed
                    + ",\"size\":" + raw.length + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    // --- NARC --------------------------------------------------------------------------------

    @Override
    public String openNarc(int romHandle, int romFileId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            byte[] raw = rom.getFile(romFileId);
            byte[] data = maybeDecompress(raw);
            Narc narc = new Narc(data);
            int handle = narcSeq.getAndIncrement();
            narcs.put(handle, narc);
            return "{\"narcHandle\":" + handle + ",\"numFiles\":" + narc.getNumFiles() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String listNarc(int narcHandle)
    {
        try
        {
            Narc narc = narc(narcHandle);
            StringBuilder sb = new StringBuilder("{\"files\":[");
            for (int i = 0; i < narc.getNumFiles(); i++)
            {
                if (i > 0) sb.append(',');
                byte[] raw = narc.getFile(i);
                byte[] data = maybeDecompress(raw);
                sb.append("{\"index\":").append(i)
                        .append(",\"size\":").append(raw.length)
                        .append(",\"format\":").append(jstr(formatOf(data))).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- 2D decode ---------------------------------------------------------------------------

    @Override
    public String decodeNcgr(int romHandle, int ncgrContainer, int ncgrId,
                             int nclrContainer, int nclrId, int tilesWidth,
                             boolean transparent, int paletteIndex)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, tilesWidth);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);

            // 4bpp images index into 16-colour sub-palettes; select which one. 8bpp uses all 256.
            Color[] colors = pal.getColors();
            int subPalettes = ncgr.getBitDepth() == 4 ? Math.max(1, colors.length / 16) : 1;
            if (ncgr.getBitDepth() == 4 && colors.length > 16)
            {
                int idx = Math.max(0, Math.min(paletteIndex, subPalettes - 1));
                pal = new Palette(Arrays.copyOfRange(colors, idx * 16, idx * 16 + 16));
            }

            ncgr.setPalette(pal);
            BufferedImage img = transparent ? ncgr.getTransparentImage() : ncgr.getImage();
            return imageJson(img, subPalettes);
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodePalette(int romHandle, int nclrContainer, int nclrId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            Color[] colors = pal.getColors();
            StringBuilder sb = new StringBuilder("{\"count\":").append(colors.length).append(",\"colors\":[");
            for (int i = 0; i < colors.length; i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(hex(colors[i])));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNscr(int romHandle, int nscrContainer, int nscrId,
                             int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                             boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            Screen screen = new Screen(resolve(rom, nscrContainer, nscrId));
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            Palette pal = new Palette(resolve(rom, nclrContainer, nclrId), 0);
            return imageJson(transparent ? screen.getTransparentImage(ncgr, pal)
                                         : screen.getImage(ncgr, pal));
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNcerMeta(int romHandle, int ncerContainer, int ncerId)
    {
        try
        {
            CellBank bank = new CellBank(resolve(rom(romHandle), ncerContainer, ncerId));
            return "{\"cellCount\":" + bank.getNumCells() + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNcer(int romHandle, int ncerContainer, int ncerId,
                             int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                             int cellIndex, boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            ncgr.setPalette(new Palette(resolve(rom, nclrContainer, nclrId), 0));
            CellBank bank = new CellBank(resolve(rom, ncerContainer, ncerId));
            bank.setParentImage(ncgr);
            return imageJson(transparent ? bank.getTransparentNcerImage(cellIndex)
                                         : bank.getNcerImage(cellIndex));
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNanrMeta(int romHandle, int nanrContainer, int nanrId)
    {
        try
        {
            CellAnimation anim = new CellAnimation(resolve(rom(romHandle), nanrContainer, nanrId));
            CellAnimation.Animation[] animations = anim.getAnimations();
            StringBuilder sb = new StringBuilder("{\"animations\":[");
            for (int i = 0; i < animations.length; i++)
            {
                if (i > 0) sb.append(',');
                sb.append("{\"frames\":").append(animations[i].getFrames().length).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String decodeNanr(int romHandle, int nanrContainer, int nanrId,
                             int ncerContainer, int ncerId, int ncgrContainer, int ncgrId,
                             int nclrContainer, int nclrId, int animIndex, int frameIndex,
                             boolean transparent)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            IndexedImage ncgr = ncgr(rom, ncgrContainer, ncgrId, 0);
            ncgr.setPalette(new Palette(resolve(rom, nclrContainer, nclrId), 0));
            CellBank bank = new CellBank(resolve(rom, ncerContainer, ncerId));
            bank.setParentImage(ncgr);
            CellAnimation anim = new CellAnimation(resolve(rom, nanrContainer, nanrId));
            anim.setCellBank(bank);
            CellAnimation.Animation.Frame frame = anim.getAnimations()[animIndex].getFrames()[frameIndex];
            return imageJson(anim.getFrameImage(frame));
        }
        catch (Throwable t) { return err(t); }
    }

    // --- export ------------------------------------------------------------------------------

    @Override
    public String exportRaw(int romHandle, int container, int id)
    {
        try
        {
            byte[] raw = resolveRaw(rom(romHandle), container, id);
            return "{\"size\":" + raw.length + ",\"base64\":" + jstr(base64(raw)) + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    // --- 3D (static models) ------------------------------------------------------------------

    @Override
    public String getModelSetInfo(int romHandle, int container, int id)
    {
        try
        {
            ModelSet ms = new ModelSet(resolve(rom(romHandle), container, id));
            List<Model> models = ms.getModels();
            StringBuilder sb = new StringBuilder("{\"hasEmbeddedTextures\":")
                    .append(ms.hasEmbeddedTextures()).append(",\"models\":[");
            for (int i = 0; i < models.size(); i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(models.get(i).getName()));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String exportModelGltf(int romHandle, int nsbmdContainer, int nsbmdId, int modelIndex,
                                  int nsbtxContainer, int nsbtxId, int nsbcaContainer, int nsbcaId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            ModelSet ms = new ModelSet(resolve(rom, nsbmdContainer, nsbmdId));
            List<Model> models = ms.getModels();
            if (modelIndex < 0 || modelIndex >= models.size())
                return "ERROR: model index " + modelIndex + " out of range (" + models.size() + ")";

            // Textures are optional: an explicit NSBTX, else the embedded TEX0, else untextured
            // (GltfExporter accepts a null TextureSet and emits materials without textures).
            TextureSet tex = null;
            if (nsbtxId >= 0)
                tex = new TextureSet(resolve(rom, nsbtxContainer, nsbtxId));
            else if (ms.hasEmbeddedTextures())
                tex = ms.getEmbeddedTextures();

            Model model = models.get(modelIndex);
            if (nsbcaId >= 0)
            {
                // Bake the NSBCA's skeletal animations into the glTF (three.js plays them natively).
                SkeletalAnimationSet anims = new SkeletalAnimationSet(resolve(rom, nsbcaContainer, nsbcaId));
                return GltfExporter.toGltf(model, tex, anims.getAnimations(), null);
            }
            return GltfExporter.toGltf(model, tex);
        }
        catch (Throwable t)
        {
            return "ERROR: " + describe(t);
        }
    }

    @Override
    public String decodeTextureSet(int romHandle, int container, int id)
    {
        try
        {
            TextureSet ts = new TextureSet(resolve(rom(romHandle), container, id));
            StringBuilder sb = new StringBuilder("{\"textures\":[");
            boolean first = true;
            for (TextureSet.Texture tex : ts.getTextures())
            {
                String png;
                try { png = pngDataUrl(ts.getImage(tex)); }
                catch (Throwable e) { continue; } // skip textures that fail to decode
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":").append(jstr(tex.getName()))
                        .append(",\"width\":").append(tex.getWidth())
                        .append(",\"height\":").append(tex.getHeight())
                        .append(",\"png\":").append(jstr(png))
                        .append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getModelRig(int romHandle, int container, int id, int modelIndex)
    {
        try
        {
            Model m = new ModelSet(resolve(rom(romHandle), container, id)).getModels().get(modelIndex);
            List<Model.Mesh> meshes = m.getMeshes();
            StringBuilder sb = new StringBuilder("{\"nodeCount\":").append(m.getNodeCount()).append(",\"meshes\":[");
            for (int i = 0; i < meshes.size(); i++)
            {
                if (i > 0) sb.append(',');
                Model.Mesh mesh = meshes.get(i);
                sb.append("{\"material\":").append(jstr(mesh.getMaterial().getName()))
                        .append(",\"node\":").append(mesh.getNodeIndex()).append('}');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- 3D animation tracks with no glTF path (driven in three.js from this data) ------------

    @Override
    public String getMaterialColorAnim(int romHandle, int container, int id, int animIndex)
    {
        try
        {
            MaterialColorAnimationSet set = new MaterialColorAnimationSet(resolve(rom(romHandle), container, id));
            MaterialColorAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();
            StringBuilder sb = new StringBuilder("{\"frameCount\":").append(fc).append(",\"materials\":[");
            boolean first = true;
            for (MaterialColorAnimationSet.MaterialColor mc : anim.getMaterials())
            {
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":").append(jstr(mc.getName())).append(",\"diffuse\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(jstr(String.format("#%06x", mc.getDiffuse().rgbAt(f) & 0xFFFFFF)));
                }
                sb.append("],\"alpha\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(String.format("%.4f", mc.getAlpha().at(f) / 31.0));
                }
                sb.append("]}");
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getVisibilityAnim(int romHandle, int container, int id, int animIndex)
    {
        try
        {
            VisibilityAnimationSet set = new VisibilityAnimationSet(resolve(rom(romHandle), container, id));
            VisibilityAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();
            int nc = anim.getNodeCount();
            StringBuilder sb = new StringBuilder("{\"frameCount\":").append(fc)
                    .append(",\"nodeCount\":").append(nc).append(",\"visible\":[");
            for (int n = 0; n < nc; n++)
            {
                if (n > 0) sb.append(',');
                sb.append('[');
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) sb.append(',');
                    sb.append(anim.isVisible(n, f) ? '1' : '0');
                }
                sb.append(']');
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String getTexturePatternAnim(int romHandle, int nsbtpContainer, int nsbtpId, int animIndex,
                                        int nsbmdContainer, int nsbmdId, int nsbtxContainer, int nsbtxId)
    {
        try
        {
            NintendoDsRom rom = rom(romHandle);
            TexturePatternAnimationSet set = new TexturePatternAnimationSet(resolve(rom, nsbtpContainer, nsbtpId));
            TexturePatternAnimationSet.Animation anim = set.getAnimations().get(animIndex);
            int fc = anim.getFrameCount();

            TextureSet tex = null;
            try
            {
                if (nsbtxId >= 0)
                    tex = new TextureSet(resolve(rom, nsbtxContainer, nsbtxId));
                else if (nsbmdId >= 0)
                    tex = new ModelSet(resolve(rom, nsbmdContainer, nsbmdId)).getEmbeddedTextures();
            }
            catch (Throwable e) { tex = null; } // no textures available — still return frame patterns

            java.util.LinkedHashSet<String> texNames = new java.util.LinkedHashSet<>();
            StringBuilder mats = new StringBuilder("[");
            boolean first = true;
            for (TexturePatternAnimationSet.MaterialPattern mp : anim.getMaterials())
            {
                if (!first) mats.append(',');
                first = false;
                mats.append("{\"name\":").append(jstr(mp.getName())).append(",\"frames\":[");
                for (int f = 0; f < fc; f++)
                {
                    if (f > 0) mats.append(',');
                    String tn = mp.at(f).getTexture();
                    texNames.add(tn);
                    mats.append(jstr(tn));
                }
                mats.append("]}");
            }
            mats.append(']');

            StringBuilder texs = new StringBuilder("{");
            boolean tf = true;
            for (String tn : texNames)
            {
                String dataUrl;
                try { dataUrl = pngDataUrl(tex.getImage(tn)); }
                catch (Throwable e) { continue; }
                if (!tf) texs.append(',');
                tf = false;
                texs.append(jstr(tn)).append(':').append(jstr(dataUrl));
            }
            texs.append('}');

            return "{\"frameCount\":" + fc + ",\"materials\":" + mats + ",\"textures\":" + texs + "}";
        }
        catch (Throwable t) { return err(t); }
    }

    @Override
    public String renderParticles(int romHandle, int container, int id, int width, int height, int frameCount)
    {
        try
        {
            ParticleSet set = new ParticleSet(resolve(rom(romHandle), container, id));
            java.util.List<BufferedImage> frames = new ParticleRenderer(width, height).render(set, frameCount);
            StringBuilder sb = new StringBuilder("{\"emitterCount\":").append(set.getEmitterCount())
                    .append(",\"frames\":[");
            for (int i = 0; i < frames.size(); i++)
            {
                if (i > 0) sb.append(',');
                sb.append(jstr(pngDataUrl(frames.get(i))));
            }
            return sb.append("]}").toString();
        }
        catch (Throwable t) { return err(t); }
    }

    // --- resolution helpers ------------------------------------------------------------------

    private NintendoDsRom rom(int handle)
    {
        NintendoDsRom rom = roms.get(handle);
        if (rom == null) throw new IllegalArgumentException("no ROM for handle " + handle);
        return rom;
    }

    private Narc narc(int handle)
    {
        Narc narc = narcs.get(handle);
        if (narc == null) throw new IllegalArgumentException("no NARC for handle " + handle);
        return narc;
    }

    /** Raw (as-stored) bytes for a (container,id): container &lt; 0 =&gt; ROM file, else NARC entry. */
    private byte[] resolveRaw(NintendoDsRom rom, int container, int id)
    {
        return container < 0 ? rom.getFile(id) : narc(container).getFile(id);
    }

    /** Resolved bytes, LZ-decompressed if needed — the form the format parsers expect. */
    private byte[] resolve(NintendoDsRom rom, int container, int id)
    {
        return maybeDecompress(resolveRaw(rom, container, id));
    }

    /**
     * Decompress {@code raw} if it looks LZ-compressed, but fall back to the raw bytes if decompression
     * fails: {@link NitroLz#isCompressed} is a header-nibble heuristic that false-positives on some
     * uncompressed files (e.g. sub-files of Platinum's area_build.narc), where decompress would
     * otherwise throw an ArrayIndexOutOfBoundsException from a bogus back-reference.
     */
    private static byte[] maybeDecompress(byte[] raw)
    {
        if (!NitroLz.isCompressed(raw))
            return raw;
        try
        {
            return NitroLz.decompress(raw);
        }
        catch (Throwable t)
        {
            return raw;
        }
    }

    /** 0 tilesWidth/bitDepth => Nds4j reads the geometry from the NCGR header. */
    private IndexedImage ncgr(NintendoDsRom rom, int container, int id, int tilesWidth)
    {
        return new IndexedImage(resolve(rom, container, id), tilesWidth, 0, 1, 1, true);
    }

    // --- encoding helpers --------------------------------------------------------------------

    private static String imageJson(BufferedImage img)
    {
        return imageJson(img, 1);
    }

    private static String imageJson(BufferedImage img, int subPalettes)
    {
        return "{\"width\":" + img.getWidth() + ",\"height\":" + img.getHeight()
                + ",\"subPalettes\":" + subPalettes
                + ",\"png\":" + jstr(pngDataUrl(img)) + "}";
    }

    private static String pngDataUrl(BufferedImage img)
    {
        try
        {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + base64(baos.toByteArray());
        }
        catch (Exception e)
        {
            throw new RuntimeException("PNG encode failed: " + e.getMessage(), e);
        }
    }

    private static String base64(byte[] b)
    {
        return Base64.getEncoder().encodeToString(b);
    }

    private static String hex(Color c)
    {
        return String.format("#%02x%02x%02x", c.getRed(), c.getGreen(), c.getBlue());
    }

    private static String magic(byte[] d)
    {
        return d == null || d.length < 4 ? "" : new String(d, 0, 4, StandardCharsets.ISO_8859_1);
    }

    /** Friendly format name from the 4-char stamp (stamps are byte-reversed on disk). */
    private static String formatOf(byte[] d)
    {
        switch (magic(d))
        {
            case "NARC": return "NARC";
            case "RGCN": return "NCGR";
            case "RLCN": case "RPCN": return "NCLR";
            case "RCSN": return "NSCR";
            case "RECN": return "NCER";
            case "RNAN": return "NANR";
            case "BMD0": return "NSBMD";
            case "BTX0": return "NSBTX";
            case "BCA0": return "NSBCA";
            case "BTP0": return "NSBTP";
            case "BTA0": return "NSBTA";
            case "BVA0": return "NSBVA";
            case "BMA0": return "NSBMA";
            case " APS": return "SPA";
            default: return "";
        }
    }

    private static String describe(Throwable t)
    {
        String msg = t.getMessage();
        return t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg);
    }

    private static String err(Throwable t)
    {
        return "{\"error\":" + jstr(describe(t)) + "}";
    }

    /** Encode a Java string as a JSON string literal (quotes + minimal escaping). null -&gt; "null". */
    private static String jstr(String s)
    {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++)
        {
            char c = s.charAt(i);
            switch (c)
            {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
