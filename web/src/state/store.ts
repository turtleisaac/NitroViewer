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
  type RomInfo,
  type TreeFolder,
} from "../transport";
import { download } from "../util";

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

  narcs: Record<number, { romFileId: number; entries: NarcEntry[] }>; // by narcHandle
  fileToNarc: Record<number, number>; // romFileId -> narcHandle
  formats: Record<string, FormatInfo>; // refKey -> format
  idToPath: Record<number, string>; // ROM file id -> full FNT path (e.g. /poketool/trgra/trbgra.narc)

  selection: Selection | null;
  romSiblings: ResourceItem[]; // pairing candidates when a loose ROM file is selected
  navOpen: boolean; // tree drawer open (only affects narrow screens)
  revealPath: string | null; // folder path the tree should scroll into view
  revealTick: number; // bumped on each reveal so re-revealing the same folder still scrolls
  narcScroll: Record<number, number>; // narcHandle -> inspector scrollTop, so "back" restores the spot
  // Manual pairing choices the user made, keyed by refKey, so they survive re-selecting a resource.
  pairingOverrides: Record<string, PairOverride>;

  dirty: boolean; // unsaved edits exist (import happened, no saveRom since)
  editVersion: number; // bumped on every import so viewers re-decode the changed bytes
  saving: boolean; // a saveRom is in flight

  boot: () => Promise<void>;
  setNavOpen: (open: boolean) => void;
  revealFolder: (folderPath: string) => void;
  setNarcScroll: (narcHandle: number, top: number) => void;
  setPairingOverride: (key: string, partial: PairOverride) => void;
  openRom: (file: File) => Promise<void>;
  toggleFolder: (path: string) => void;
  select: (ref: ResourceRef, name: string) => Promise<void>;
  ensureNarc: (romFileId: number) => Promise<{ narcHandle: number; entries: NarcEntry[] }>;
  containerItems: (container: number) => ResourceItem[];
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
    set((s) => ({
      selection:
        s.selection && refKey(s.selection.ref) === key
          ? { ...s.selection, format: fmt.format, compressed: fmt.compressed, size: fmt.size }
          : s.selection,
    }));
  }
  set((s) => ({ dirty: true, editVersion: s.editVersion + 1 }));
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
  fileToNarc: {},
  formats: {},
  idToPath: {},

  selection: null,
  romSiblings: [],
  navOpen: false,
  revealPath: null,
  revealTick: 0,
  narcScroll: {},
  pairingOverrides: {},

  dirty: false,
  editVersion: 0,
  saving: false,

  setNavOpen: (open) => set({ navOpen: open }),

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
      set({ booted: true, status: "Ready — open a ROM" });
    } catch (e) {
      set({ status: "CheerpJ failed to start: " + (e as Error).message });
    }
  },

  openRom: async (file) => {
    const { client } = get();
    set({ loading: true, status: `Parsing ${file.name}…` });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { handle } = await client.openRom(bytes);
      const [romInfo, tree] = await Promise.all([client.getRomInfo(handle), client.listTree(handle)]);
      set({
        romHandle: handle,
        romInfo,
        tree,
        romName: file.name,
        expanded: new Set<string>(["/"]),
        narcs: {},
        fileToNarc: {},
        formats: {},
        idToPath: buildPathMap(tree),
        selection: null,
        romSiblings: [],
        pairingOverrides: {},
        narcScroll: {},
        dirty: false,
        editVersion: 0,
        status: `${romInfo.title.trim() || file.name} · ${romInfo.numFiles} files`,
      });
    } catch (e) {
      console.error("[openRom]", e);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ status: "Failed to open ROM: " + msg });
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

  ensureNarc: async (romFileId) => {
    const { client, romHandle, fileToNarc, narcs } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const existing = fileToNarc[romFileId];
    if (existing != null) return { narcHandle: existing, entries: narcs[existing].entries };
    const { narcHandle } = await client.openNarc(romHandle, romFileId);
    const entries = await client.listNarc(narcHandle);
    set((s) => ({
      narcs: { ...s.narcs, [narcHandle]: { romFileId, entries } },
      fileToNarc: { ...s.fileToNarc, [romFileId]: narcHandle },
    }));
    return { narcHandle, entries };
  },

  select: async (ref, name) => {
    const { client, romHandle, formats } = get();
    if (romHandle == null) return;
    const key = refKey(ref);
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
    await client.importRaw(romHandle, ref, bytes);
    await refreshAfterEdit(get, set, romHandle, [ref]);
  },

  importPng: async (ncgr, nclr, paletteIndex, tilesWidth, rebuildPalette, dryRun, bytes) => {
    const { client, romHandle } = get();
    if (romHandle == null) throw new Error("no ROM open");
    const res = await client.importPng(romHandle, ncgr, nclr, paletteIndex, tilesWidth, rebuildPalette, dryRun, bytes);
    if (!dryRun) {
      // A real import touched the NCGR (and the NCLR too, when the palette was rebuilt).
      await refreshAfterEdit(get, set, romHandle, rebuildPalette ? [ncgr, nclr] : [ncgr]);
    }
    return res;
  },

  saveRom: async () => {
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
}));

// Exposed for end-to-end tests / debugging (harmless in production).
if (typeof window !== "undefined") {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}
