import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { PaletteData } from "../transport";
import { download } from "../util";

// Render the palette to a swatch-grid PNG (16 columns) so it can be exported, recoloured in any image
// editor, and re-imported. Each colour is a solid SWATCH block, big enough to survive PNG round-trips.
function paletteToPng(colors: string[], block = 16, cols = 16): Promise<Uint8Array> {
  const rows = Math.ceil(colors.length / cols);
  const cv = document.createElement("canvas");
  cv.width = cols * block;
  cv.height = rows * block;
  const cx = cv.getContext("2d")!;
  colors.forEach((c, i) => {
    cx.fillStyle = c;
    cx.fillRect((i % cols) * block, Math.floor(i / cols) * block, block, block);
  });
  return new Promise((resolve) =>
    cv.toBlob(async (b) => resolve(new Uint8Array(await b!.arrayBuffer())), "image/png")
  );
}

export function PaletteViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const importPalette = useStore((s) => s.importPalette);
  const editVersion = useStore((s) => s.editVersion);
  const [pal, setPal] = useState<PaletteData | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  useEffect(() => {
    let alive = true;
    setPal(null);
    setErr(undefined);
    client
      .decodePalette(romHandle, { container: refContainer, id: refId })
      .then((p) => alive && setPal(p))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, refContainer, refId, editVersion]); // editVersion → re-decode after an import

  const onImport = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await importPalette(selection.ref, bytes);
      if (res.unique < res.colors)
        // Non-blocking heads-up: the image had fewer colours than the palette holds.
        console.info(`Palette import: ${res.unique} unique colours → padded to ${res.colors}.`);
    } catch (e) {
      alert("Palette import failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    if (!pal) return;
    const base = (selection.name.split(/[/:]/).pop() || "palette").replace(/[^\w.\-]+/g, "_");
    download(`${base}.png`, await paletteToPng(pal.colors), "image/png");
  };

  if (err) return <div className="error">Could not decode palette: {err}</div>;
  if (!pal) return <div className="placeholder">Decoding palette…</div>;

  return (
    <div className="palette">
      <div className="palette-bar">
        <div className="palette-info">{pal.count} colors</div>
        <div className="palette-actions">
          <button className="link-btn" onClick={onExport}>
            Export PNG ↓
          </button>
          <button className="play-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "…" : "Import…"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f);
            }}
          />
        </div>
      </div>
      <div className="swatches">
        {pal.colors.map((c, i) => (
          <div key={i} className="swatch" style={{ background: c }} title={`#${i} ${c}`} />
        ))}
      </div>
    </div>
  );
}
