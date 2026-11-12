import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useStore } from "../state/store";
import { resolveAllSpriteUnitGroups, type SpriteUnit } from "../state/grouping";
import { refKey, type NarcEntry, type ResourceRef } from "../transport";
import { base64ToBytes, download, exportFileName } from "../util";
import { BannerViewer } from "./BannerViewer";
import { NarcBrowser } from "./NarcBrowser";
import { PaletteViewer } from "./PaletteViewer";
import { SpriteViewer } from "./SpriteViewer";
import { TextureViewer } from "./TextureViewer";
import { ParticleViewer } from "./ParticleViewer";
import { InfoViewer } from "./InfoViewer";
import { SoundViewer } from "./SoundViewer";
import { BmgViewer } from "./BmgViewer";
import { FontViewer } from "./FontViewer";
import { MultiCellViewer } from "./MultiCellViewer";

// three.js is heavy; only load the 3D viewer (and three) when a model is actually opened.
const ModelViewer = lazy(() => import("./ModelViewer"));

function ExportButton() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn--sm"
      disabled={busy}
      title="Extract this file (decompressed) to disk"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await client.exportFile(romHandle, selection.ref);
          download(exportFileName(selection.name, r.format || selection.format), base64ToBytes(r.base64));
        } catch (e) {
          alert("Export failed: " + (e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : "Export"}
    </button>
  );
}

function ImportButton() {
  const selection = useStore((s) => s.selection)!;
  const importFile = useStore((s) => s.importFile);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className="btn btn--sm"
        disabled={busy}
        title="Replace this file's bytes (edits the in-memory ROM; use Save ROM to download)"
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : "Import…"}
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            await importFile(selection.ref, bytes);
          } catch (err) {
            alert("Import failed: " + (err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

// Full-path breadcrumb for the inspector header. Every folder segment is clickable (expands + scrolls
// the tree to it); a NARC segment (when viewing a file inside it) links back to that NARC's file list;
// the final segment is the current file/entry. This disambiguates HGSS's numeric a/X/Y/Z filesystem and
// gives one-click routes back into the tree and to the NARC listing (no re-hunting).
function Breadcrumb() {
  const selection = useStore((s) => s.selection)!;
  const idToPath = useStore((s) => s.idToPath);
  const narcs = useStore((s) => s.narcs);
  const select = useStore((s) => s.select);
  const revealFolder = useStore((s) => s.revealFolder);
  // Build the crumb chain by walking up: a ROM file → its FNT folder segments (each expands the tree) +
  // the file itself; a file inside a NARC → the crumbs to that NARC (a "back to its list" link) then the
  // entry index. Recurses through NARC-in-NARC, so every level is navigable.
  type Crumb = { label: string; onClick?: () => void };
  const crumbsFor = (ref: ResourceRef): Crumb[] => {
    if (ref.container < 0) {
      const full = idToPath[ref.id] ?? String(ref.id);
      const parts = full.split("/").filter(Boolean);
      return parts.map((part, i) =>
        i === parts.length - 1
          ? { label: part } // the file/NARC itself
          : { label: part, onClick: () => revealFolder("/" + parts.slice(0, i + 1).join("/") + "/") }
      );
    }
    const narcRef = narcs[ref.container]?.ref;
    const base = narcRef ? crumbsFor(narcRef) : [{ label: `NARC #${ref.container}` } as Crumb];
    const last = base[base.length - 1];
    if (narcRef && last) last.onClick = () => void select(narcRef, last.label); // back to that NARC's list
    return [...base, { label: `#${ref.id}` }];
  };

  const chain = crumbsFor(selection.ref);
  const nodes: ReactNode[] = [];
  chain.forEach((c, i) => {
    if (i > 0) nodes.push(<span key={`s${i}`} className="crumb-sep">›</span>);
    nodes.push(
      c.onClick ? (
        <button key={i} className="crumb crumb--link" onClick={c.onClick}>{c.label}</button>
      ) : (
        <span key={i} className="crumb crumb--current">{c.label}</span>
      )
    );
  });
  return <span className="insp-crumbs" title={chain.map((c) => c.label).join(" › ")}>{nodes}</span>;
}

// A persistent strip of the current file's NARC siblings, shown above whatever viewer is open for a
// NARC sub-file (an NCGR, NCLR, a nested NARC, …) — lets you scroll/click through the archive's
// contents without leaving the viewer, instead of bouncing back to NarcBrowser's full grid each time.
// Reads narcs[container] rather than calling ensureNarc itself: the only way to have a NARC sub-file
// selected at all is via NarcBrowser, which already populated it.
type StripItem =
  | { kind: "group"; anchor: number; unit: SpriteUnit; memberIds: number[] }
  // The group containing the file currently being viewed — expanded to its real members (e.g. all 4
  // sprite variants + both palettes) instead of one collapsed chip, since that file's own selection
  // already implies you're working with this specific unit and want its siblings within reach (the
  // other 3 NCGR variants, the shiny NCLR, …), not just the one representative member.
  | { kind: "expanded"; anchor: number; members: { index: number; format: string; size: number }[] }
  | { kind: "entry"; anchor: number; index: number; format: string; size: number };

function NarcSiblingStrip() {
  const selection = useStore((s) => s.selection)!;
  const narc = useStore((s) => s.narcs[selection.ref.container]);
  const select = useStore((s) => s.select);
  const narcPathOf = useStore((s) => s.narcPathOf);
  const gameCode = useStore((s) => s.romInfo?.gameCode);
  const narcGroupCollapse = useStore((s) => s.narcGroupCollapse);
  const setNarcGroupCollapse = useStore((s) => s.setNarcGroupCollapse);
  const activeRef = useRef<HTMLButtonElement>(null);
  const container = selection.ref.container;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selection.ref.container, selection.ref.id]);

  const narcPath = narc ? (narcPathOf(container) ?? selection.name) : null;
  const { items, hasGrouping } = useMemo(() => {
    if (!narc) return { items: [] as StripItem[], hasGrouping: false };
    const entryLikes = narc.entries.map((e) => ({ index: e.index, format: e.format }));
    const allGroups = resolveAllSpriteUnitGroups(gameCode, narcPath, container, entryLikes);
    const activeGroups = narcGroupCollapse ? allGroups : null;
    const consumed = new Set<number>();
    const out: StripItem[] = [];
    if (activeGroups) {
      for (const { unit, memberIndices } of activeGroups) {
        if (memberIndices.length === 0) continue;
        memberIndices.forEach((id) => consumed.add(id));
        const anchor = Math.min(...memberIndices);
        if (memberIndices.includes(selection.ref.id)) {
          const members = memberIndices
            .map((id) => narc.entries.find((e) => e.index === id))
            .filter((e): e is NarcEntry => !!e)
            .map((e) => ({ index: e.index, format: e.format, size: e.size }));
          out.push({ kind: "expanded", anchor, members });
        } else {
          out.push({ kind: "group", anchor, unit, memberIds: memberIndices });
        }
      }
    }
    for (const e of narc.entries) {
      if (consumed.has(e.index)) continue;
      out.push({ kind: "entry", anchor: e.index, index: e.index, format: e.format, size: e.size });
    }
    out.sort((a, b) => a.anchor - b.anchor);
    return { items: out, hasGrouping: !!allGroups && allGroups.length > 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narc, narcPath, gameCode, container, narcGroupCollapse, selection.ref.id]);

  if (!narc) return null;

  function toggleGroupCollapse() {
    const next = !narcGroupCollapse;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(() => setNarcGroupCollapse(next)));
    } else {
      setNarcGroupCollapse(next);
    }
  }

  const baseName = selection.name.replace(/ : #\d+$/, "").replace(/ group$/, "");

  const entryChip = (index: number, format: string, size: number) => {
    const active = index === selection.ref.id;
    return (
      <button
        key={index}
        ref={active ? activeRef : undefined}
        className={"narc-chip" + (active ? " active" : "")}
        title={`#${index} · ${format || "raw"} · ${size.toLocaleString()}B`}
        onClick={() => void select({ container, id: index }, `${baseName} : #${index}`)}
      >
        <span className="narc-chip-idx">#{index}</span>
        <span className="narc-chip-fmt">{format || "raw"}</span>
      </button>
    );
  };

  return (
    <div className="narc-strip">
      {hasGrouping && (
        <button
          className="narc-strip-toggle"
          title={narcGroupCollapse ? "Showing grouped files — click to show every file" : "Showing every file — click to group related files"}
          onClick={toggleGroupCollapse}
        >
          {narcGroupCollapse ? "⊞" : "⊟"}
        </button>
      )}
      {items.map((item) => {
        if (item.kind === "expanded") {
          // The group the current file belongs to — its real members instead of one collapsed chip,
          // so the other sprite variants / the alternate palette stay one click away.
          return (
            <div key={`e${item.anchor}`} className="narc-chip-cluster" title={`#${item.anchor} group, expanded`}>
              {item.members.map((m) => entryChip(m.index, m.format, m.size))}
            </div>
          );
        }
        if (item.kind === "group") {
          const active = item.memberIds.includes(selection.ref.id);
          const target = item.unit.nanr ?? item.unit.ncer ?? item.unit.ncgr ?? item.unit.nclr;
          return (
            <button
              key={`g${item.anchor}`}
              ref={active ? activeRef : undefined}
              className={"narc-chip narc-chip--group" + (active ? " active" : "")}
              title={`#${item.anchor} group · ${item.memberIds.length} files`}
              disabled={!target}
              onClick={() => target && void select({ container, id: target.id }, `${baseName} : #${item.anchor} group`)}
            >
              <span className="narc-chip-idx">#{item.anchor}</span>
              <span className="narc-chip-fmt">×{item.memberIds.length}</span>
            </button>
          );
        }
        return entryChip(item.index, item.format, item.size);
      })}
    </div>
  );
}

export function InspectorPane() {
  const selection = useStore((s) => s.selection);
  const editVersion = useStore((s) => s.editVersion);
  if (!selection) {
    return (
      <section className="pane inspector">
        <div className="pane-head">Inspector</div>
        <div className="placeholder">Select a file from the tree to inspect it.</div>
      </section>
    );
  }

  const fmt = selection.format;
  const isNarc = fmt === "NARC"; // a NARC anywhere — including a NARC-in-NARC — opens the browser
  const isImage = fmt === "NCGR" || fmt === "NSCR" || fmt === "NCER" || fmt === "NANR";
  const isMultiCell = fmt === "NMCR" || fmt === "NMAR";
  const isSound = fmt === "SDAT" || fmt === "SSEQ" || fmt === "SWAR" || fmt === "SWAV" || fmt === "STRM";
  // The banner isn't a FAT file: it has its own icon/title controls, so it skips the generic
  // Breadcrumb / Import / Export header (which assume a real (container,id) resource).
  const isBanner = fmt === "BANNER";

  return (
    <section className="pane inspector">
      <div className="pane-head inspector-head">
        {isBanner ? (
          <span className="insp-crumbs">
            <span className="crumb crumb--current">Game icon &amp; titles</span>
          </span>
        ) : (
          <Breadcrumb />
        )}
        <span className="badge badge--fmt">{isBanner ? "BANNER" : fmt || "raw"}</span>
        {selection.compressed && <span className="badge badge--lz">LZ</span>}
        <span className="dim">{selection.size.toLocaleString()} B</span>
        <span className="spacer" />
        {!isBanner && (
          <>
            <ImportButton />
            <ExportButton />
          </>
        )}
      </div>
      <div className="inspector-body">
        {selection.ref.container >= 0 && <NarcSiblingStrip />}
        {(() => {
          // Fold editVersion into each viewer key so importing new bytes remounts the viewer and it
          // re-decodes from the edited ROM instead of showing stale pixels.
          const vkey = `${refKey(selection.ref)}:${editVersion}`;
          return isBanner ? (
            <BannerViewer key={vkey} />
          ) : isNarc ? (
            <NarcBrowser />
          ) : fmt === "NCLR" ? (
            <PaletteViewer key={vkey} />
          ) : isImage ? (
            // Keyed by ref only (not editVersion): the SpriteViewer re-decodes edits in place so an
            // import doesn't reset the user's tile width / palette / zoom. Other viewers remount.
            <SpriteViewer key={refKey(selection.ref)} />
          ) : isMultiCell ? (
            <MultiCellViewer key={refKey(selection.ref)} />
          ) : fmt === "BMG" ? (
            <BmgViewer key={refKey(selection.ref)} />
          ) : fmt === "NFTR" ? (
            <FontViewer key={refKey(selection.ref)} />
          ) : fmt === "NSBTX" ? (
            <TextureViewer key={vkey} />
          ) : fmt === "SPA" ? (
            <ParticleViewer key={vkey} />
          ) : isSound ? (
            <SoundViewer key={refKey(selection.ref)} />
          ) : fmt === "NSBMD" ? (
            <Suspense fallback={<div className="placeholder">Loading 3D viewer…</div>}>
              <ModelViewer key={vkey} />
            </Suspense>
          ) : (
            <InfoViewer key={vkey} />
          );
        })()}
      </div>
    </section>
  );
}
