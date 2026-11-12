import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useStore } from "../state/store";
import { resolveAllSpriteUnitGroups, type SpriteUnit } from "../state/grouping";
import { refKey, type NarcEntry, type NitroViewerClient, type ResourceRef } from "../transport";
import { base64ToBytes, download, exportFileName } from "../util";

type GridItem =
  | { kind: "group"; anchor: number; unit: SpriteUnit; members: { index: number; format: string }[] }
  | { kind: "entry"; anchor: number; entry: NarcEntry };

// A unit's members are only ever a handful of small refs — join them into one string so effects/memos
// can key off unit *identity* (do these members represent the same unit as last render?) instead of
// object identity, which is fresh every render since resolveAllSpriteUnitGroups recomputes the array.
function unitKey(unit: SpriteUnit): string {
  return [unit.ncgr, unit.nclr, unit.ncer, unit.nanr].map((r) => (r ? refKey(r) : "-")).join("|");
}

// Renders the same priority a viewer would pick for this unit — NANR (animation) needs its NCER+NCGR+
// NCLR to compose a frame; NCER (a cell) needs NCGR+NCLR; a bare NCGR falls back to NCGR+NCLR directly.
// Whichever it is, this is also what clicking the card opens (the most complete view available).
function primaryMember(unit: SpriteUnit): ResourceRef | null {
  if (unit.nanr && unit.ncer && unit.ncgr && unit.nclr) return unit.nanr;
  if (unit.ncer && unit.ncgr && unit.nclr) return unit.ncer;
  if (unit.ncgr && unit.nclr) return unit.ncgr;
  return null;
}

async function decodeThumbnail(client: NitroViewerClient, romHandle: number, unit: SpriteUnit): Promise<string> {
  if (unit.nanr && unit.ncer && unit.ncgr && unit.nclr) {
    const img = await client.decodeNanr(romHandle, unit.nanr, unit.ncer, unit.ncgr, unit.nclr, 0, 0, true);
    return img.png;
  }
  if (unit.ncer && unit.ncgr && unit.nclr) {
    const img = await client.decodeNcer(romHandle, unit.ncer, unit.ncgr, unit.nclr, 0, true);
    return img.png;
  }
  if (unit.ncgr && unit.nclr) {
    const img = await client.decodeNcgr(romHandle, unit.ncgr, unit.nclr, 0, true, 0, true);
    return img.png;
  }
  throw new Error("Nothing viewable in this unit.");
}

// Only decodes once the card actually scrolls near the viewport — a fully collapsed pl_pokegra.narc is
// ~500 units, and CheerpJ's Java calls are single-flight (one in-flight RPC at a time), so eagerly
// decoding all of them up front would serialize into a very long queue before anything painted.
function useNearViewport<T extends Element>(rootMargin = "400px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const root = el.closest(".inspector-body");
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          obs.disconnect();
        }
      },
      { root, rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [near]);
  return [ref, near] as const;
}

function GroupCard({
  unit,
  anchor,
  container,
  members,
}: {
  unit: SpriteUnit;
  anchor: number;
  container: number;
  members: { index: number; format: string }[];
}) {
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const select = useStore((s) => s.select);
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = unitKey(unit);

  useEffect(() => {
    if (!near || thumb || failed) return;
    let alive = true;
    decodeThumbnail(client, romHandle, unit)
      .then((png) => alive && setThumb(png))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, key]);

  const target = primaryMember(unit);

  return (
    <div ref={ref} className="narc-item narc-group" title={`#${anchor} group · ${members.length} files`}>
      <button className="narc-open" disabled={!target} onClick={() => target && void select(target, `#${anchor} group`)}>
        <span className="narc-thumb">
          {thumb ? (
            <img src={thumb} alt="" />
          ) : failed ? (
            <span className="narc-thumb-x">✕</span>
          ) : (
            <span className="narc-thumb-spinner" aria-label="Decoding" />
          )}
        </span>
        <span className="narc-idx">#{anchor}</span>
        <span className="badge">×{members.length}</span>
      </button>
      <span className="narc-actions">
        {/* Jump straight to any real member (the other sprite variants, the shiny palette, …) without
            first landing on the card's default (primary) member. */}
        <select
          className="narc-group-pick"
          title="Open a specific file in this group"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) void select({ container, id }, `#${anchor} group : #${id}`);
          }}
        >
          <option value="" disabled>
            ⋯
          </option>
          {members.map((m) => (
            <option key={m.index} value={m.index}>
              #{m.index} · {m.format || "raw"}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
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
  const narcPathOf = useStore((s) => s.narcPathOf);
  const gameCode = useStore((s) => s.romInfo?.gameCode);
  const narcGroupCollapse = useStore((s) => s.narcGroupCollapse);
  const setNarcGroupCollapse = useStore((s) => s.setNarcGroupCollapse);
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

  // Read entries from the store so a per-entry import (which re-lists the NARC) refreshes the grid.
  // Null-safe (state may not have loaded yet) so this and the memo below stay above the early returns —
  // hooks can't follow a conditional return.
  const entries = state ? (narcs[state.narcHandle]?.entries ?? state.entries) : [];
  const narcPath = state ? (narcPathOf(state.narcHandle) ?? selection.name) : null;

  // Collapse game-DB-declared sprite units (NCGR+NCLR+NCER+NANR, etc.) into one card each, interleaved
  // in narc order with whatever's left ungrouped. Memoized so it doesn't redo an O(entries) pass on
  // every incidental re-render — dragHoverKey alone changes on every dragover tick during a drag.
  const { items, hasGrouping } = useMemo(() => {
    if (!state) return { items: [] as GridItem[], hasGrouping: false };
    const entryLikes = entries.map((e) => ({ index: e.index, format: e.format }));
    const allGroups = resolveAllSpriteUnitGroups(gameCode, narcPath, state.narcHandle, entryLikes);
    const activeGroups = narcGroupCollapse ? allGroups : null;
    const consumed = new Set<number>();
    const out: GridItem[] = [];
    if (activeGroups) {
      for (const { unit, memberIndices } of activeGroups) {
        if (memberIndices.length === 0) continue;
        memberIndices.forEach((id) => consumed.add(id));
        const members = memberIndices
          .map((id) => entries.find((e) => e.index === id))
          .filter((e): e is NarcEntry => !!e)
          .map((e) => ({ index: e.index, format: e.format }));
        out.push({ kind: "group", anchor: Math.min(...memberIndices), unit, members });
      }
    }
    for (const e of entries) {
      if (consumed.has(e.index)) continue;
      out.push({ kind: "entry", anchor: e.index, entry: e });
    }
    out.sort((a, b) => a.anchor - b.anchor);
    return { items: out, hasGrouping: !!allGroups && allGroups.length > 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, entries, narcPath, gameCode, narcGroupCollapse]);

  if (err) return <div className="error">Could not open NARC: {err}</div>;
  if (!state) return <div className="placeholder">Opening NARC…</div>;

  function toggleGroupCollapse() {
    const next = !narcGroupCollapse;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(() => setNarcGroupCollapse(next)));
    } else {
      setNarcGroupCollapse(next);
    }
  }

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
          {hasGrouping && (
            <label className="ctrl ctrl--inline">
              <input type="checkbox" checked={narcGroupCollapse} onChange={toggleGroupCollapse} />
              <span>Group related files</span>
            </label>
          )}
          <button className="btn btn--sm" disabled={zipBusy != null} onClick={() => void exportZip()}>
            {zipBusy === "export" ? "…" : "Export folder (zip)"}
          </button>
          <button className="btn btn--sm" disabled={zipBusy != null} onClick={() => zipRef.current?.click()}>
            {zipBusy === "import" ? "…" : "Import folder (zip)"}
          </button>
        </span>
      </div>
      <div className="narc-grid">
        {items.map((item) => {
          if (item.kind === "group") {
            return (
              <GroupCard
                key={`g${unitKey(item.unit)}`}
                unit={item.unit}
                anchor={item.anchor}
                container={state.narcHandle}
                members={item.members}
              />
            );
          }
          const e = item.entry;
          return (
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
          );
        })}
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
