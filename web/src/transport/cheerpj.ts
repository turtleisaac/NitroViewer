// CheerpjTransport — runs the Nds4j jar + CheerpjFacade in the browser via CheerpJ and adapts the
// facade's JSON/base64 contract to the typed NitroViewerClient. All the CheerpJ-specific quirks
// (Int8Array marshalling, awaiting every call, JSON parsing, error unwrapping, and — crucially —
// serialising calls) live here and nowhere else; the rest of the app is transport-agnostic.

import type {
  DecodedImage,
  FormatInfo,
  MaterialColorAnim,
  ModelRig,
  NarcEntry,
  NitroViewerClient,
  PaletteData,
  PngImportResult,
  ResourceRef,
  RomInfo,
  ScreenImportResult,
  TexturePatternAnim,
  TreeFolder,
  VisibilityAnim,
} from "./types";

// Globals defined by the CheerpJ loader.js script tag in index.html.
declare global {
  // eslint-disable-next-line no-var
  function cheerpjInit(options?: Record<string, unknown>): Promise<void>;
  // eslint-disable-next-line no-var
  function cheerpjRunLibrary(classpath: string): Promise<any>;
}

// CheerpJ's /app mount maps to the site origin root, so the jar paths must include whatever
// subdirectory the page is served from (root "/" at nitroviewer.com, "/NitroViewer/" on GitHub
// project pages). Derive that prefix from the current page location.
const APP_DIR = typeof location !== "undefined" ? location.pathname.replace(/[^/]*$/, "") : "/";
// Cache-bust the jar URLs so a rebuilt/redeployed jar isn't shadowed by CheerpJ's URL-keyed jar cache
// (which otherwise loads a stale class — an old facade method is silently missing → NoSuchMethodError).
// Dev changes every load (jars change constantly); prod uses a fixed version, bumped when a jar changes.
const JAR_VERSION = import.meta.env.DEV ? String(Date.now()) : "2";
const jar = (name: string) => `/app${APP_DIR}jars/${name}?v=${JAR_VERSION}`;
const CLASSPATH = `${jar("nitroviewer-core.jar")}:${jar("Nds4j.jar")}`;

/** Java exceptions never cross the boundary; the facade returns {"error":...} instead. */
function unwrap<T>(json: string): T {
  const obj = JSON.parse(json);
  if (obj && typeof obj === "object" && "error" in obj) {
    throw new Error(String(obj.error));
  }
  return obj as T;
}

export class CheerpjTransport implements NitroViewerClient {
  private facade: any = null;
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

  private get f(): any {
    if (!this.facade) throw new Error("transport not initialised");
    return this.facade;
  }

  openRom(bytes: Uint8Array): Promise<{ handle: number; len: number }> {
    // Java byte is signed: CheerpJ maps Int8Array -> byte[]. A Uint8Array fails overload
    // resolution the moment it holds a value > 127 (which every ROM does).
    const signed = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return this.enqueue(async () => {
      const res = JSON.parse(await this.f.openRom(signed));
      if (!res.ok) throw new Error(res.error || "openRom failed");
      return { handle: res.handle as number, len: res.len as number };
    });
  }

  getRomInfo(handle: number): Promise<RomInfo> {
    return this.enqueue(async () => unwrap<RomInfo>(await this.f.getRomInfo(handle)));
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
    pngBytes: Uint8Array
  ): Promise<PngImportResult> {
    const signed = new Int8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    return this.enqueue(async () =>
      unwrap<PngImportResult>(
        await this.f.importPng(
          handle, ncgr.container, ncgr.id, nclr.container, nclr.id,
          paletteIndex, tilesWidth, rebuildPalette, dryRun, signed
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
}
