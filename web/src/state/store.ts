import { create } from "zustand";
import {
  createClient,
  refKey,
  ROM_CONTAINER,
  type FormatInfo,
  type NarcEntry,
  type NitroViewerClient,
  type ResourceRef,
  type RomInfo,
  type TreeFolder,
} from "../transport";

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

  selection: Selection | null;
  romSiblings: ResourceItem[]; // pairing candidates when a loose ROM file is selected
  navOpen: boolean; // tree drawer open (only affects narrow screens)
  // Manual pairing choices the user made, keyed by refKey, so they survive re-selecting a resource.
  pairingOverrides: Record<string, PairOverride>;

  boot: () => Promise<void>;
  setNavOpen: (open: boolean) => void;
  setPairingOverride: (key: string, partial: PairOverride) => void;
  openRom: (file: File) => Promise<void>;
  toggleFolder: (path: string) => void;
  select: (ref: ResourceRef, name: string) => Promise<void>;
  ensureNarc: (romFileId: number) => Promise<{ narcHandle: number; entries: NarcEntry[] }>;
  containerItems: (container: number) => ResourceItem[];
}

function findFolder(folder: TreeFolder, id: number): TreeFolder | null {
  if (folder.files.some((f) => f.id === id)) return folder;
  for (const sub of folder.folders) {
    const hit = findFolder(sub, id);
    if (hit) return hit;
  }
  return null;
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

  selection: null,
  romSiblings: [],
  navOpen: false,
  pairingOverrides: {},

  setNavOpen: (open) => set({ navOpen: open }),

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
        selection: null,
        romSiblings: [],
        pairingOverrides: {},
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
