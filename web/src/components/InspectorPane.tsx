import { useState } from "react";
import { useStore } from "../state/store";
import { refKey, ROM_CONTAINER } from "../transport";
import { base64ToBytes, download } from "../util";
import { NarcBrowser } from "./NarcBrowser";
import { PaletteViewer } from "./PaletteViewer";
import { SpriteViewer } from "./SpriteViewer";
import { InfoViewer } from "./InfoViewer";

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

export function InspectorPane() {
  const selection = useStore((s) => s.selection);
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
        <span className="insp-name" title={selection.name}>{selection.name}</span>
        <span className="badge badge--fmt">{fmt || "raw"}</span>
        {selection.compressed && <span className="badge badge--lz">LZ</span>}
        <span className="dim">{selection.size.toLocaleString()} B</span>
        <span className="spacer" />
        <ExportButton />
      </div>
      <div className="inspector-body">
        {isNarc ? (
          <NarcBrowser />
        ) : fmt === "NCLR" ? (
          <PaletteViewer key={refKey(selection.ref)} />
        ) : isImage ? (
          <SpriteViewer key={refKey(selection.ref)} />
        ) : (
          <InfoViewer key={refKey(selection.ref)} />
        )}
      </div>
    </section>
  );
}
