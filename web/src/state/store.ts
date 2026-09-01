import { create, type StoreApi } from "zustand";
import {
  createClient,
  refKey,
  ROM_CONTAINER,
  type FormatInfo,
  type NarcEntry,
  type NitroViewerClient,
  type ResourceRef,
  type PngImportResult,
  type ScreenImportResult,
  type RomInfo,
  type TreeFolder,
} from "../transport";
import { base64ToBytes, download } from "../util";
import { isSkippableUnpackedPath, zipStore } from "../zip";

export interface ResourceItem {
  ref: ResourceRef;
  label: string;
  format: string;
}

export interface Selection {
  ref: ResourceRef;
  name: string;
  format: string;
  compressed: boolean;
  size: number;
}

export interface PairOverride {
  ncgr?: ResourceRef;
  nclr?: ResourceRef;
  ncer?: ResourceRef;
}

/** A reversible edit: the raw (as-stored, base64) bytes of each resource it changed, before the edit. */
export interface EditSnapshot {
  label: string;
  entries: { ref: ResourceRef; base64: string }[];
}

interface AppState {
  client: NitroViewerClient;
  booted: boolean;
  status: string;
  loading: boolean;

  romHandle: number | null;
  romInfo: RomInfo | null;
  romName: string;
  tree: TreeFolder | null;
  expanded: Set<string>;

  narcs: Record<number, { ref: ResourceRef; entries: NarcEntry[] }>; // by narcHandle; ref = opened-from
  narcByRef: Record<string, number>; // refKey(opened-from) -> narcHandle (dedupes re-opens, incl. nested)
  formats: Record<string, FormatInfo>; // refKey -> format
  idToPath: Record<number, string>; // ROM file id -> full FNT path (e.g. /poketool/trgra/trbgra.narc)

  selection: Selection | null;
  romSiblings: ResourceItem[]; // pairing candidates when a loose ROM file is selected
  navOpen: boolean; // tree drawer open (only affects narrow screens)
  treeCollapsed: boolean; // file browser hidden on desktop (wide screens)
  treeWidth: number; // file browser column width in px on desktop (drag-resizable)
  revealPath: string | null; // folder path the tree should scroll into view
  revealTick: number; // bumped on each reveal so re-revealing the same folder still scrolls
  narcScroll: Record<number, number>; // narcHandle -> inspector scrollTop, so "back" restores the spot
  // Manual pairing choices the user made, keyed by refKey, so they survive re-selecting a resource.
  pairingOverrides: Record<string, PairOverride>;

  dirty: boolean; // unsaved edits exist (import happened, no saveRom since)
  editVersion: number; // bumped on every import so viewers re-decode the changed bytes
  saving: boolean; // a saveRom is in flight

  // Undo/redo: each edit pushes a snapshot of the affected resources' PRIOR raw bytes. Undo restores
  // them (and snapshots the current bytes onto the redo stack), so edits are reversible before Save ROM.
  undoStack: EditSnapshot[];
  redoStack: EditSnapshot[];

  // In-tool editor draft (NCLR color picker / NCGR sprite editor). While dirty, the header ↶/↷
  // buttons drive the draft's local history instead of the ROM snapshot stack, and navigating away
  // (or Save ROM) asks before discarding unsaved color/pixel edits.
  editorDirty: boolean;
  editorCanUndo: boolean;
  editorCanRedo: boolean;
  editorCapturesUndo: boolean;
  editorDiscardMessage: string;
  editorUndo: (() => void) | null;
  editorRedo: (() => void) | null;

  boot: () => Promise<void>;
  setNavOpen: (open: boolean) => void;
  setTreeCollapsed: (collapsed: boolean) => void;
  setTreeWidth: (width: number) => void;
  revealFolder: (folderPath: string) => void;
  setNarcScroll: (narcHandle: number, top: number) => void;
  setPairingOverride: (key: string, partial: PairOverride) => void;
  openRom: (file: File) => Promise<void>;
  openRomBytes: (name: string, bytes: Uint8Array) => Promise<void>;
  /** Load via Nds4j {@code NintendoDsRom.fromUnpacked} (ndstool or ds-rom extract) from a folder picker. */
  openUnpackedFolder: (files: FileList | File[]) => Promise<void>;
  openUnpackedEntries: (label: string, files: { path: string; data: Uint8Array }[]) => Promise<void>;
  toggleFolder: (path: string) => void;
  select: (ref: ResourceRef, name: string) => Promise<void>;
  ensureNarc: (ref: ResourceRef) => Promise<{ narcHandle: number; entries: NarcEntry[] }>;
  containerItems: (container: number) => ResourceItem[];
  /** Full FNT path of the NARC opened at `container` (a narc-handle), for game-DB lookups. Top-level
   *  NARCs resolve via idToPath; nested NARCs return null (unlisted → heuristic fallback). */
  narcPathOf: (container: number) => string | null;
  importFile: (ref: ResourceRef, bytes: Uint8Array) => Promise<void>;
  importPng: (
    ncgr: ResourceRef,
    nclr: ResourceRef,
    paletteIndex: number,
    tilesWidth: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    bytes: Uint8Array
  ) => Promise<PngImportResult>;
  saveRom: () => Promise<void>;
  importPalette: (nclr: ResourceRef, bytes: Uint8Array) => Promise<{ colors: number; unique: number }>;
  setPaletteColors: (nclr: ResourceRef, colors: string[]) => Promise<{ colors: number; changed: number }>;
  setNcgrPixels: (
    ncgr: ResourceRef,
    tilesWidth: number,
    scanFrontToBack: boolean,
    pixels: Uint8Array
  ) => Promise<{ width: number; height: number }>;
  /** Persist a sprite-editor save: pixels always, NCLR colors only when `colors` is provided. */
  saveSpriteEdit: (
    ncgr: ResourceRef,
    nclr: ResourceRef | undefined,
    tilesWidth: number,
    scanFrontToBack: boolean,
    pixels: Uint8Array,
    colors?: string[]
  ) => Promise<void>;
  bindEditor: (
    session: {
      dirty: boolean;
      canUndo: boolean;
      canRedo: boolean;
      /** When true, header ↶/↷ drive the draft even if it isn't dirty yet (sprite editor). */
      captureUndo?: boolean;
      discardMessage: string;
      undo: () => void;
      redo: () => void;
    } | null
  ) => void;
  importObj: (
    nsbmd: ResourceRef,
    objBytes: Uint8Array
  ) => Promise<{ vertices: number; triangles: number; textured: boolean }>;
  importObjTextured: (
    nsbmd: ResourceRef,
    payload: Uint8Array
  ) => Promise<{ vertices: number; triangles: number; textured: boolean }>;
  importScreenPng: (
    nscr: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    dedupFlips: boolean,
    rebuildPalette: boolean,
    dryRun: boolean,
    bytes: Uint8Array
  ) => Promise<ScreenImportResult>;
  importNarcZip: (narc: ResourceRef, zipBytes: Uint8Array) => Promise<{ count: number }>;
  importWav: (
    ref: ResourceRef,
    waveArcIndex: number,
    waveIndex: number,
    wavBytes: Uint8Array
  ) => Promise<{ sampleRate: number; samples: number; type: string }>;
  importCellPng: (
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    cellIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    bytes: Uint8Array
  ) => Promise<{ ok: boolean; unmatched: number }>;
  importNanrPng: (
    nanr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    rebuildPalette: boolean,
    dryRun: boolean,
    bytes: Uint8Array
  ) => Promise<{ ok: boolean; unmatched: number; cellIndex: number }>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

function findFolder(folder: TreeFolder, id: number): TreeFolder | null {
  if (folder.files.some((f) => f.id === id)) return folder;
  for (const sub of folder.folders) {
    const hit = findFolder(sub, id);
    if (hit) return hit;
  }
  return null;
}

/** Map every ROM file id to its full FNT path (e.g. "/poketool/trgra/trbgra.narc", "/a/0/0/4"), so the
 *  UI can show where a file lives instead of just its (often numeric/ambiguous) name. */
function buildPathMap(root: TreeFolder): Record<number, string> {
  const map: Record<number, string> = {};
  const walk = (folder: TreeFolder, prefix: string) => {
    for (const f of folder.files) map[f.id] = prefix + (f.name || `${f.id}`);
    for (const sub of folder.folders) walk(sub, prefix + sub.name + "/");
  };
  walk(root, "/"); // root folder's own name is "/"; start the prefix there and skip it as a segment
  return map;
}

// Capture the current raw (as-stored) bytes of each ref, so an edit about to overwrite them can be
// undone. Uses exportRaw (base64) — the exact bytes importRaw would restore.
async function snapshot(
  client: NitroViewerClient,
  romHandle: number,
  refs: ResourceRef[],
  label: string
): Promise<EditSnapshot> {
  const entries = [];
  for (const ref of refs) {
    const { base64 } = await client.exportRaw(romHandle, ref);
    entries.push({ ref, base64 });
  }
  return { label, entries };
}

// After an edit persists new bytes for one or more resources: refresh each ref's cached format (size
// and format may have changed) and its NARC listing, keep the selection's displayed metadata in sync,
// then mark the ROM dirty and bump editVersion (which re-keys the open viewer so it re-decodes).
async function refreshAfterEdit(
  get: StoreApi<AppState>["getState"],
  set: StoreApi<AppState>["setState"],
  romHandle: number,
  refs: ResourceRef[]
) {
  const { client } = get();
  for (const ref of refs) {
    const key = refKey(ref);
    const fmt = await client.detectFormat(romHandle, ref);
    set((s) => ({ formats: { ...s.formats, [key]: fmt } }));
    if (ref.container >= 0) {
      const narc = get().narcs[ref.container];
      if (narc) {
        const entries = await client.listNarc(ref.container);
        set((s) => ({ narcs: { ...s.narcs, [ref.container]: { ...narc, entries } } }));
      }
    }
    // If this ref is itself an open NARC whose whole file was replaced (e.g. a folder/zip import), drop its
    // cached handle so it re-opens fresh — the facade's open Narc object for it is now stale.
    const openHandle = get().narcByRef[key];
    if (openHandle != null) {
      set((s) => {
        const narcByRef = { ...s.narcByRef };
        delete narcByRef[key];
        const narcs = { ...s.narcs };
        delete narcs[openHandle];
        return { narcByRef, narcs };
      });
    }
    set((s) => ({
      selection:
        s.selection && refKey(s.selection.ref) === key
          ? { ...s.selection, format: fmt.format, compressed: fmt.compressed, size: fmt.size }
          : s.selection,
    }));
  }
  set((s) => ({ dirty: true, editVersion: s.editVersion + 1 }));
}

async function commitOpenRom(
  get: StoreApi<AppState>["getState"],
  set: StoreApi<AppState>["setState"],
  handle: number,
  displayName: string
) {
  const { client } = get();
  const [romInfo, tree] = await Promise.all([client.getRomInfo(handle), client.listTree(handle)]);
  set({
    romHandle: handle,
    romInfo,
    tree,
    romName: displayName,
    expanded: new Set<string>(["/"]),
    narcs: {},
    narcByRef: {},
    formats: {},
    idToPath: buildPathMap(tree),
    selection: null,
    romSiblings: [],
    pairingOverrides: {},
    narcScroll: {},
    dirty: false,
    editVersion: 0,
    undoStack: [],
    redoStack: [],
    editorDirty: false,
    editorCanUndo: false,
    editorCanRedo: false,
    editorCapturesUndo: false,
    editorUndo: null,
    editorRedo: null,
    status: `${romInfo.title.trim() || displayName} · ${romInfo.numFiles} files`,
  });
}

function packRgbTriplets(colors: string[]): Uint8Array {
  const rgb = new Uint8Array(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    const hex = colors[i].replace(/^#/, "");
    const v = parseInt(hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex, 16);
    if (!Number.isFinite(v)) throw new Error("Invalid color: " + colors[i]);
    rgb[i * 3] = (v >> 16) & 0xff;
    rgb[i * 3 + 1] = (v >> 8) & 0xff;
    rgb[i * 3 + 2] = v & 0xff;
  }
  return rgb;
}

/** True when the in-tool editor has unsaved color/pixel edits the user is willing to throw away. */
function confirmDiscardDraft(get: StoreApi<AppState>["getState"]): boolean {
  const s = get();
  if (!s.editorDirty) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(s.editorDiscardMessage);
}

// File-browser layout prefs persist across sessions (localStorage). Width is clamped to the same
// range the resizer enforces, so a stale/hand-edited value can't produce an unusable panel.
const TREE_WIDTH_KEY = "nitroviewer.treeWidth";
const TREE_COLLAPSED_KEY = "nitroviewer.treeCollapsed";
export const TREE_WIDTH_MIN = 200;
export const TREE_WIDTH_MAX = 640;
export const TREE_WIDTH_DEFAULT = 340;

export function clampTreeWidth(w: number): number {
  if (!Number.isFinite(w)) return TREE_WIDTH_DEFAULT;
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(w)));
}

function loadTreeWidth(): number {
  if (typeof localStorage === "undefined") return TREE_WIDTH_DEFAULT;
  const raw = localStorage.getItem(TREE_WIDTH_KEY);
  return raw == null ? TREE_WIDTH_DEFAULT : clampTreeWidth(Number(raw));
}

function loadTreeCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(TREE_COLLAPSED_KEY) === "1";
}

function unpackedFolderLabel(files: File[]): string {
  for (const f of files) {
    const rel = f.webkitRelativePath;
    if (!rel) continue;
    const first = rel.split(/[/\\]/).filter(Boolean)[0];
    if (first) return first;
  }
  return "unpacked";
}

export const useStore = create<AppState>((set, get) => ({
  client: createClient(),
  booted: false,
  status: "Booting CheerpJ…",
  loading: false,

  romHandle: null,
  romInfo: null,
  romName: "",
  tree: null,
  expanded: new Set<string>(["/"]),

  narcs: {},
  narcByRef: {},
  formats: {},
  idToPath: {},

  selection: null,
  romSiblings: [],
  navOpen: false,
  treeCollapsed: loadTreeCollapsed(),
  treeWidth: loadTreeWidth(),
  revealPath: null,
  revealTick: 0,
  narcScroll: {},
  pairingOverrides: {},

  dirty: false,
  editVersion: 0,
  saving: false,
  undoStack: [],
  redoStack: [],

  editorDirty: false,
  editorCanUndo: false,
  editorCanRedo: false,
  editorCapturesUndo: false,
  editorDiscardMessage: "You have unsaved edits. Discard them?",
  editorUndo: null,
  editorRedo: null,

  bindEditor: (session) => {
    if (!session) {
      set({
        editorDirty: false,
        editorCanUndo: false,
        editorCanRedo: false,
        editorCapturesUndo: false,
        editorUndo: null,
        editorRedo: null,
      });
      return;
    }
    set({
      editorDirty: session.dirty,
      editorCanUndo: session.canUndo,
      editorCanRedo: session.canRedo,
      editorCapturesUndo: session.captureUndo ?? session.dirty,
      editorDiscardMessage: session.discardMessage,
      editorUndo: session.undo,
      editorRedo: session.redo,
    });
  },

  setNavOpen: (open) => set({ navOpen: open }),

  setTreeCollapsed: (collapsed) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(TREE_COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ treeCollapsed: collapsed });
  },

  setTreeWidth: (width) => {
    const w = clampTreeWidth(width);
    if (typeof localStorage !== "undefined") localStorage.setItem(TREE_WIDTH_KEY, String(w));
    set({ treeWidth: w });
  },

  // Expand a folder and all its ancestors in the tree, and signal TreePane to scroll it into view.
  // folderPath is a trailing-slash path like "/poketool/trgra/" (matching the tree's expanded keys).
  revealFolder: (folderPath) =>
    set((s) => {
      const next = new Set(s.expanded);
      let p = "/";
      next.add(p);
      for (const seg of folderPath.split("/").filter(Boolean)) {
        p += seg + "/";
        next.add(p);
      }
      return { expanded: next, revealPath: folderPath, revealTick: s.revealTick + 1, navOpen: true };
    }),

  setNarcScroll: (narcHandle, top) =>
    set((s) => ({ narcScroll: { ...s.narcScroll, [narcHandle]: top } })),

  setPairingOverride: (key, partial) =>
    set((s) => ({
      pairingOverrides: { ...s.pairingOverrides, [key]: { ...s.pairingOverrides[key], ...partial } },
    })),

  boot: async () => {
    const { client, booted } = get();
    if (booted) return;
    try {
      await client.init((msg) => set({ status: msg }));
      set({ booted: true, status: "Ready — open a ROM or unpacked folder" });
    } catch (e) {
      set({ status: "CheerpJ failed to start: " + (e as Error).message });
    }
  },

  openRom: async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await get().openRomBytes(file.name, bytes);
  },

  openRomBytes: async (name, bytes) => {
    if (!confirmDiscardDraft(get)) return;
    const { client } = get();
    set({ loading: true, status: `Parsing ${name}…` });
    try {
      const { handle } = await client.openRom(bytes);
      await commitOpenRom(get, set, handle, name);
    } catch (e) {
      console.error("[openRom]", e);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ status: "Failed to open ROM: " + msg });
    } finally {
      set({ loading: false });
    }
  },

  openUnpackedFolder: async (fileList) => {
    const files = Array.from(fileList).filter((f) => !isSkippableUnpackedPath(f.webkitRelativePath || f.name));
    if (files.length === 0) {
      set({ status: "Failed to open unpacked folder: the folder was empty" });
      return;
    }
    const packed: { path: string; data: Uint8Array }[] = [];
    for (const f of files) {
      packed.push({
        path: f.webkitRelativePath || f.name,
        data: new Uint8Array(await f.arrayBuffer()),
      });
    }
    await get().openUnpackedEntries(unpackedFolderLabel(files), packed);
  },

  openUnpackedEntries: async (label, packed) => {
    if (!confirmDiscardDraft(get)) return;
    const { client } = get();
    const files = packed.filter((f) => !isSkippableUnpackedPath(f.path));
    if (files.length === 0) {
      set({ status: "Failed to open unpacked folder: the folder was empty" });
      return;
    }
    set({ loading: true, status: `Loading unpacked ROM ${label}…` });
    try {
      const zip = zipStore(files);
      const { handle } = await client.openUnpackedRom(zip);
      await commitOpenRom(get, set, handle, label);
    } catch (e) {
      console.error("[openUnpackedFolder]", e);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ status: "Failed to open unpacked folder: " + msg });
    } finally {
      set({ loading: false });
    }
  },

  toggleFolder: (path) =>
    set((s) => {
      const next = new Set(s.expanded);
      next.has(path) ? next.delete(path) : next.add(path);
      return { expanded: next };
    }),

  ensureNarc: async (ref) => {
    const { client, romHandle, narcByRef, narcs } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const key = refKey(ref);
    const existing = narcByRef[key];
    if (existing != null) return { narcHandle: existing, entries: narcs[existing].entries };
    // container < 0 = a ROM file; container >= 0 = a sub-file of an open NARC (a NARC-in-NARC).
    const { narcHandle } = await client.openNarcAt(romHandle, ref);
    const entries = await client.listNarc(narcHandle);
    set((s) => ({
      narcs: { ...s.narcs, [narcHandle]: { ref, entries } },
      narcByRef: { ...s.narcByRef, [key]: narcHandle },
    }));
    return { narcHandle, entries };
  },

  select: async (ref, name) => {
    const { client, romHandle, formats, selection } = get();
    if (romHandle == null) return;
    const key = refKey(ref);
    if (!selection || refKey(selection.ref) !== key) {
      if (!confirmDiscardDraft(get)) return;
    }
    let fmt = formats[key];
    if (!fmt) {
      fmt = await client.detectFormat(romHandle, ref);
      set((s) => ({ formats: { ...s.formats, [key]: fmt! } }));
    }
    // Close the tree drawer on selection so the viewer is visible on small screens.
    set({ selection: { ref, name, format: fmt.format, compressed: fmt.compressed, size: fmt.size }, navOpen: false });

    // Precompute pairing candidates for a loose ROM file (its FNT-folder siblings).
    if (ref.container === ROM_CONTAINER) {
      const tree = get().tree;
      const folder = tree ? findFolder(tree, ref.id) : null;
      const items: ResourceItem[] = [];
      for (const file of folder?.files ?? []) {
        const r = { container: ROM_CONTAINER, id: file.id };
        const k = refKey(r);
        let f = get().formats[k]?.format;
        if (f === undefined && items.length < 48) {
          const det = await client.detectFormat(romHandle, r);
          set((s) => ({ formats: { ...s.formats, [k]: det } }));
          f = det.format;
        }
        items.push({ ref: r, label: file.name, format: f ?? "" });
      }
      set({ romSiblings: items });
    } else {
      set({ romSiblings: [] });
    }
  },

  importFile: async (ref, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [ref], "Import file");
    await client.importRaw(romHandle, ref, bytes);
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [ref]);
  },

  importPng: async (ncgr, nclr, paletteIndex, tilesWidth, rebuildPalette, dryRun, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const touched = rebuildPalette ? [ncgr, nclr] : [ncgr];
    // Snapshot the affected resources' prior bytes BEFORE the facade re-encodes them (real runs only).
    const snap = dryRun ? null : await snapshot(client, romHandle, touched, "Import PNG");
    const res = await client.importPng(romHandle, ncgr, nclr, paletteIndex, tilesWidth, rebuildPalette, dryRun, bytes);
    if (!dryRun) {
      if (snap) set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
      // A real import touched the NCGR (and the NCLR too, when the palette was rebuilt).
      await refreshAfterEdit(get, set, romHandle, touched);
    }
    return res;
  },

  importPalette: async (nclr, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [nclr], "Import palette");
    const res = await client.importPalette(romHandle, nclr, bytes);
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [nclr]);
    return res;
  },

  setPaletteColors: async (nclr, colors) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [nclr], "Edit palette");
    const res = await client.setPaletteColors(romHandle, nclr, packRgbTriplets(colors));
    if (!res.ok) throw new Error("setPaletteColors failed");
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [nclr]);
    return { colors: res.colors, changed: res.changed };
  },

  setNcgrPixels: async (ncgr, tilesWidth, scanFrontToBack, pixels) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [ncgr], "Edit sprite");
    const res = await client.setNcgrPixels(romHandle, ncgr, tilesWidth, scanFrontToBack, pixels);
    if (!res.ok) throw new Error("setNcgrPixels failed");
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [ncgr]);
    return { width: res.width, height: res.height };
  },

  saveSpriteEdit: async (ncgr, nclr, tilesWidth, scanFrontToBack, pixels, colors) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const touched = colors && nclr ? [ncgr, nclr] : [ncgr];
    const snap = await snapshot(client, romHandle, touched, colors ? "Edit sprite + palette" : "Edit sprite");
    const pix = await client.setNcgrPixels(romHandle, ncgr, tilesWidth, scanFrontToBack, pixels);
    if (!pix.ok) throw new Error("setNcgrPixels failed");
    if (colors && nclr) {
      const pal = await client.setPaletteColors(romHandle, nclr, packRgbTriplets(colors));
      if (!pal.ok) throw new Error("setPaletteColors failed");
    }
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, touched);
  },

  importObj: async (nsbmd, objBytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [nsbmd], "Import OBJ");
    const res = await client.importObj(romHandle, nsbmd, objBytes);
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [nsbmd]);
    return res;
  },

  importObjTextured: async (nsbmd, payload) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [nsbmd], "Import textured OBJ");
    const res = await client.importObjTextured(romHandle, nsbmd, payload);
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [nsbmd]);
    return res;
  },

  importCellPng: async (ncer, ncgr, nclr, cellIndex, rebuildPalette, dryRun, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const touched = rebuildPalette ? [ncgr, nclr] : [ncgr];
    const snap = dryRun ? null : await snapshot(client, romHandle, touched, "Import cell");
    const res = await client.importCellPng(romHandle, ncer, ncgr, nclr, cellIndex, rebuildPalette, dryRun, bytes);
    if (!dryRun && res.ok) {
      if (snap) set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
      await refreshAfterEdit(get, set, romHandle, touched);
    }
    return { ok: res.ok, unmatched: res.unmatched };
  },

  importNanrPng: async (nanr, ncer, ncgr, nclr, animIndex, frameIndex, rebuildPalette, dryRun, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const touched = rebuildPalette ? [ncgr, nclr] : [ncgr];
    const snap = dryRun ? null : await snapshot(client, romHandle, touched, "Import animation cell");
    const res = await client.importNanrPng(romHandle, nanr, ncer, ncgr, nclr, animIndex, frameIndex, rebuildPalette, dryRun, bytes);
    if (!dryRun && res.ok) {
      if (snap) set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
      await refreshAfterEdit(get, set, romHandle, touched);
    }
    return { ok: res.ok, unmatched: res.unmatched, cellIndex: res.cellIndex };
  },

  importScreenPng: async (nscr, ncgr, nclr, dedupFlips, rebuildPalette, dryRun, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    // A real import rewrites the tilemap (NSCR) + tileset (NCGR), and the palette (NCLR) when rebuilding.
    const touched = rebuildPalette ? [ncgr, nscr, nclr] : [ncgr, nscr];
    const snap = dryRun ? null : await snapshot(client, romHandle, touched, "Import background");
    const res = await client.importScreenPng(romHandle, nscr, ncgr, nclr, dedupFlips, rebuildPalette, 0, dryRun, bytes);
    if (!dryRun && res.ok) {
      if (snap) set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
      await refreshAfterEdit(get, set, romHandle, touched);
    }
    return res;
  },

  importNarcZip: async (narc, zipBytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [narc], "Import NARC folder");
    const res = await client.importNarcZip(romHandle, narc, zipBytes);
    if (res.ok) {
      set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
      // refreshAfterEdit drops the stale open handle for this NARC so the browser re-opens it fresh.
      await refreshAfterEdit(get, set, romHandle, [narc]);
    }
    return { count: res.count };
  },

  importWav: async (ref, waveArcIndex, waveIndex, wavBytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const snap = await snapshot(client, romHandle, [ref], "Import WAV");
    const res = await client.importWav(romHandle, ref, waveArcIndex, waveIndex, wavBytes);
    if (!res.ok) throw new Error("importWav failed");
    set((s) => ({ undoStack: [...s.undoStack, snap], redoStack: [] }));
    await refreshAfterEdit(get, set, romHandle, [ref]);
    return { sampleRate: res.sampleRate, samples: res.samples, type: res.type };
  },

  saveRom: async () => {
    if (get().editorDirty) {
      if (typeof window !== "undefined")
        window.alert("Save or cancel your palette/sprite edits before saving the ROM.");
      return;
    }
    const { client, romHandle, romName } = get();
    if (romHandle == null) throw new Error("no ROM open");
    set({ saving: true, status: "Saving ROM…" });
    try {
      const bytes = await client.saveRom(romHandle);
      const name = romName || "edited.nds";
      download(name.replace(/(\.nds)?$/i, ".nds"), bytes);
      set({ dirty: false, status: `Saved ${name} · ${bytes.length.toLocaleString()} B` });
    } catch (e) {
      set({ status: "Save failed: " + (e as Error).message });
      throw e;
    } finally {
      set({ saving: false });
    }
  },

  // Restore the most recent edit's prior bytes, moving it to the redo stack (snapshotting the current
  // bytes first, so redo can re-apply). Writing through importRaw repacks NARCs/nested chains as usual.
  undo: async () => {
    const s = get();
    if (s.editorDirty || s.editorCapturesUndo) {
      s.editorUndo?.();
      return;
    }
    const { client, romHandle, undoStack } = s;
    if (romHandle == null || undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    const refs = snap.entries.map((e) => e.ref);
    const redo = await snapshot(client, romHandle, refs, snap.label);
    for (const e of snap.entries) await client.importRaw(romHandle, e.ref, base64ToBytes(e.base64));
    set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, redo] }));
    await refreshAfterEdit(get, set, romHandle, refs);
    set({ dirty: get().undoStack.length > 0 }); // back to pristine when nothing is left to undo
  },

  redo: async () => {
    const s = get();
    if (s.editorDirty || s.editorCapturesUndo) {
      s.editorRedo?.();
      return;
    }
    const { client, romHandle, redoStack } = s;
    if (romHandle == null || redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    const refs = snap.entries.map((e) => e.ref);
    const undo = await snapshot(client, romHandle, refs, snap.label);
    for (const e of snap.entries) await client.importRaw(romHandle, e.ref, base64ToBytes(e.base64));
    set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, undo] }));
    await refreshAfterEdit(get, set, romHandle, refs);
  },

  containerItems: (container) => {
    if (container >= 0) {
      const narc = get().narcs[container];
      if (!narc) return [];
      return narc.entries.map((e) => ({
        ref: { container, id: e.index },
        label: `#${e.index}`,
        format: e.format,
      }));
    }
    return get().romSiblings;
  },

  narcPathOf: (container) => {
    if (container < 0) return null;
    const narc = get().narcs[container];
    // Only top-level NARCs (opened from a ROM file) have a stable FNT path; nested ones fall through.
    if (!narc || narc.ref.container !== ROM_CONTAINER) return null;
    return get().idToPath[narc.ref.id] ?? null;
  },
}));

// Exposed for end-to-end tests / debugging (harmless in production).
if (typeof window !== "undefined") {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}
