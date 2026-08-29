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
}

export interface PaletteData {
  count: number;
  colors: string[]; // "#rrggbb"
}

export interface NitroViewerClient {
  init(onProgress?: (msg: string) => void): Promise<void>;

  openRom(bytes: Uint8Array): Promise<{ handle: number; len: number }>;
  getRomInfo(handle: number): Promise<RomInfo>;
  listTree(handle: number): Promise<TreeFolder>;
  detectFormat(handle: number, ref: ResourceRef): Promise<FormatInfo>;

  openNarc(handle: number, romFileId: number): Promise<{ narcHandle: number; numFiles: number }>;
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

  getModelSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ hasEmbeddedTextures: boolean; models: string[] }>;
  /** Returns a self-contained glTF 2.0 document (JSON string). nsbtx = null → embedded textures. */
  exportModelGltf(
    handle: number,
    nsbmd: ResourceRef,
    modelIndex: number,
    nsbtx: ResourceRef | null
  ): Promise<string>;
}
