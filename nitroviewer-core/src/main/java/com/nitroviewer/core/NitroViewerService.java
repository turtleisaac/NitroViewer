/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

/**
 * The transport-agnostic contract between the NitroViewer frontend and Nds4j. Implemented by
 * {@link CheerpjFacade} for the in-browser (CheerpJ) runtime; an HTTP backend could implement the
 * same interface without the frontend noticing.
 * <p>
 * Conventions, all learned from the Phase-0 CheerpJ spike:
 * <ul>
 *   <li>Parameters and returns are only {@code int}, {@code boolean}, {@code byte[]} or
 *       {@code String} (JSON / base64). Never a live Nds4j object, never a {@code long}.</li>
 *   <li>Nothing throws across the boundary. Every method returns JSON; failures come back as
 *       {@code {"error":"..."}} (or {@code {"ok":false,...}} for {@link #openRom}).</li>
 *   <li>A <em>resource</em> is addressed by a (container, id) pair: {@code container < 0} means a
 *       top-level ROM file with that id; {@code container >= 0} means index {@code id} inside the
 *       open NARC with that narc-handle. Bytes are transparently LZ-decompressed when needed.</li>
 * </ul>
 */
public interface NitroViewerService
{
    // --- session ---
    /** @return {"ok":true,"handle":int,"len":int} | {"ok":false,"error":str,"len":int} */
    String openRom(byte[] romBytes);

    /** @return {"title","gameCode","numFiles"} */
    String getRomInfo(int romHandle);

    void closeRom(int romHandle);

    // --- filesystem ---
    /** @return recursive {"name","folders":[...],"files":[{"name","id"}]} */
    String listTree(int romHandle);

    /** @return {"format":str,"compressed":bool,"size":int} for the addressed resource */
    String detectFormat(int romHandle, int container, int id);

    // --- NARC ---
    /** @return {"narcHandle":int,"numFiles":int} | {"error":str} */
    String openNarc(int romHandle, int romFileId);

    /**
     * Open a NARC addressed by a (container,id) resource: {@code container < 0} = a ROM file;
     * {@code container >= 0} = sub-file {@code id} of the open NARC with that handle (a NARC-in-NARC).
     * Edits repack up the chain (see writeResource). {@code openNarc} is the {@code container < 0} case.
     * @return {"narcHandle":int,"numFiles":int} | {"error":str}
     */
    String openNarcAt(int romHandle, int container, int id);

    /** @return {"files":[{"index","size","format"}]} */
    String listNarc(int narcHandle);

    // --- 2D graphics decode (each returns {"width","height","png"} | {"error"}) ---
    String decodeNcgr(int romHandle,
                      int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                      int tilesWidth, boolean transparent, int paletteIndex);

    /** @return {"count":int,"colors":["#rrggbb",...]} | {"error"} */
    String decodePalette(int romHandle, int nclrContainer, int nclrId);

    String decodeNscr(int romHandle,
                      int nscrContainer, int nscrId, int ncgrContainer, int ncgrId,
                      int nclrContainer, int nclrId, boolean transparent);

    /** @return {"cellCount":int} | {"error"} */
    String decodeNcerMeta(int romHandle, int ncerContainer, int ncerId);

    String decodeNcer(int romHandle,
                      int ncerContainer, int ncerId, int ncgrContainer, int ncgrId,
                      int nclrContainer, int nclrId, int cellIndex, boolean transparent);

    /** @return {"animations":[{"frames":int}]} | {"error"} */
    String decodeNanrMeta(int romHandle, int nanrContainer, int nanrId);

    String decodeNanr(int romHandle,
                      int nanrContainer, int nanrId, int ncerContainer, int ncerId,
                      int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                      int animIndex, int frameIndex, boolean transparent);

    // --- export ---
    /** @return {"name":str,"size":int,"base64":str} raw (as-stored) bytes | {"error"} */
    String exportRaw(int romHandle, int container, int id);

    // --- import / save (the write half) ---
    /**
     * Replace the bytes of the addressed resource. For a ROM file ({@code container < 0}):
     * {@code rom.setFile(id, bytes)}. For a NARC entry ({@code container >= 0}): update the sub-file
     * then repack the whole NARC back into the ROM file it came from (tracked at {@link #openNarc}).
     * Bytes are written as-given (uncompressed); no re-LZ is applied.
     *
     * @return {"ok":true,"size":int} | {"ok":false,"error":str}
     */
    String importRaw(int romHandle, int container, int id, byte[] bytes);

    /**
     * Serialise the (possibly edited) ROM to a complete {@code .nds} image. Returns the raw
     * {@code byte[]} (CheerpJ marshals it to a JS {@code Int8Array}); the transport wraps it in a
     * Blob for download. This is the one path that returns a large binary rather than JSON — on
     * failure it returns a zero-length array (call {@link #lastError()} for the message).
     *
     * @return the ROM bytes, or an empty array on failure
     */
    byte[] saveRom(int romHandle);

    /** @return the message from the most recent {@link #saveRom} failure, or "" if none. */
    String lastError();

    /**
     * Import a PNG (or any {@link javax.imageio.ImageIO}-decodable image) over an existing NCGR sprite,
     * propagating the edit down into the NCGR (and, when {@code rebuildPalette}, the NCLR). The image
     * must match the sprite's pixel dimensions. Quantisation is headless (Nds4j
     * {@code IndexedImage.applyImageMatched}/{@code applyImageQuantized}).
     * <ul>
     *   <li>{@code rebuildPalette=false} — match each pixel to the nearest colour in the sprite's
     *       current (sub-)palette; the NCLR is untouched. {@code unmatched} reports how many pixels
     *       weren't an exact palette colour.</li>
     *   <li>{@code rebuildPalette=true} — median-cut a fresh palette from the image and write both the
     *       NCGR and the affected NCLR (sub-)palette block.</li>
     *   <li>{@code dryRun=true} — compute {@code unmatched} without writing anything (for the
     *       match-vs-rebuild prompt).</li>
     * </ul>
     * For 4bpp sprites {@code paletteIndex} selects which 16-colour sub-palette to match/rebuild.
     *
     * @return {"ok":true,"width","height","unmatched":int,"paletteRebuilt":bool,"dryRun":bool}
     *         | {"ok":false,"error":str}
     */
    String importPng(int romHandle, int ncgrContainer, int ncgrId, int nclrContainer, int nclrId,
                     int paletteIndex, int tilesWidth, boolean rebuildPalette, boolean dryRun,
                     byte[] pngBytes);

    // --- 3D (static models) ---
    /** @return {"hasEmbeddedTextures":bool,"models":["name",...]} | {"error"} for an NSBMD */
    String getModelSetInfo(int romHandle, int container, int id);

    /** @return {"textures":[{"name","width","height","png"}]} | {"error"} for an NSBTX */
    String decodeTextureSet(int romHandle, int container, int id);

    /** @return {"nodeCount","meshes":[{"material","node"}]} — maps a model's meshes to material name + node */
    String getModelRig(int romHandle, int container, int id, int modelIndex);

    /**
     * Export one model from an NSBMD to a self-contained glTF 2.0 string (embedded geometry +
     * base64 PNG textures). Textures come from the model set's embedded TEX0 when {@code nsbtxId < 0},
     * otherwise from the NSBTX at {@code (nsbtxContainer, nsbtxId)}.
     *
     * When {@code nsbcaId >= 0}, the NSBCA's skeletal animations are baked into the glTF (as glTF
     * animations three.js can play); {@code nsbcaId < 0} exports a static model.
     *
     * @return raw glTF JSON on success, or a string beginning {@code "ERROR: "} on failure — this one
     *         method returns raw glTF rather than the JSON-wrapped contract, to avoid double-escaping
     *         a large document.
     */
    String exportModelGltf(int romHandle, int nsbmdContainer, int nsbmdId, int modelIndex,
                           int nsbtxContainer, int nsbtxId, int nsbcaContainer, int nsbcaId);

    // --- 3D animation tracks with no glTF path (driven in three.js from this per-frame data) ---
    /** @return {"frameCount","materials":[{"name","diffuse":["#rrggbb"/frame],"alpha":[0..1/frame]}]} (NSBMA) */
    String getMaterialColorAnim(int romHandle, int container, int id, int animIndex);

    /** @return {"frameCount","nodeCount","visible":[[0/1 per frame] per node]} (NSBVA) */
    String getVisibilityAnim(int romHandle, int container, int id, int animIndex);

    /**
     * @return {"frameCount","materials":[{"name","frames":["texName"/frame]}],"textures":{name:dataURL}} (NSBTP).
     * Texture images resolve from the NSBTX at (nsbtxContainer,nsbtxId) when nsbtxId>=0, else the model's
     * embedded TEX0 at (nsbmdContainer,nsbmdId).
     */
    String getTexturePatternAnim(int romHandle, int nsbtpContainer, int nsbtpId, int animIndex,
                                 int nsbmdContainer, int nsbmdId, int nsbtxContainer, int nsbtxId);

    /**
     * Render an SPA particle effect to a sequence of frames (Nds4j's ParticleRenderer simulates the
     * whole archive over a dark background).
     * @return {"emitterCount":int,"frames":["dataURL",...]} | {"error"}
     */
    String renderParticles(int romHandle, int container, int id, int width, int height, int frameCount);
}
