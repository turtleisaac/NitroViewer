import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { refKey, ROM_CONTAINER } from "../transport";
import { base64ToBytes, download } from "../util";
import { NarcBrowser } from "./NarcBrowser";
import { PaletteViewer } from "./PaletteViewer";
import { SpriteViewer } from "./SpriteViewer";
import { TextureViewer } from "./TextureViewer";
import { ParticleViewer } from "./ParticleViewer";
import { InfoViewer } from "./InfoViewer";

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
      onClick={async () => {
        setBusy(true);
        try {
          const r = await client.exportRaw(romHandle, selection.ref);
          const base = (selection.name.split(/[\/:]/).pop() || "file").replace(/[^\w.\-]+/g, "_");
          download(`${base}.bin`, base64ToBytes(r.base64));
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
  const { container, id } = selection.ref;

  const insideNarc = container >= 0;
  const narcRomFileId = insideNarc ? narcs[container]?.romFileId : undefined;
  const fullPath = insideNarc
    ? (narcRomFileId != null ? idToPath[narcRomFileId] : undefined) ?? `NARC #${container}`
    : idToPath[id] ?? selection.name;

  const parts = fullPath.split("/").filter(Boolean); // e.g. ["poketool","trgra","trbgra.narc"]
  const crumbs: ReactNode[] = [];
  let acc = "/";
  parts.forEach((part, i) => {
    const isLast = i === parts.length - 1;
    if (i > 0) crumbs.push(<span key={`s${i}`} className="crumb-sep">›</span>);
    if (!isLast) {
      const folderPath = (acc += part + "/"); // "/poketool/", then "/poketool/trgra/"
      crumbs.push(
        <button key={i} className="crumb crumb--link" title={`Show ${folderPath} in the tree`}
                onClick={() => revealFolder(folderPath)}>
          {part}
        </button>
      );
    } else if (insideNarc) {
      // the NARC file itself → back to its listing
      crumbs.push(
        <button key={i} className="crumb crumb--link" title={`Back to ${fullPath}`}
                onClick={() => narcRomFileId != null && void select({ container: ROM_CONTAINER, id: narcRomFileId }, part)}>
          {part}
        </button>
      );
    } else {
      crumbs.push(<span key={i} className="crumb crumb--current">{part}</span>);
    }
  });
  if (insideNarc) {
    crumbs.push(<span key="es" className="crumb-sep">›</span>);
    crumbs.push(<span key="e" className="crumb crumb--current">#{id}</span>);
  }

  return <span className="insp-crumbs" title={insideNarc ? `${fullPath} › #${id}` : fullPath}>{crumbs}</span>;
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
  const isNarc = fmt === "NARC" && selection.ref.container === ROM_CONTAINER;
  const isImage = fmt === "NCGR" || fmt === "NSCR" || fmt === "NCER" || fmt === "NANR";

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
