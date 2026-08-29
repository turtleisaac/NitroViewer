// The transport-agnostic client contract. CheerpjTransport implements it today; an HttpTransport
// could implement the same interface against a Java backend without any UI change.

/** A resource is addressed by (container, id): container < 0 = a top-level ROM file with that id;
 *  container >= 0 = index `id` inside the open NARC with that narc-handle. */
export interface ResourceRef {
  container: number;
  id: number;
}

export const ROM_CONTAINER = -1;
export const refKey = (r: ResourceRef): string => `${r.container}:${r.id}`;

export interface RomInfo {
  title: string;
  gameCode: string;
  numFiles: number;
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
  subPalettes?: number; // number of selectable 16-colour sub-palettes (NCGR); 1 if not applicable
  scanned?: boolean; // NCER/NANR over a scanned (bitmap) NCGR: shown as the raw NCGR, not composed
}

export interface PaletteData {
  count: number;
  colors: string[]; // "#rrggbb"
}

export interface PngImportResult {
  ok: boolean;
  width: number;
  height: number;
  unmatched: number; // pixels not exactly in the existing palette (match mode)
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

export interface NitroViewerClient {
  init(onProgress?: (msg: string) => void): Promise<void>;

  openRom(bytes: Uint8Array): Promise<{ handle: number; len: number }>;
  getRomInfo(handle: number): Promise<RomInfo>;
  listTree(handle: number): Promise<TreeFolder>;
  detectFormat(handle: number, ref: ResourceRef): Promise<FormatInfo>;

  openNarc(handle: number, romFileId: number): Promise<{ narcHandle: number; numFiles: number }>;
  /** Open a NARC from any resource — a ROM file (container < 0) or a sub-file of an open NARC (nested). */
  openNarcAt(handle: number, ref: ResourceRef): Promise<{ narcHandle: number; numFiles: number }>;
  listNarc(narcHandle: number): Promise<NarcEntry[]>;

  decodeNcgr(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    tilesWidth: number,
    transparent: boolean,
    paletteIndex: number
  ): Promise<DecodedImage>;
  decodePalette(handle: number, nclr: ResourceRef): Promise<PaletteData>;
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

  /** Replace the bytes of a resource (ROM file or NARC sub-file, which is repacked into its ROM file). */
  importRaw(handle: number, ref: ResourceRef, bytes: Uint8Array): Promise<{ size: number }>;
  /** Serialise the (edited) ROM to a complete .nds image. */
  saveRom(handle: number): Promise<Uint8Array>;
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
}
