import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { refKey, type ResourceRef } from "../transport";
import { base64ToBytes, download, exportFileName } from "../util";
import { NarcBrowser } from "./NarcBrowser";
import { PaletteViewer } from "./PaletteViewer";
import { SpriteViewer } from "./SpriteViewer";
import { TextureViewer } from "./TextureViewer";
import { ParticleViewer } from "./ParticleViewer";
import { InfoViewer } from "./InfoViewer";
import { SoundViewer } from "./SoundViewer";

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
  const isSound = fmt === "SDAT" || fmt === "SSEQ" || fmt === "SWAR" || fmt === "SWAV" || fmt === "STRM";

  return (
    <section className="pane inspector">
      <div className="pane-head inspector-head">
        <Breadcrumb />
        <span className="badge badge--fmt">{fmt || "raw"}</span>
        {selection.compressed && <span className="badge badge--lz">LZ</span>}
        <span className="dim">{selection.size.toLocaleString()} B</span>
        <span className="spacer" />
        <ImportButton />
        <ExportButton />
      </div>
      <div className="inspector-body">
        {(() => {
          // Fold editVersion into each viewer key so importing new bytes remounts the viewer and it
          // re-decodes from the edited ROM instead of showing stale pixels.
          const vkey = `${refKey(selection.ref)}:${editVersion}`;
          return isNarc ? (
            <NarcBrowser />
          ) : fmt === "NCLR" ? (
            <PaletteViewer key={vkey} />
          ) : isImage ? (
            // Keyed by ref only (not editVersion): the SpriteViewer re-decodes edits in place so an
            // import doesn't reset the user's tile width / palette / zoom. Other viewers remount.
            <SpriteViewer key={refKey(selection.ref)} />
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
