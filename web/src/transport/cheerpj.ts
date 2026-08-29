// CheerpjTransport — runs the Nds4j jar + CheerpjFacade in the browser via CheerpJ and adapts the
// facade's JSON/base64 contract to the typed NitroViewerClient. All the CheerpJ-specific quirks
// (Int8Array marshalling, awaiting every call, JSON parsing, error unwrapping, and — crucially —
// serialising calls) live here and nowhere else; the rest of the app is transport-agnostic.

import type {
  DecodedImage,
  FormatInfo,
  NarcEntry,
  NitroViewerClient,
  PaletteData,
  ResourceRef,
  RomInfo,
  TreeFolder,
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
const CLASSPATH = `/app${APP_DIR}jars/nitroviewer-core.jar:/app${APP_DIR}jars/Nds4j.jar`;

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

  listNarc(narcHandle: number): Promise<NarcEntry[]> {
    return this.enqueue(async () => unwrap<{ files: NarcEntry[] }>(await this.f.listNarc(narcHandle)).files);
  }

  decodeNcgr(
    handle: number,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    tilesWidth: number,
    transparent: boolean,
    paletteIndex: number
  ): Promise<DecodedImage> {
    return this.enqueue(async () =>
      unwrap<DecodedImage>(
        await this.f.decodeNcgr(
          handle, ncgr.container, ncgr.id, nclr.container, nclr.id, tilesWidth, transparent, paletteIndex
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

  getModelSetInfo(
    handle: number,
    ref: ResourceRef
  ): Promise<{ hasEmbeddedTextures: boolean; models: string[] }> {
    return this.enqueue(async () => unwrap(await this.f.getModelSetInfo(handle, ref.container, ref.id)));
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
