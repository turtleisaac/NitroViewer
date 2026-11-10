import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useChangedKey } from "../useChangedKey";
import { refKey, type NarcEntry, type ResourceRef } from "../transport";
import { base64ToBytes, download, exportFileName } from "../util";
import { Icon } from "./icons";

/** File name for a whole-archive zip, taken from the last path segment. */
function zipBaseName(name: string): string {
  const base = name.split(/[/:]/).pop() || "narc";
  return base.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
}

/** Restores and tracks the grid's scroll position on the inspector body. */
function trackNarcScroll(root: HTMLDivElement | null, narcHandle: number): (() => void) | void {
  const scroller = root?.closest(".inspector-body") as HTMLElement | null;
  if (!scroller) return;
  scroller.scrollTop = useStore.getState().narcScroll[narcHandle] ?? 0;
  const onScroll = () => useStore.getState().setNarcScroll(narcHandle, scroller.scrollTop);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  return () => scroller.removeEventListener("scroll", onScroll);
}

/** Downloads one embedded file. */
async function exportEntry(
  entry: NarcEntry,
  narcHandle: number,
  romHandle: number,
  client: ReturnType<typeof useStore.getState>["client"],
  setBusy: (index: number | null) => void
) {
  setBusy(entry.index);
  try {
    const ref = { container: narcHandle, id: entry.index };
    const r = await client.exportFile(romHandle, ref);
    download(exportFileName(`#${entry.index}`, r.format || entry.format), base64ToBytes(r.base64));
  } catch (err) {
    alert("Export failed: " + (err as Error).message);
  } finally {
    setBusy(null);
  }
}

/** Replaces one embedded file with the chosen bytes. */
async function importChosen(
  file: File,
  ref: ResourceRef | null,
  importFile: (ref: ResourceRef, bytes: Uint8Array) => Promise<void>,
  setBusy: (index: number | null) => void
) {
  if (!ref) return;
  setBusy(ref.id);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await importFile(ref, bytes);
  } catch (err) {
    alert("Import failed: " + (err as Error).message);
  } finally {
    setBusy(null);
  }
}

/** Downloads the archive as a zip of its files. */
async function exportZip(
  romHandle: number,
  ref: ResourceRef,
  name: string,
  client: ReturnType<typeof useStore.getState>["client"],
  setZipBusy: (busy: "export" | "import" | null) => void
) {
  setZipBusy("export");
  try {
    const r = await client.exportNarcZip(romHandle, ref);
    download(`${zipBaseName(name)}.zip`, base64ToBytes(r.base64), "application/zip");
  } catch (err) {
    alert("Export folder failed: " + (err as Error).message);
  } finally {
    setZipBusy(null);
  }
}

/** Rebuilds the archive from a zip the user picked. */
async function importZip(
  file: File,
  ref: ResourceRef,
  importNarcZip: (ref: ResourceRef, bytes: Uint8Array) => Promise<{ count: number }>,
  setZipBusy: (busy: "export" | "import" | null) => void
) {
  setZipBusy("import");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await importNarcZip(ref, bytes);
    console.info(`NARC rebuilt from folder: ${res.count} files.`);
  } catch (err) {
    alert("Import folder failed: " + (err as Error).message);
  } finally {
    setZipBusy(null);
  }
}

/** Opens the selected archive and ignores the result if the viewer has moved on. */
function loadNarc(
  ref: ResourceRef,
  ensureNarc: (ref: ResourceRef) => Promise<{ narcHandle: number; entries: NarcEntry[] }>,
  setState: (state: { narcHandle: number; entries: NarcEntry[] } | null) => void,
  setErr: (err: string | undefined) => void
): () => void {
  let alive = true;
  ensureNarc(ref)
    .then((r) => alive && setState(r))
    .catch((e) => alive && setErr((e as Error).message));
  return () => {
    alive = false;
  };
}

function NarcZipButtons(props: {
  zipBusy: "export" | "import" | null;
  onExport: () => void;
  onImport: () => void;
}) {
  const { zipBusy, onExport, onImport } = props;
  return (
    <span className="narc-bar-actions">
      <button className="btn btn--sm" disabled={zipBusy != null} onClick={onExport}>
        {zipBusy === "export" ? "…" : "Export folder (zip)"}
      </button>
      <button className="btn btn--sm" disabled={zipBusy != null} onClick={onImport}>
        {zipBusy === "import" ? "…" : "Import folder (zip)"}
      </button>
    </span>
  );
}

function NarcGrid(props: {
  entries: NarcEntry[];
  narcHandle: number;
  name: string;
  busy: number | null;
  romHandle: number;
  client: ReturnType<typeof useStore.getState>["client"];
  select: (ref: ResourceRef, name: string) => Promise<void>;
  setBusy: (index: number | null) => void;
  importTarget: { current: ResourceRef | null };
  importRef: { current: HTMLInputElement | null };
}) {
  const { entries, narcHandle, name, busy, romHandle, client, select, setBusy, importTarget, importRef } = props;
  return (
    <div className="narc-grid">
      {entries.map((e) => (
        <div key={e.index} className="narc-item">
          <button className="narc-open" onClick={() => void select({ container: narcHandle, id: e.index }, `${name} : #${e.index}`)}>
            <span className="narc-idx">#{e.index}</span>
            <span className={"badge" + (e.format ? " badge--fmt" : "")}>{e.format || "raw"}</span>
            <span className="narc-size">{e.size}B</span>
          </button>
          <span className="narc-actions">
            <button
              className="icon-btn"
              title="Extract this file (decompressed)"
              disabled={busy != null}
              onClick={() => void exportEntry(e, narcHandle, romHandle, client, setBusy)}
            >
              {busy === e.index ? "…" : <Icon name="download" />}
            </button>
            <button
              className="icon-btn"
              title="Replace this file's bytes"
              disabled={busy != null}
              onClick={() => {
                importTarget.current = { container: narcHandle, id: e.index };
                importRef.current?.click();
              }}
            >
              <Icon name="upload" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Imports the file chosen for one archive entry, then forgets the target. */
function importPickedEntry(
  e: { target: HTMLInputElement },
  importTarget: { current: ResourceRef | null },
  importFile: (ref: ResourceRef, bytes: Uint8Array) => Promise<void>,
  setBusy: (index: number | null) => void
) {
  const f = chosenFile(e);
  if (!f) return;
  void importChosen(f, importTarget.current, importFile, setBusy).finally(() => {
    importTarget.current = null;
  });
}

/** Imports a zip chosen as a whole-archive replacement. */
function importPickedZip(
  e: { target: HTMLInputElement },
  ref: ResourceRef,
  importNarcZip: (ref: ResourceRef, bytes: Uint8Array) => Promise<{ count: number }>,
  setZipBusy: (busy: "export" | "import" | null) => void
) {
  const f = chosenFile(e);
  if (f) void importZip(f, ref, importNarcZip, setZipBusy);
}

/** Reads the first chosen file and clears the input. */
function chosenFile(e: { target: HTMLInputElement }): File | null {
  const f = e.target.files?.[0] ?? null;
  e.target.value = "";
  return f;
}

export function NarcBrowser() {
  const selection = useStore((s) => s.selection)!;
  const ensureNarc = useStore((s) => s.ensureNarc);
  const select = useStore((s) => s.select);
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const importFile = useStore((s) => s.importFile);
  const importNarcZip = useStore((s) => s.importNarcZip);
  const narcs = useStore((s) => s.narcs);
  const editVersion = useStore((s) => s.editVersion);
  const [state, setState] = useState<{ narcHandle: number; entries: NarcEntry[] } | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState<number | null>(null); // index currently exporting/importing
  const [zipBusy, setZipBusy] = useState<"export" | "import" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const importTarget = useRef<ResourceRef | null>(null);

  const selKey = refKey(selection.ref);
  if (useChangedKey(`${selKey}:${editVersion}`)) {
    setState(null);
    setErr(undefined);
  }

  useEffect(() => {
    // Open by the selection's own (container,id) — works for a ROM-file NARC and a NARC-in-NARC alike.
    // editVersion is a dep so a whole-NARC (folder/zip) import re-opens the archive fresh.
    return loadNarc(selection.ref, ensureNarc, setState, setErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, ensureNarc, editVersion]);

  // Preserve how far the user scrolled the file grid: restore on (re)open, save on scroll.
  useEffect(() => {
    if (!state) return;
    return trackNarcScroll(rootRef.current, state.narcHandle);
  }, [state]);

  if (err) return <div className="error">Could not open NARC: {err}</div>;
  if (!state) return <div className="placeholder">Opening NARC…</div>;

  // Read entries from the store so a per-entry import (which re-lists the NARC) refreshes the grid.
  const entries = narcs[state.narcHandle]?.entries ?? state.entries;

  return (
    <div className="narc" ref={rootRef}>
      <div className="narc-bar">
        <span className="narc-info">{entries.length} embedded files — click to inspect, or extract/replace each</span>
        <NarcZipButtons
          zipBusy={zipBusy}
          onExport={() => void exportZip(romHandle, selection.ref, selection.name, client, setZipBusy)}
          onImport={() => zipRef.current?.click()}
        />
      </div>
      <NarcGrid
        entries={entries}
        narcHandle={state.narcHandle}
        name={selection.name}
        busy={busy}
        romHandle={romHandle}
        client={client}
        select={select}
        setBusy={setBusy}
        importTarget={importTarget}
        importRef={importRef}
      />
      <input
        ref={importRef}
        type="file"
        hidden
        onChange={(e) => void importPickedEntry(e, importTarget, importFile, setBusy)}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => void importPickedZip(e, selection.ref, importNarcZip, setZipBusy)}
      />
    </div>
  );
}
