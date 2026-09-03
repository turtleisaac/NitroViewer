// The transport-agnostic client contract. CheerpjTransport implements it today; an HttpTransport
// could implement the same interface against a Java backend without any UI change.

/** A resource is addressed by (container, id): container < 0 = a top-level ROM file with that id;
 *  container >= 0 = index `id` inside the open NARC with that narc-handle. */
export interface ResourceRef {
  container: number;
  id: number;
}

export const ROM_CONTAINER = -1;
/** Sentinel container addressing the ROM's icon/title banner (not a FAT file). Routed through the same
 *  (container,id) plumbing as files so it reuses extract/replace/undo/save; id is ignored (use 0). */
export const BANNER_CONTAINER = -2;
export const BANNER_REF: ResourceRef = { container: BANNER_CONTAINER, id: 0 };
export const refKey = (r: ResourceRef): string => `${r.container}:${r.id}`;

export interface RomInfo {
  title: string;
  gameCode: string;
  numFiles: number;
}

/** The ROM's icon/title banner: the 32×32 DS home-menu icon and the per-language game titles. */
export interface BannerTitle {
  language: string; // "JAPANESE" | "ENGLISH" | ... (IconBanner.Language name)
  text: string; // up to three '\n'-separated lines
}
export interface BannerInfo {
  present: boolean;
  version: number; // 0x0001/0x0002/0x0003/0x0103
  languageCount: number;
  iconPng: string; // data:image/png;base64,... (32×32, index 0 transparent)
  titles: BannerTitle[];
}

export interface TreeFile {
  name: string;
  id: number;
}
export interface TreeFolder {
  name: string;
  folders: TreeFolder[];
  files: TreeFile[];
}

export interface FormatInfo {
  format: string; // "NCGR" | "NCLR" | "NARC" | ... | "" (unknown)
  compressed: boolean;
  size: number;
}

export interface NarcEntry {
  index: number;
  size: number;
  format: string;
}

export interface DecodedImage {
  width: number;
  height: number;
  png: string; // data:image/png;base64,...
  subPalettes?: number; // number of selectable 16-color sub-palettes (NCGR); 1 if not applicable
  scanned?: boolean; // NCER/NANR over a scanned (bitmap) NCGR: shown as the raw NCGR, not composed
}

export interface PaletteData {
  count: number;
  colors: string[]; // "#rrggbb"
}

export interface IndexedRaster {
  width: number;
  height: number;
  bitDepth: number;
  scanned: boolean;
  pixels: string; // base64 of width*height bytes, row-major palette indices
}

export interface PngImportResult {
  ok: boolean;
  width: number;
  height: number;
  unmatched: number; // pixels not exactly in the existing palette (match mode)
  paletteRebuilt: boolean;
  dryRun: boolean;
}

export interface ScreenImportResult {
  ok: boolean;
  uniqueTiles: number; // distinct tiles the background reduced to (= the rebuilt NCGR's tile count)
  unmatched: number; // pixels not exactly in the (sub-)palette (match mode)
  paletteRebuilt: boolean;
  dryRun: boolean;
}

export interface ModelRig {
  nodeCount: number;
  meshes: { material: string; node: number }[];
}
export interface MaterialColorAnim {
  frameCount: number;
  materials: { name: string; diffuse: string[]; alpha: number[] }[];
}
export interface VisibilityAnim {
  frameCount: number;
  nodeCount: number;
  visible: number[][]; // visible[node][frame]
}
export interface TexturePatternAnim {
  frameCount: number;
  materials: { name: string; frames: string[] }[];
  textures: Record<string, string>; // textureName -> data URL
}

export interface SdatNamed {
  index: number;
  name: string | null;
}
export interface SdatSequence extends SdatNamed {
  bankId: number;
}
export interface SdatWaveArchive extends SdatNamed {
  waveCount: number;
}
export interface SdatInfo {
  sequences: SdatSequence[];
  banks: SdatNamed[];
  waveArchives: SdatWaveArchive[];
  streams: SdatNamed[];
  sequenceArchives: SdatNamed[];
}
export interface SeqNote {
  track: number;
  tick: number;
  duration: number;
  key: number;
  velocity: number;
  program: number;
}
export interface SequenceNotes {
  ticks: number;
  tempo: number;
  trackCount: number;
  loopStart: number; // tick, or -1 if the sequence does not loop
  loopEnd: number;
  bankId: number;
  name: string | null;
  notes: SeqNote[];
}
export interface EngineNoteRegion {
  recordType: number; // 1 = PCM, 2 = PSG square, 3 = PSG noise
  waveIndex: number; // PCM: index into the wave archive; PSG square: duty cycle low 3 bits
  waveArcIndex: number; // which of the bank's 4 wave archives (PCM only)
  baseNote: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pan: number;
}
export interface EngineInstrument {
  type: number;
  lowNote: number; // drum set (type 16) only, else 0
  splitPoints: number[] | null; // key-split (type 17) only
  regions: EngineNoteRegion[];
}
export interface EngineWave {
  sampleRate: number;
  // Raw ARM7 timer-reload value. SequencePlayer's baseTimer uses this directly when it's nonzero,
  // only falling back to a sampleRate-derived approximation otherwise — a client engine must do
  // the same, not just recompute a timer from sampleRate every time.
  timer: number;
  loops: boolean;
  loopStart: number; // decoded-PCM sample index
  loopEnd: number; // exclusive
  sampleCount: number;
  pcmBase64: string; // signed 16-bit PCM, little-endian, mono
}
export interface SequenceEngineData {
  bankId: number;
  eventData: string; // base64 raw SSEQ event bytecode
  instruments: EngineInstrument[]; // indexed by program number
  waveArchives: ({ waves: EngineWave[] } | null)[]; // exactly 4 slots, null where unresolved
}
export interface WaveInfo {
  index: number;
  sampleRate: number;
  samples: number;
  type: string;
  loops: boolean;
}
export interface WavePreview {
  sampleRate: number;
  samples: number;
  loops: boolean;
  type: string;
  png: string;
  wavBase64: string;
}
export interface StreamPreview {
  sampleRate: number;
  channels: number;
  samples: number;
  png: string;
  wavBase64: string;
}

export interface BmgMessage {
  text: string; // parts flattened to plain text; an embedded escape renders as "[type:hexdata]"
  isNull: boolean; // true = no text at all (distinct from an empty string)
  hasEscapes: boolean; // heads-up that `text` includes "[type:hexdata]" bracket tokens, not literal game text
}
export interface BmgData {
  encoding: number; // 1=cp1252, 2=UTF-16, 3=Shift-JIS, 4=UTF-8
  bigEndian: boolean;
  hasFlw1: boolean;
  hasFli1: boolean;
  count: number;
  messages: BmgMessage[];
}

export interface FontMeta {
  numGlyphs: number;
  bitDepth: number;
  cellWidth: number;
  cellHeight: number;
  lineFeed: number;
  defaultLeft: number;
  defaultGlyphWidth: number;
  defaultCharWidth: number;
}
export interface FontGlyphSheet {
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  png: string;
}
export interface FontGlyphPixels {
  width: number;
  height: number;
  pixels: string; // base64, width*height bytes, row-major intensity 0-255
}

export interface NitroViewerClient {
  init(onProgress?: (msg: string) => void): Promise<void>;

  openRom(bytes: Uint8Array): Promise<{ handle: number; len: number }>;
  /**
   * Open a ROM from an Nds4j unpacked-folder tree packed as a ZIP
   * (`NintendoDsRom.fromUnpacked`). Same return as {@link openRom}.
   */
  openUnpackedRom(zipBytes: Uint8Array): Promise<{ handle: number; len: number }>;
  getRomInfo(handle: number): Promise<RomInfo>;
  /** The ROM's icon/title banner (icon PNG + per-language titles), or `{present:false}` if it has none. */
  getBanner(handle: number): Promise<BannerInfo>;
  /** Replace the 32×32 menu icon from an image (must be 32×32, ≤15 opaque colors; index 0 = transparent). */
  setBannerIcon(handle: number, pngBytes: Uint8Array): Promise<{ ok: boolean }>;
  /** Set one language's title (≤3 '\n'-separated lines, ≤127 UTF-16 units). languageOrdinal indexes titles. */
  setBannerTitle(handle: number, languageOrdinal: number, text: string): Promise<{ ok: boolean }>;
  listTree(handle: number): Promise<TreeFolder>;
  detectFormat(handle: number, ref: ResourceRef): Promise<FormatInfo>;

  openNarc(handle: number, romFileId: number): Promise<{ narcHandle: number; numFiles: number }>;
  /** Open a NARC from any resource — a ROM file (container < 0) or a sub-file of an open NARC (nested). */
  openNarcAt(handle: number, ref: ResourceRef): Promise<{ narcHandle: number; numFiles: number }>;
  listNarc(narcHandle: number): Promise<NarcEntry[]>;
  /** Export an FNT folder subtree (or the whole filesystem for "/") as a ZIP mirroring the layout. */
  exportFolderZip(handle: number, folderPath: string): Promise<{ ok: boolean; count: number; base64: string }>;
  /** Export a whole NARC (addressed as a resource) as a ZIP of its decompressed sub-files. */
  exportNarcZip(handle: number, ref: ResourceRef): Promise<{ ok: boolean; count: number; base64: string }>;
  /** Rebuild a NARC from a ZIP of files and write it back (the "import a folder as a NARC" op). */
  importNarcZip(handle: number, ref: ResourceRef, zipBytes: Uint8Array): Promise<{ ok: boolean; count: number }>;

  decodeNcgr(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    tilesWidth: number,
    transparent: boolean,
    paletteIndex: number,
    scanFrontToBack: boolean
  ): Promise<DecodedImage>;
  decodePalette(handle: number, nclr: ResourceRef): Promise<PaletteData>;
  /**
   * NCGR indexed raster (palette indices, not a PNG). tilesWidth / scanFrontToBack match decodeNcgr
   * so the editor sees the same geometry as the viewer.
   */
  decodeNcgrIndexed(
    handle: number,
    ncgr: ResourceRef,
    tilesWidth: number,
    scanFrontToBack: boolean
  ): Promise<IndexedRaster>;
  /** Replace an NCLR's colors from packed RGB triplets (3 bytes per color, count preserved). */
  setPaletteColors(
    handle: number,
    nclr: ResourceRef,
    rgbBytes: Uint8Array
  ): Promise<{ ok: boolean; colors: number; changed: number }>;
  /** Overwrite an NCGR's pixel indices in place (geometry preserved). */
  setNcgrPixels(
    handle: number,
    ncgr: ResourceRef,
    tilesWidth: number,
    scanFrontToBack: boolean,
    pixels: Uint8Array
  ): Promise<{ ok: boolean; width: number; height: number }>;
  decodeNscr(
    handle: number,
    nscr: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    transparent: boolean
  ): Promise<DecodedImage>;
  decodeNcerMeta(handle: number, ncer: ResourceRef): Promise<{ cellCount: number }>;
  decodeNcer(
    handle: number,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    cellIndex: number,
    transparent: boolean
  ): Promise<DecodedImage>;
  decodeNanrMeta(handle: number, nanr: ResourceRef): Promise<{ animations: { frames: number }[] }>;
  decodeNanr(
    handle: number,
    nanr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    transparent: boolean
  ): Promise<DecodedImage>;

  exportRaw(handle: number, ref: ResourceRef): Promise<{ size: number; base64: string }>;
  /** Export the usable, standalone format file (LZ-decompressed) + its detected format, for extraction. */
  exportFile(
    handle: number,
    ref: ResourceRef
  ): Promise<{ size: number; format: string; compressed: boolean; base64: string }>;

  /** Replace the bytes of a resource (ROM file or NARC sub-file, which is repacked into its ROM file). */
  importRaw(handle: number, ref: ResourceRef, bytes: Uint8Array): Promise<{ size: number }>;
  /** Serialise the (edited) ROM to a complete .nds image. */
  saveRom(handle: number): Promise<Uint8Array>;
  /**
   * Import a background image over an NSCR, decomposing it back into the NCGR tileset + NSCR tilemap
   * (and a new NCLR when rebuildPalette). dedupFlips shares mirrored tiles; numSubPalettes<=0 derives the
   * sub-palette count from the NCLR; dryRun computes the fit without writing.
   */
  importScreenPng(
    handle: number,
    nscr: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    dedupFlips: boolean,
    rebuildPalette: boolean,
    numSubPalettes: number,
    dryRun: boolean,
    pngBytes: Uint8Array
  ): Promise<ScreenImportResult>;
  /** Import an image over an NCER cell (its composed sprite) → decomposes into the NCGR tiles (+NCLR on rebuild). */
  importCellPng(
    handle: number,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    cellIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    pngBytes: Uint8Array
  ): Promise<{ ok: boolean; unmatched: number; paletteRebuilt: boolean; dryRun: boolean }>;
  /** Import an image over the NCER cell an NANR frame references (edits the animation's artwork). */
  importNanrPng(
    handle: number,
    nanr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    pngBytes: Uint8Array
  ): Promise<{ ok: boolean; unmatched: number; cellIndex: number; paletteRebuilt: boolean; dryRun: boolean }>;
  /** Replace an NCLR's colors from an image (swatch strip / indexed PNG / any image). Count preserved. */
  importPalette(
    handle: number,
    nclr: ResourceRef,
    imageBytes: Uint8Array
  ): Promise<{ ok: boolean; colors: number; unique: number }>;
  /** Re-encode a Wavefront OBJ mesh (UTF-8 bytes) over an NSBMD (untextured). Returns the mesh stats. */
  importObj(
    handle: number,
    nsbmd: ResourceRef,
    objBytes: Uint8Array
  ): Promise<{ ok: boolean; vertices: number; triangles: number; textured: boolean }>;
  /** Textured OBJ import: payload = [u32 LE objLen][obj UTF-8][texture image bytes] → embedded TEX0. */
  importObjTextured(
    handle: number,
    nsbmd: ResourceRef,
    payload: Uint8Array
  ): Promise<{ ok: boolean; vertices: number; triangles: number; textured: boolean }>;
  /**
   * Import an image over an NCGR sprite (propagates down into the NCGR, and the NCLR when rebuilding).
   * rebuildPalette=false matches to the existing (sub-)palette; dryRun computes the fit without writing.
   */
  importPng(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    paletteIndex: number,
    tilesWidth: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    pngBytes: Uint8Array
  ): Promise<PngImportResult>;

  getModelSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ hasEmbeddedTextures: boolean; models: string[] }>;
  /** An NSBCA's named clips — used for by-name model↔animation pairing and richer clip labels. */
  getAnimationSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ animations: { name: string; frameCount: number }[] }>;
  getTextureSet(
    handle: number,
    ref: ResourceRef
  ): Promise<{ textures: { name: string; width: number; height: number; png: string }[] }>;
  getModelRig(handle: number, ref: ResourceRef, modelIndex: number): Promise<ModelRig>;
  getMaterialColorAnim(handle: number, ref: ResourceRef, animIndex: number): Promise<MaterialColorAnim>;
  getVisibilityAnim(handle: number, ref: ResourceRef, animIndex: number): Promise<VisibilityAnim>;
  getTexturePatternAnim(
    handle: number,
    nsbtp: ResourceRef,
    animIndex: number,
    nsbmd: ResourceRef | null,
    nsbtx: ResourceRef | null
  ): Promise<TexturePatternAnim>;
  /**
   * Returns a self-contained glTF 2.0 document (JSON string). nsbtx = null → embedded textures;
   * nsbca = null → static model, otherwise the NSBCA's skeletal animations are baked in.
   */
  exportModelGltf(
    handle: number,
    nsbmd: ResourceRef,
    modelIndex: number,
    nsbtx: ResourceRef | null,
    nsbca: ResourceRef | null
  ): Promise<string>;
  renderParticles(
    handle: number,
    ref: ResourceRef,
    width: number,
    height: number,
    frameCount: number
  ): Promise<{ emitterCount: number; frames: string[] }>;

  getSdatInfo(handle: number, ref: ResourceRef): Promise<SdatInfo>;
  getSequenceNotes(handle: number, ref: ResourceRef, seqIndex: number): Promise<SequenceNotes>;
  renderSequenceWav(
    handle: number,
    ref: ResourceRef,
    seqIndex: number,
    maxSeconds: number, // 0 = full playthrough (until loop/end)
    trackMuteMask?: number // bit i set = mute track i
  ): Promise<{ sampleRate: number; seconds: number; loopStartSec: number; loopEndSec: number; base64: string }>;
  /**
   * Everything a client-side realtime synth needs to play one sequence itself: raw SSEQ bytecode,
   * the resolved bank's full instrument/region table, and decoded PCM16 for every wave in the
   * bank's up-to-4 wave archives. One bulk call — the realtime engine never round-trips through
   * this transport during playback.
   */
  getSequenceEngineData(handle: number, ref: ResourceRef, seqIndex: number): Promise<SequenceEngineData>;
  getWaveArchiveInfo(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number
  ): Promise<{ waves: WaveInfo[] }>;
  getWavePreview(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number,
    waveIndex: number
  ): Promise<WavePreview>;
  getStreamPreview(handle: number, ref: ResourceRef, streamIndex: number): Promise<StreamPreview>;
  importWav(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number,
    waveIndex: number,
    wavBytes: Uint8Array
  ): Promise<{ ok: boolean; sampleRate: number; samples: number; type: string }>;
  exportSequenceMidi(handle: number, ref: ResourceRef, seqIndex: number): Promise<{ base64: string }>;
  exportBankSf2(handle: number, ref: ResourceRef, bankIndex: number): Promise<{ base64: string }>;

  // --- text (BMG) ----------------------------------------------------------------------------
  decodeBmg(handle: number, ref: ResourceRef): Promise<BmgData>;
  /** Replace one message's content; "[type:hexdata]" bracket tokens in `text` parse back into escapes. */
  setBmgMessage(handle: number, ref: ResourceRef, msgIndex: number, text: string): Promise<{ ok: boolean }>;

  // --- fonts (NFTR) ----------------------------------------------------------------------------
  decodeFontMeta(handle: number, ref: ResourceRef): Promise<FontMeta>;
  /** Every glyph laid out as one grid PNG, `columns` wide. scale = integer magnification. */
  renderFontGlyphSheet(handle: number, ref: ResourceRef, columns: number, scale: number): Promise<FontGlyphSheet>;
  /** Render a preview string through the font. */
  renderFontString(handle: number, ref: ResourceRef, scale: number, text: string): Promise<DecodedImage>;
  /** One glyph's raw intensity pixels (0-255), for a pixel-level glyph editor. */
  decodeFontGlyphPixels(handle: number, ref: ResourceRef, glyphIndex: number): Promise<FontGlyphPixels>;
  /** Overwrite one glyph's pixels in place (same size as decodeFontGlyphPixels). */
  setFontGlyphPixels(
    handle: number,
    ref: ResourceRef,
    glyphIndex: number,
    intensityPixels: Uint8Array
  ): Promise<{ ok: boolean }>;

  // --- multi-cell (NMCR/NMAR) ------------------------------------------------------------------
  decodeNmcrMeta(handle: number, nmcr: ResourceRef): Promise<{ multiCellCount: number }>;
  /** Render one multi-cell through its companion NCER/NCGR/NCLR — the NMCR analog of decodeNcer. */
  decodeNmcr(
    handle: number,
    nmcr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    multiCellIndex: number,
    transparent: boolean
  ): Promise<DecodedImage>;
  decodeNmarMeta(handle: number, nmar: ResourceRef): Promise<{ animations: { name: string; frames: number }[] }>;
  /** Render one NMAR animation frame through its companion NMCR/NCER/NCGR/NCLR — the NMAR analog of decodeNanr. */
  decodeNmar(
    handle: number,
    nmar: ResourceRef,
    nmcr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    transparent: boolean
  ): Promise<DecodedImage>;
}
