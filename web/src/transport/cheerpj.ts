// CheerpjTransport — runs the Nds4j jar + CheerpjFacade in the browser via CheerpJ and adapts the
// facade's JSON/base64 contract to the typed NitroViewerClient. All the CheerpJ-specific quirks
// (Int8Array marshalling, awaiting every call, JSON parsing, error unwrapping, and — crucially —
// serialising calls) live here and nowhere else; the rest of the app is transport-agnostic.

import type {
  BannerInfo,
  BmgData,
  DecodedImage,
  FontGlyphPixels,
  FontGlyphSheet,
  FontMeta,
  FormatInfo,
  IndexedRaster,
  MaterialColorAnim,
  ModelRig,
  NarcEntry,
  NitroViewerClient,
  PaletteData,
  PngImportResult,
  ResourceRef,
  RomInfo,
  SdatInfo,
  ScreenImportResult,
  SequenceEngineData,
  SequenceNotes,
  StreamPreview,
  TexturePatternAnim,
  TreeFolder,
  VisibilityAnim,
  WaveInfo,
  WavePreview,
} from "./types";

// The Java facade returns JSON text (or, for two calls, raw bytes / a raw string).
// CheerpJ has no generated types; this is the boundary the rest of the file calls.
type JavaBytes = Int8Array;

interface CheerpjFacade {
  openRom(bytes: JavaBytes): Promise<string>;
  openUnpackedRom(bytes: JavaBytes): Promise<string>;
  getRomInfo(handle: number): Promise<string>;
  getBanner(handle: number): Promise<string>;
  setBannerIcon(handle: number, png: JavaBytes): Promise<string>;
  setBannerTitle(handle: number, languageOrdinal: number, text: JavaBytes): Promise<string>;
  listTree(handle: number): Promise<string>;
  detectFormat(handle: number, container: number, id: number): Promise<string>;
  openNarc(handle: number, romFileId: number): Promise<string>;
  openNarcAt(handle: number, container: number, id: number): Promise<string>;
  listNarc(narcHandle: number): Promise<string>;
  exportFolderZip(handle: number, folderPath: string): Promise<string>;
  exportNarcZip(handle: number, container: number, id: number): Promise<string>;
  importNarcZip(handle: number, container: number, id: number, zip: JavaBytes): Promise<string>;
  decodeNcgr(
    handle: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    tilesWidth: number,
    transparent: boolean,
    paletteIndex: number,
    scanFrontToBack: boolean,
  ): Promise<string>;
  decodePalette(handle: number, container: number, id: number): Promise<string>;
  decodeNcgrIndexed(
    handle: number,
    container: number,
    id: number,
    tilesWidth: number,
    scanFrontToBack: boolean,
  ): Promise<string>;
  setPaletteColors(handle: number, container: number, id: number, rgb: JavaBytes): Promise<string>;
  setNcgrPixels(
    handle: number,
    container: number,
    id: number,
    tilesWidth: number,
    scanFrontToBack: boolean,
    pixels: JavaBytes,
  ): Promise<string>;
  decodeNscr(
    handle: number,
    nscrContainer: number,
    nscrId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    transparent: boolean,
  ): Promise<string>;
  decodeNcerMeta(handle: number, container: number, id: number): Promise<string>;
  decodeNcer(
    handle: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    cellIndex: number,
    transparent: boolean,
  ): Promise<string>;
  decodeNanrMeta(handle: number, container: number, id: number): Promise<string>;
  decodeNanr(
    handle: number,
    nanrContainer: number,
    nanrId: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    animIndex: number,
    frameIndex: number,
    transparent: boolean,
  ): Promise<string>;
  exportRaw(handle: number, container: number, id: number): Promise<string>;
  exportFile(handle: number, container: number, id: number): Promise<string>;
  importRaw(handle: number, container: number, id: number, bytes: JavaBytes): Promise<string>;
  importPng(
    handle: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    paletteIndex: number,
    tilesWidth: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    scanFrontToBack: boolean,
    png: JavaBytes,
  ): Promise<string>;
  importScreenPng(
    handle: number,
    nscrContainer: number,
    nscrId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    dedupFlips: boolean,
    rebuildPalette: boolean,
    numSubPalettes: number,
    dryRun: boolean,
    png: JavaBytes,
  ): Promise<string>;
  importCellPng(
    handle: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    cellIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    png: JavaBytes,
  ): Promise<string>;
  importNanrPng(
    handle: number,
    nanrContainer: number,
    nanrId: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    animIndex: number,
    frameIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    png: JavaBytes,
  ): Promise<string>;
  importPalette(handle: number, container: number, id: number, image: JavaBytes): Promise<string>;
  importObj(handle: number, container: number, id: number, obj: JavaBytes): Promise<string>;
  importObjTextured(handle: number, container: number, id: number, payload: JavaBytes): Promise<string>;
  saveRom(handle: number): Promise<Int8Array>;
  lastError(): Promise<string>;
  getModelSetInfo(handle: number, container: number, id: number): Promise<string>;
  getAnimationSetInfo(handle: number, container: number, id: number): Promise<string>;
  decodeTextureSet(handle: number, container: number, id: number): Promise<string>;
  getModelRig(handle: number, container: number, id: number, modelIndex: number): Promise<string>;
  getMaterialColorAnim(handle: number, container: number, id: number, animIndex: number): Promise<string>;
  getVisibilityAnim(handle: number, container: number, id: number, animIndex: number): Promise<string>;
  getTexturePatternAnim(
    handle: number,
    nsbtpContainer: number,
    nsbtpId: number,
    animIndex: number,
    nsbmdContainer: number,
    nsbmdId: number,
    nsbtxContainer: number,
    nsbtxId: number,
  ): Promise<string>;
  renderParticles(
    handle: number,
    container: number,
    id: number,
    width: number,
    height: number,
    frameCount: number,
  ): Promise<string>;
  getSdatInfo(handle: number, container: number, id: number): Promise<string>;
  getSequenceNotes(handle: number, container: number, id: number, seqIndex: number): Promise<string>;
  renderSequenceWav(
    handle: number,
    container: number,
    id: number,
    seqIndex: number,
    maxSeconds: number,
    trackMuteMask: number,
  ): Promise<string>;
  getSequenceEngineData(handle: number, container: number, id: number, seqIndex: number): Promise<string>;
  getWaveArchiveInfo(handle: number, container: number, id: number, waveArcIndex: number): Promise<string>;
  getWavePreview(
    handle: number,
    container: number,
    id: number,
    waveArcIndex: number,
    waveIndex: number,
  ): Promise<string>;
  getStreamPreview(handle: number, container: number, id: number, streamIndex: number): Promise<string>;
  importWav(
    handle: number,
    container: number,
    id: number,
    waveArcIndex: number,
    waveIndex: number,
    wav: JavaBytes,
  ): Promise<string>;
  exportSequenceMidi(handle: number, container: number, id: number, seqIndex: number): Promise<string>;
  exportBankSf2(handle: number, container: number, id: number, bankIndex: number): Promise<string>;
  exportModelGltf(
    handle: number,
    container: number,
    id: number,
    modelIndex: number,
    nsbtxContainer: number,
    nsbtxId: number,
    nsbcaContainer: number,
    nsbcaId: number,
  ): Promise<string>;
  decodeBmg(handle: number, container: number, id: number): Promise<string>;
  setBmgMessage(handle: number, container: number, id: number, msgIndex: number, text: JavaBytes): Promise<string>;
  decodeFontMeta(handle: number, container: number, id: number): Promise<string>;
  renderFontGlyphSheet(handle: number, container: number, id: number, columns: number, scale: number): Promise<string>;
  renderFontString(handle: number, container: number, id: number, scale: number, text: JavaBytes): Promise<string>;
  decodeFontGlyphPixels(handle: number, container: number, id: number, glyphIndex: number): Promise<string>;
  setFontGlyphPixels(
    handle: number,
    container: number,
    id: number,
    glyphIndex: number,
    pixels: JavaBytes,
  ): Promise<string>;
  decodeNmcrMeta(handle: number, container: number, id: number): Promise<string>;
  decodeNmcr(
    handle: number,
    nmcrContainer: number,
    nmcrId: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    multiCellIndex: number,
    transparent: boolean,
  ): Promise<string>;
  decodeNmarMeta(handle: number, container: number, id: number): Promise<string>;
  decodeNmar(
    handle: number,
    nmarContainer: number,
    nmarId: number,
    nmcrContainer: number,
    nmcrId: number,
    ncerContainer: number,
    ncerId: number,
    ncgrContainer: number,
    ncgrId: number,
    nclrContainer: number,
    nclrId: number,
    animIndex: number,
    frameIndex: number,
    transparent: boolean,
  ): Promise<string>;
}

interface CheerpjLibrary {
  com: {
    nitroviewer: {
      core: {
        // CheerpJ resolves a Java class asynchronously, so the property itself is a promise.
        CheerpjFacade: Promise<new () => Promise<CheerpjFacade>>;
      };
    };
  };
}

// Globals defined by the CheerpJ loader.js script tag in index.html.
declare global {
  function cheerpjInit(options?: Record<string, unknown>): Promise<void>;
  function cheerpjRunLibrary(classpath: string): Promise<CheerpjLibrary>;
}

// CheerpJ's /app mount maps to the site origin root, so the jar paths must include whatever
// subdirectory the page is served from (root "/" at nitroviewer.com, "/NitroViewer/" on GitHub
// project pages). Derive that prefix from the current page location.
const APP_DIR = typeof location !== "undefined" ? location.pathname.replace(/[^/]*$/, "") : "/";
// Cache-bust the jar URLs so a rebuilt/redeployed jar isn't shadowed by CheerpJ's URL-keyed jar cache
// (which otherwise loads a stale class — an old facade method is silently missing → NoSuchMethodError).
// Dev changes every load (jars change constantly); prod uses a fixed version, bumped when a jar changes.
const JAR_VERSION = import.meta.env.DEV ? String(Date.now()) : "7";
const jar = (name: string) => `/app${APP_DIR}jars/${name}?v=${JAR_VERSION}`;
const CLASSPATH = `${jar("nitroviewer-core.jar")}:${jar("Nds4j.jar")}`;

/** JSON.parse is typed as any. This is the one cast off that any. */
function parseJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || value == null) {
    return String(value);
  }
  return "Java call failed";
}

/** Java exceptions never cross the boundary; the facade returns {"error":...} instead. */
function unwrap<T>(json: string): T {
  const obj = parseJson(json);
  if (obj && typeof obj === "object" && "error" in obj) {
    throw new Error(errorText(obj.error));
  }
  return obj as T;
}

export class CheerpjTransport implements NitroViewerClient {
  private facade: CheerpjFacade | null = null;
  private booting: Promise<void> | null = null;
  // CheerpJ Library Mode allows only ONE Java call in flight at a time (a second concurrent call
  // throws "Java code still running"). React effects, Promise.all, and rapid clicks would all violate
  // that, so every facade call is chained onto this queue and runs strictly serially.
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // cheerpjInit() must run exactly once per page. React StrictMode (and remounts) can call init()
  // more than once, so funnel everyone through a single shared promise.
  async init(onProgress?: (msg: string) => void): Promise<void> {
    if (this.facade) return;
    if (!this.booting) this.booting = this.doInit(onProgress);
    return this.booting;
  }

  private async doInit(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.("Initialising CheerpJ runtime…");
    await cheerpjInit();
    onProgress?.("Loading Nds4j…");
    const lib = await cheerpjRunLibrary(CLASSPATH);
    const Facade = await lib.com.nitroviewer.core.CheerpjFacade;
    this.facade = await new Facade();
    // Dev affordance (mirrors window.__store): lets a driver poke the raw Java facade directly.
    if (typeof window !== "undefined") (window as unknown as { __nvFacade: unknown }).__nvFacade = this.facade;
    onProgress?.("Ready");
  }

  private get f(): CheerpjFacade {
    if (!this.facade) throw new Error("transport not initialised");
    return this.facade;
  }

  openRom(bytes: Uint8Array): Promise<{ handle: number; len: number }> {
    // Java byte is signed: CheerpJ maps Int8Array -> byte[]. A Uint8Array fails overload
    // resolution the moment it holds a value > 127 (which every ROM does).
    const signed = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return this.enqueue(async () => {
      const res = parseJson(await this.f.openRom(signed)) as {
        ok?: boolean;
        error?: string;
        handle: number;
        len: number;
      };
      if (!res.ok) throw new Error(res.error || "openRom failed");
      return { handle: res.handle, len: res.len };
    });
  }

  openUnpackedRom(zipBytes: Uint8Array): Promise<{ handle: number; len: number }> {
    const signed = new Int8Array(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    return this.enqueue(async () => {
      const res = parseJson(await this.f.openUnpackedRom(signed)) as {
        ok?: boolean;
        error?: string;
        handle: number;
        len: number;
      };
      if (!res.ok) throw new Error(res.error || "openUnpackedRom failed");
      return { handle: res.handle, len: res.len };
    });
  }

  getRomInfo(handle: number): Promise<RomInfo> {
    return this.enqueue(async () => unwrap<RomInfo>(await this.f.getRomInfo(handle)));
  }

  getBanner(handle: number): Promise<BannerInfo> {
    return this.enqueue(async () => unwrap<BannerInfo>(await this.f.getBanner(handle)));
  }

  setBannerIcon(handle: number, pngBytes: Uint8Array): Promise<{ ok: boolean }> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () => unwrap(await this.f.setBannerIcon(handle, signed)));
  }

  setBannerTitle(handle: number, languageOrdinal: number, text: string): Promise<{ ok: boolean }> {
    // The text crosses as UTF-8 bytes (single trailing byte[]) — the proven CheerpJ marshalling shape,
    // avoiding a String param that fails overload resolution.
    const utf8 = new TextEncoder().encode(text);
    const signed = new Int8Array(utf8.buffer, utf8.byteOffset, utf8.byteLength);
    return this.enqueue(async () => unwrap(await this.f.setBannerTitle(handle, languageOrdinal, signed)));
  }

  listTree(handle: number): Promise<TreeFolder> {
    return this.enqueue(async () => unwrap<TreeFolder>(await this.f.listTree(handle)));
  }

  detectFormat(handle: number, ref: ResourceRef): Promise<FormatInfo> {
    return this.enqueue(async () => unwrap<FormatInfo>(await this.f.detectFormat(handle, ref.container, ref.id)));
  }

  openNarc(handle: number, romFileId: number): Promise<{ narcHandle: number; numFiles: number }> {
    return this.enqueue(async () => unwrap(await this.f.openNarc(handle, romFileId)));
  }

  openNarcAt(handle: number, ref: ResourceRef): Promise<{ narcHandle: number; numFiles: number }> {
    return this.enqueue(async () => unwrap(await this.f.openNarcAt(handle, ref.container, ref.id)));
  }

  listNarc(narcHandle: number): Promise<NarcEntry[]> {
    return this.enqueue(async () => unwrap<{ files: NarcEntry[] }>(await this.f.listNarc(narcHandle)).files);
  }

  exportFolderZip(handle: number, folderPath: string): Promise<{ ok: boolean; count: number; base64: string }> {
    return this.enqueue(async () => unwrap(await this.f.exportFolderZip(handle, folderPath)));
  }

  exportNarcZip(handle: number, ref: ResourceRef): Promise<{ ok: boolean; count: number; base64: string }> {
    return this.enqueue(async () => unwrap(await this.f.exportNarcZip(handle, ref.container, ref.id)));
  }

  importNarcZip(handle: number, ref: ResourceRef, zipBytes: Uint8Array): Promise<{ ok: boolean; count: number }> {
    const signed = new Int8Array(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    return this.enqueue(async () => unwrap(await this.f.importNarcZip(handle, ref.container, ref.id, signed)));
  }

  decodeNcgr(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    tilesWidth: number,
    transparent: boolean,
    paletteIndex: number,
    scanFrontToBack: boolean
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNcgr(
          handle, ncgr.container, ncgr.id, nclr.container, nclr.id, tilesWidth, transparent, paletteIndex, scanFrontToBack
        )
      )
    );
  }

  decodePalette(handle: number, nclr: ResourceRef): Promise<PaletteData> {
    return this.enqueue(async () => unwrap<PaletteData>(await this.f.decodePalette(handle, nclr.container, nclr.id)));
  }

  decodeNcgrIndexed(
    handle: number,
    ncgr: ResourceRef,
    tilesWidth: number,
    scanFrontToBack: boolean
  ): Promise<IndexedRaster> {
    return this.enqueue(async () =>
      unwrap<IndexedRaster>(
        await this.f.decodeNcgrIndexed(handle, ncgr.container, ncgr.id, tilesWidth, scanFrontToBack)
      )
    );
  }

  setPaletteColors(
    handle: number,
    nclr: ResourceRef,
    rgbBytes: Uint8Array
  ): Promise<{ ok: boolean; colors: number; changed: number }> {
    const signed = new Int8Array(rgbBytes.buffer, rgbBytes.byteOffset, rgbBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.setPaletteColors(handle, nclr.container, nclr.id, signed))
    );
  }

  setNcgrPixels(
    handle: number,
    ncgr: ResourceRef,
    tilesWidth: number,
    scanFrontToBack: boolean,
    pixels: Uint8Array
  ): Promise<{ ok: boolean; width: number; height: number }> {
    const signed = new Int8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.setNcgrPixels(handle, ncgr.container, ncgr.id, tilesWidth, scanFrontToBack, signed))
    );
  }

  decodeNscr(
    handle: number,
    nscr: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    transparent: boolean
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNscr(
          handle, nscr.container, nscr.id, ncgr.container, ncgr.id, nclr.container, nclr.id, transparent
        )
      )
    );
  }

  decodeNcerMeta(handle: number, ncer: ResourceRef): Promise<{ cellCount: number }> {
    return this.enqueue(async () => unwrap(await this.f.decodeNcerMeta(handle, ncer.container, ncer.id)));
  }

  decodeNcer(
    handle: number,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    cellIndex: number,
    transparent: boolean
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNcer(
          handle, ncer.container, ncer.id, ncgr.container, ncgr.id, nclr.container, nclr.id, cellIndex, transparent
        )
      )
    );
  }

  decodeNanrMeta(handle: number, nanr: ResourceRef): Promise<{ animations: { frames: number }[] }> {
    return this.enqueue(async () => unwrap(await this.f.decodeNanrMeta(handle, nanr.container, nanr.id)));
  }

  decodeNanr(
    handle: number,
    nanr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    transparent: boolean
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNanr(
          handle, nanr.container, nanr.id, ncer.container, ncer.id, ncgr.container, ncgr.id,
          nclr.container, nclr.id, animIndex, frameIndex, transparent
        )
      )
    );
  }

  exportRaw(handle: number, ref: ResourceRef): Promise<{ size: number; base64: string }> {
    return this.enqueue(async () => unwrap(await this.f.exportRaw(handle, ref.container, ref.id)));
  }

  exportFile(
    handle: number,
    ref: ResourceRef
  ): Promise<{ size: number; format: string; compressed: boolean; base64: string }> {
    return this.enqueue(async () => unwrap(await this.f.exportFile(handle, ref.container, ref.id)));
  }

  importRaw(handle: number, ref: ResourceRef, bytes: Uint8Array): Promise<{ size: number }> {
    // Same signed-byte marshalling rule as openRom: Java byte[] needs an Int8Array.
    const signed = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return this.enqueue(async () =>
      unwrap<{ ok: boolean; size: number }>(await this.f.importRaw(handle, ref.container, ref.id, signed))
    );
  }

  importPng(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    paletteIndex: number,
    tilesWidth: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    scanFrontToBack: boolean,
    pngBytes: Uint8Array
  ): Promise<PngImportResult> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () =>
      unwrap<PngImportResult>(
        await this.f.importPng(
          handle, ncgr.container, ncgr.id, nclr.container, nclr.id,
          paletteIndex, tilesWidth, rebuildPalette, dryRun, scanFrontToBack, signed
        )
      )
    );
  }

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
  ): Promise<ScreenImportResult> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () =>
      unwrap<ScreenImportResult>(
        await this.f.importScreenPng(
          handle, nscr.container, nscr.id, ncgr.container, ncgr.id, nclr.container, nclr.id,
          dedupFlips, rebuildPalette, numSubPalettes, dryRun, signed
        )
      )
    );
  }

  importCellPng(
    handle: number,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    cellIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    pngBytes: Uint8Array
  ): Promise<{ ok: boolean; unmatched: number; paletteRebuilt: boolean; dryRun: boolean }> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(
        await this.f.importCellPng(
          handle, ncer.container, ncer.id, ncgr.container, ncgr.id, nclr.container, nclr.id,
          cellIndex, rebuildPalette, dryRun, signed
        )
      )
    );
  }

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
  ): Promise<{ ok: boolean; unmatched: number; cellIndex: number; paletteRebuilt: boolean; dryRun: boolean }> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(
        await this.f.importNanrPng(
          handle, nanr.container, nanr.id, ncer.container, ncer.id, ncgr.container, ncgr.id,
          nclr.container, nclr.id, animIndex, frameIndex, rebuildPalette, dryRun, signed
        )
      )
    );
  }

  importPalette(
    handle: number,
    nclr: ResourceRef,
    imageBytes: Uint8Array
  ): Promise<{ ok: boolean; colors: number; unique: number }> {
    const signed = new Int8Array(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.importPalette(handle, nclr.container, nclr.id, signed))
    );
  }

  importObj(
    handle: number,
    nsbmd: ResourceRef,
    objBytes: Uint8Array
  ): Promise<{ ok: boolean; vertices: number; triangles: number; textured: boolean }> {
    const signed = new Int8Array(objBytes.buffer, objBytes.byteOffset, objBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.importObj(handle, nsbmd.container, nsbmd.id, signed))
    );
  }

  importObjTextured(
    handle: number,
    nsbmd: ResourceRef,
    payload: Uint8Array
  ): Promise<{ ok: boolean; vertices: number; triangles: number; textured: boolean }> {
    const signed = new Int8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.importObjTextured(handle, nsbmd.container, nsbmd.id, signed))
    );
  }

  saveRom(handle: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      // saveRom returns the raw byte[] (an Int8Array in JS), or a zero-length array on failure —
      // in which case lastError() carries the message. This is the one large-binary-out path.
      const out: Int8Array = await this.f.saveRom(handle);
      if (!out || out.length === 0) {
        const msg: string = await this.f.lastError();
        throw new Error(msg || "saveRom produced no data");
      }
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    });
  }

  getModelSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ hasEmbeddedTextures: boolean; models: string[] }> {
    return this.enqueue(async () => unwrap(await this.f.getModelSetInfo(handle, ref.container, ref.id)));
  }

  getAnimationSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ animations: { name: string; frameCount: number }[] }> {
    return this.enqueue(async () => unwrap(await this.f.getAnimationSetInfo(handle, ref.container, ref.id)));
  }

  getTextureSet(
    handle: number,
    ref: ResourceRef
  ): Promise<{ textures: { name: string; width: number; height: number; png: string }[] }> {
    return this.enqueue(async () => unwrap(await this.f.decodeTextureSet(handle, ref.container, ref.id)));
  }

  getModelRig(handle: number, ref: ResourceRef, modelIndex: number): Promise<ModelRig> {
    return this.enqueue(async () => unwrap<ModelRig>(await this.f.getModelRig(handle, ref.container, ref.id, modelIndex)));
  }

  getMaterialColorAnim(handle: number, ref: ResourceRef, animIndex: number): Promise<MaterialColorAnim> {
    return this.enqueue(async () =>
      unwrap<MaterialColorAnim>(await this.f.getMaterialColorAnim(handle, ref.container, ref.id, animIndex))
    );
  }

  getVisibilityAnim(handle: number, ref: ResourceRef, animIndex: number): Promise<VisibilityAnim> {
    return this.enqueue(async () =>
      unwrap<VisibilityAnim>(await this.f.getVisibilityAnim(handle, ref.container, ref.id, animIndex))
    );
  }

  getTexturePatternAnim(
    handle: number,
    nsbtp: ResourceRef,
    animIndex: number,
    nsbmd: ResourceRef | null,
    nsbtx: ResourceRef | null
  ): Promise<TexturePatternAnim> {
    return this.enqueue(async () =>
      unwrap<TexturePatternAnim>(
        await this.f.getTexturePatternAnim(
          handle, nsbtp.container, nsbtp.id, animIndex,
          nsbmd ? nsbmd.container : 0, nsbmd ? nsbmd.id : -1,
          nsbtx ? nsbtx.container : 0, nsbtx ? nsbtx.id : -1
        )
      )
    );
  }

  renderParticles(
    handle: number,
    ref: ResourceRef,
    width: number,
    height: number,
    frameCount: number
  ): Promise<{ emitterCount: number; frames: string[] }> {
    return this.enqueue(async () =>
      unwrap(await this.f.renderParticles(handle, ref.container, ref.id, width, height, frameCount))
    );
  }

  getSdatInfo(handle: number, ref: ResourceRef): Promise<SdatInfo> {
    return this.enqueue(async () => unwrap(await this.f.getSdatInfo(handle, ref.container, ref.id)));
  }

  getSequenceNotes(handle: number, ref: ResourceRef, seqIndex: number): Promise<SequenceNotes> {
    return this.enqueue(async () =>
      unwrap(await this.f.getSequenceNotes(handle, ref.container, ref.id, seqIndex))
    );
  }

  renderSequenceWav(
    handle: number,
    ref: ResourceRef,
    seqIndex: number,
    maxSeconds: number,
    trackMuteMask = 0
  ): Promise<{ sampleRate: number; seconds: number; loopStartSec: number; loopEndSec: number; base64: string }> {
    return this.enqueue(async () =>
      unwrap(await this.f.renderSequenceWav(handle, ref.container, ref.id, seqIndex, maxSeconds, trackMuteMask))
    );
  }

  getSequenceEngineData(handle: number, ref: ResourceRef, seqIndex: number): Promise<SequenceEngineData> {
    return this.enqueue(async () =>
      unwrap(await this.f.getSequenceEngineData(handle, ref.container, ref.id, seqIndex))
    );
  }

  getWaveArchiveInfo(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number
  ): Promise<{ waves: WaveInfo[] }> {
    return this.enqueue(async () =>
      unwrap(await this.f.getWaveArchiveInfo(handle, ref.container, ref.id, waveArcIndex))
    );
  }

  getWavePreview(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number,
    waveIndex: number
  ): Promise<WavePreview> {
    return this.enqueue(async () =>
      unwrap(await this.f.getWavePreview(handle, ref.container, ref.id, waveArcIndex, waveIndex))
    );
  }

  getStreamPreview(handle: number, ref: ResourceRef, streamIndex: number): Promise<StreamPreview> {
    return this.enqueue(async () =>
      unwrap(await this.f.getStreamPreview(handle, ref.container, ref.id, streamIndex))
    );
  }

  importWav(
    handle: number,
    ref: ResourceRef,
    waveArcIndex: number,
    waveIndex: number,
    wavBytes: Uint8Array
  ): Promise<{ ok: boolean; sampleRate: number; samples: number; type: string }> {
    const signed = new Int8Array(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.importWav(handle, ref.container, ref.id, waveArcIndex, waveIndex, signed))
    );
  }

  exportSequenceMidi(handle: number, ref: ResourceRef, seqIndex: number): Promise<{ base64: string }> {
    return this.enqueue(async () =>
      unwrap(await this.f.exportSequenceMidi(handle, ref.container, ref.id, seqIndex))
    );
  }

  exportBankSf2(handle: number, ref: ResourceRef, bankIndex: number): Promise<{ base64: string }> {
    return this.enqueue(async () =>
      unwrap(await this.f.exportBankSf2(handle, ref.container, ref.id, bankIndex))
    );
  }

  exportModelGltf(
    handle: number,
    nsbmd: ResourceRef,
    modelIndex: number,
    nsbtx: ResourceRef | null,
    nsbca: ResourceRef | null
  ): Promise<string> {
    return this.enqueue(async () => {
      // exportModelGltf returns raw glTF (or "ERROR: ..."), not the JSON-wrapped contract.
      const res: string = await this.f.exportModelGltf(
        handle, nsbmd.container, nsbmd.id, modelIndex,
        nsbtx ? nsbtx.container : 0, nsbtx ? nsbtx.id : -1,
        nsbca ? nsbca.container : 0, nsbca ? nsbca.id : -1
      );
      if (res.startsWith("ERROR:")) throw new Error(res.slice(6).trim());
      return res;
    });
  }

  // --- text (BMG) ----------------------------------------------------------------------------

  decodeBmg(handle: number, ref: ResourceRef): Promise<BmgData> {
    return this.enqueue(async () => unwrap<BmgData>(await this.f.decodeBmg(handle, ref.container, ref.id)));
  }

  setBmgMessage(handle: number, ref: ResourceRef, msgIndex: number, text: string): Promise<{ ok: boolean }> {
    const utf8 = new TextEncoder().encode(text);
    const signed = new Int8Array(utf8.buffer, utf8.byteOffset, utf8.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.setBmgMessage(handle, ref.container, ref.id, msgIndex, signed))
    );
  }

  // --- fonts (NFTR) ----------------------------------------------------------------------------

  decodeFontMeta(handle: number, ref: ResourceRef): Promise<FontMeta> {
    return this.enqueue(async () => unwrap<FontMeta>(await this.f.decodeFontMeta(handle, ref.container, ref.id)));
  }

  renderFontGlyphSheet(handle: number, ref: ResourceRef, columns: number, scale: number): Promise<FontGlyphSheet> {
    return this.enqueue(async () =>
      unwrap<FontGlyphSheet>(await this.f.renderFontGlyphSheet(handle, ref.container, ref.id, columns, scale))
    );
  }

  renderFontString(handle: number, ref: ResourceRef, scale: number, text: string): Promise<DecodedImage> {
    const utf8 = new TextEncoder().encode(text);
    const signed = new Int8Array(utf8.buffer, utf8.byteOffset, utf8.byteLength);
    return this.enqueue(async () =>
      unwrap<DecodedImage>(await this.f.renderFontString(handle, ref.container, ref.id, scale, signed))
    );
  }

  decodeFontGlyphPixels(handle: number, ref: ResourceRef, glyphIndex: number): Promise<FontGlyphPixels> {
    return this.enqueue(async () =>
      unwrap<FontGlyphPixels>(await this.f.decodeFontGlyphPixels(handle, ref.container, ref.id, glyphIndex))
    );
  }

  setFontGlyphPixels(
    handle: number,
    ref: ResourceRef,
    glyphIndex: number,
    intensityPixels: Uint8Array
  ): Promise<{ ok: boolean }> {
    const signed = new Int8Array(intensityPixels.buffer, intensityPixels.byteOffset, intensityPixels.byteLength);
    return this.enqueue(async () =>
      unwrap(await this.f.setFontGlyphPixels(handle, ref.container, ref.id, glyphIndex, signed))
    );
  }

  // --- multi-cell (NMCR/NMAR) ------------------------------------------------------------------

  decodeNmcrMeta(handle: number, nmcr: ResourceRef): Promise<{ multiCellCount: number }> {
    return this.enqueue(async () => unwrap(await this.f.decodeNmcrMeta(handle, nmcr.container, nmcr.id)));
  }

  decodeNmcr(
    handle: number,
    nmcr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    multiCellIndex: number,
    transparent: boolean
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNmcr(
          handle, nmcr.container, nmcr.id, ncer.container, ncer.id,
          ncgr.container, ncgr.id, nclr.container, nclr.id, multiCellIndex, transparent
        )
      )
    );
  }

  decodeNmarMeta(handle: number, nmar: ResourceRef): Promise<{ animations: { name: string; frames: number }[] }> {
    return this.enqueue(async () => unwrap(await this.f.decodeNmarMeta(handle, nmar.container, nmar.id)));
  }

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
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNmar(
          handle, nmar.container, nmar.id, nmcr.container, nmcr.id, ncer.container, ncer.id,
          ncgr.container, ncgr.id, nclr.container, nclr.id, animIndex, frameIndex, transparent
        )
      )
    );
  }
}
