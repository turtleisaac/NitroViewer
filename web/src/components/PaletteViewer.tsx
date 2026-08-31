import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { PaletteData } from "../transport";
import { download } from "../util";
import { sameHex, snapHex } from "../color";
import { useDraftEditor } from "../useDraftEditor";
import { ColorPicker } from "./ColorPicker";

// Render the palette to a swatch-grid PNG (16 columns) so it can be exported, recolored in any image
// editor, and re-imported. Each color is a solid SWATCH block, big enough to survive PNG round-trips.
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

function cloneColors(c: string[]): string[] {
  return c.slice();
}

function colorsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameHex(a[i], b[i])) return false;
  return true;
}

export function PaletteViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const importPalette = useStore((s) => s.importPalette);
  const setPaletteColors = useStore((s) => s.setPaletteColors);
  const editVersion = useStore((s) => s.editVersion);
  const [pal, setPal] = useState<PaletteData | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [colors, setColors] = useState<string[] | null>(null);
  const [baseline, setBaseline] = useState<string[] | null>(null);
  const [undoStack, setUndoStack] = useState<string[][]>([]);
  const [redoStack, setRedoStack] = useState<string[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const committedRef = useRef<string[] | null>(null);
  const colorsRef = useRef<string[] | null>(null);
  colorsRef.current = colors;

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  useEffect(() => {
    let alive = true;
    setPal(null);
    setErr(undefined);
    setSelected(null);
    client
      .decodePalette(romHandle, { container: refContainer, id: refId })
      .then((p) => {
        if (!alive) return;
        setPal(p);
        const c = p.colors.map(snapHex);
        setColors(c);
        setBaseline(c);
        committedRef.current = cloneColors(c);
        setUndoStack([]);
        setRedoStack([]);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, refContainer, refId, editVersion]); // editVersion → re-decode after an import

  const dirty = !!(colors && baseline && !colorsEqual(colors, baseline));

  const pushCommitted = (next: string[]) => {
    const prev = committedRef.current;
    if (!prev || colorsEqual(prev, next)) {
      setColors(next);
      committedRef.current = cloneColors(next);
      return;
    }
    setUndoStack((s) => [...s, cloneColors(prev)]);
    setRedoStack([]);
    committedRef.current = cloneColors(next);
    setColors(next);
  };

  const undo = () => {
    setUndoStack((stack) => {
      if (stack.length === 0 || !committedRef.current) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, cloneColors(committedRef.current!)]);
      committedRef.current = cloneColors(prev);
      setColors(cloneColors(prev));
      return stack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((stack) => {
      if (stack.length === 0 || !committedRef.current) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, cloneColors(committedRef.current!)]);
      committedRef.current = cloneColors(next);
      setColors(cloneColors(next));
      return stack.slice(0, -1);
    });
  };

  useDraftEditor(
    pal
      ? {
          dirty,
          canUndo: undoStack.length > 0,
          canRedo: redoStack.length > 0,
          undo,
          redo,
          discardMessage: "You have unsaved palette edits. Discard them and leave?",
        }
      : null
  );

  const onImport = async (file: File) => {
    if (dirty && !window.confirm("Importing a PNG will replace your unsaved palette edits. Continue?")) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await importPalette(selection.ref, bytes);
      if (res.unique < res.colors)
        // Non-blocking heads-up: the image had fewer colors than the palette holds.
        console.info(`Palette import: ${res.unique} unique colors → padded to ${res.colors}.`);
    } catch (e) {
      alert("Palette import failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    const src = colors ?? pal?.colors;
    if (!src) return;
    const base = (selection.name.split(/[/:]/).pop() || "palette").replace(/[^\w.\-]+/g, "_");
    download(`${base}.png`, await paletteToPng(src), "image/png");
  };

  const onSave = async () => {
    if (!colors) return;
    setBusy(true);
    try {
      await setPaletteColors(selection.ref, colors);
    } catch (e) {
      alert("Saving palette failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    if (!baseline) return;
    setColors(cloneColors(baseline));
    committedRef.current = cloneColors(baseline);
    setUndoStack([]);
    setRedoStack([]);
    setSelected(null);
  };

  if (err) return <div className="error">Could not decode palette: {err}</div>;
  if (!pal || !colors) return <div className="placeholder">Decoding palette…</div>;

  return (
    <div className="palette">
      <div className="palette-bar">
        <div className="palette-info">
          {pal.count} colors
          {dirty ? <span className="palette-dirty"> · unsaved</span> : null}
          {selected != null ? <span> · #{selected}</span> : <span className="palette-hint"> · click a color to edit</span>}
        </div>
        <div className="palette-actions">
          {dirty && (
            <>
              <button className="btn btn--save btn--sm" disabled={busy} onClick={() => void onSave()}>
                {busy ? "…" : "Save"}
              </button>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
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
        {colors.map((c, i) => (
          <button
            key={i}
            type="button"
            className={"swatch" + (selected === i ? " swatch--selected" : "")}
            style={{ background: c }}
            title={`#${i} ${c}`}
            aria-label={`Color ${i} ${c}`}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          />
        ))}
      </div>
      {selected != null && colors[selected] && (
        <ColorPicker
          color={colors[selected]}
          onChange={(hex) => {
            setColors((prev) => {
              if (!prev) return prev;
              const next = prev.slice();
              next[selected] = hex;
              return next;
            });
          }}
          onCommit={(hex) => {
            const src = colorsRef.current ?? colors;
            const next = src.slice();
            next[selected] = snapHex(hex);
            pushCommitted(next);
          }}
        />
      )}
    </div>
  );
}
