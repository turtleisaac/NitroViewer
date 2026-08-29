import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { refKey, type NarcEntry, type ResourceRef } from "../transport";
import { base64ToBytes, download, exportFileName } from "../util";

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
  useEffect(() => {
    let alive = true;
    setState(null);
    setErr(undefined);
    // Open by the selection's own (container,id) — works for a ROM-file NARC and a NARC-in-NARC alike.
    // editVersion is a dep so a whole-NARC (folder/zip) import re-opens the archive fresh.
    ensureNarc(selection.ref)
      .then((r) => alive && setState(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, ensureNarc, editVersion]);

  // Preserve how far the user scrolled the file grid: restore on (re)open, save on scroll.
  useEffect(() => {
    if (!state) return;
    const scroller = rootRef.current?.closest(".inspector-body") as HTMLElement | null;
    if (!scroller) return;
    scroller.scrollTop = useStore.getState().narcScroll[state.narcHandle] ?? 0;
    const onScroll = () => useStore.getState().setNarcScroll(state.narcHandle, scroller.scrollTop);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [state]);

  if (err) return <div className="error">Could not open NARC: {err}</div>;
  if (!state) return <div className="placeholder">Opening NARC…</div>;

  // Read entries from the store so a per-entry import (which re-lists the NARC) refreshes the grid.
  const entries = narcs[state.narcHandle]?.entries ?? state.entries;

  const exportEntry = async (e: NarcEntry) => {
    setBusy(e.index);
    try {
      const ref = { container: state.narcHandle, id: e.index };
      const r = await client.exportFile(romHandle, ref);
      download(exportFileName(`#${e.index}`, r.format || e.format), base64ToBytes(r.base64));
    } catch (err) {
      alert("Export failed: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onImportChosen = async (file: File) => {
    const ref = importTarget.current;
    if (!ref) return;
    setBusy(ref.id);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importFile(ref, bytes);
    } catch (err) {
      alert("Import failed: " + (err as Error).message);
    } finally {
      setBusy(null);
      importTarget.current = null;
    }
  };

  // Extract the whole NARC as a ZIP of its sub-files ("export as a folder").
  const exportZip = async () => {
    setZipBusy("export");
    try {
      const r = await client.exportNarcZip(romHandle, selection.ref);
      const base = (selection.name.split(/[/:]/).pop() || "narc").replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_");
      download(`${base}.zip`, base64ToBytes(r.base64), "application/zip");
    } catch (err) {
      alert("Export folder failed: " + (err as Error).message);
    } finally {
      setZipBusy(null);
    }
  };

  const onZipChosen = async (file: File) => {
    setZipBusy("import");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await importNarcZip(selection.ref, bytes);
      // eslint-disable-next-line no-console
      console.info(`NARC rebuilt from folder: ${res.count} files.`);
    } catch (err) {
      alert("Import folder failed: " + (err as Error).message);
    } finally {
      setZipBusy(null);
    }
  };

  return (
    <div className="narc" ref={rootRef}>
      <div className="narc-bar">
        <span className="narc-info">{entries.length} embedded files — click to inspect, or extract/replace each</span>
        <span className="narc-bar-actions">
          <button className="btn btn--sm" disabled={zipBusy != null} onClick={() => void exportZip()}>
            {zipBusy === "export" ? "…" : "Export folder (zip)"}
          </button>
          <button className="btn btn--sm" disabled={zipBusy != null} onClick={() => zipRef.current?.click()}>
            {zipBusy === "import" ? "…" : "Import folder (zip)"}
          </button>
        </span>
      </div>
      <div className="narc-grid">
        {entries.map((e) => (
          <div key={e.index} className="narc-item">
            <button
              className="narc-open"
              onClick={() => void select({ container: state.narcHandle, id: e.index }, `${selection.name} : #${e.index}`)}
            >
              <span className="narc-idx">#{e.index}</span>
              <span className={"badge" + (e.format ? " badge--fmt" : "")}>{e.format || "raw"}</span>
              <span className="narc-size">{e.size}B</span>
            </button>
            <span className="narc-actions">
              <button
                className="icon-btn"
                title="Extract this file (decompressed)"
                disabled={busy != null}
                onClick={() => void exportEntry(e)}
              >
                {busy === e.index ? "…" : "↓"}
              </button>
              <button
                className="icon-btn"
                title="Replace this file's bytes"
                disabled={busy != null}
                onClick={() => {
                  importTarget.current = { container: state.narcHandle, id: e.index };
                  importRef.current?.click();
                }}
              >
                ↑
              </button>
            </span>
          </div>
        ))}
      </div>
      <input
        ref={importRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onImportChosen(f);
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onZipChosen(f);
        }}
      />
    </div>
  );
}
