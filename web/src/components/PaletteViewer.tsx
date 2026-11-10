import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../state/store";
import { useChangedKey } from "../useChangedKey";
import type { PaletteData } from "../transport";
import {
  applyDecodedPalette,
  cancelPaletteEdits,
  commitColor,
  exportPalettePng,
  importPaletteFile,
  paintColor,
  paletteDirty,
  pushCommitted,
  savePaletteColors,
  stepColorStack,
} from "./paletteEdit";
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
  return new Promise((resolve) => {
    cv.toBlob((b) => {
      void (async () => {
        resolve(new Uint8Array(await b!.arrayBuffer()));
      })();
    }, "image/png");
  });
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
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  if (useChangedKey(`${romHandle}:${refContainer}:${refId}:${editVersion}`)) {
    setPal(null);
    setErr(undefined);
    setSelected(null);
  }
  useEffect(() => {
    let alive = true;
    client
      .decodePalette(romHandle, { container: refContainer, id: refId })
      .then((p) => {
        if (!alive) return;
        applyDecodedPalette(p, setPal, setColors, setBaseline, committedRef, setUndoStack, setRedoStack);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, refContainer, refId, editVersion]); // editVersion → re-decode after an import

  const dirty = paletteDirty(colors, baseline);

  const undo = () => setUndoStack((stack) => stepColorStack(stack, committedRef, setRedoStack, setColors));
  const redo = () => setRedoStack((stack) => stepColorStack(stack, committedRef, setUndoStack, setColors));

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

  const onImport = (file: File) =>
    importPaletteFile(
      file,
      dirty,
      () => window.confirm("Importing a PNG will replace your unsaved palette edits. Continue?"),
      selection.ref,
      importPalette,
      setBusy
    );

  const onExport = () => exportPalettePng(selection.name, colors, pal, paletteToPng);
  const onSave = () => savePaletteColors(colors, selection.ref, setPaletteColors, setBusy);
  const onCancel = () => cancelPaletteEdits(baseline, setColors, committedRef, setUndoStack, setRedoStack, setSelected);

  if (err) return <div className="error">Could not decode palette: {err}</div>;
  if (!pal || !colors) return <div className="placeholder">Decoding palette…</div>;

  return (
    <PaletteView
      pal={pal}
      colors={colors}
      dirty={dirty}
      busy={busy}
      selected={selected}
      setSelected={setSelected}
      setColors={setColors}
      fileRef={fileRef}
      colorsRef={colorsRef}
      committedRef={committedRef}
      setUndoStack={setUndoStack}
      setRedoStack={setRedoStack}
      onSave={onSave}
      onCancel={onCancel}
      onExport={onExport}
      onImport={onImport}
    />
  );
}

function PaletteView(props: {
  pal: PaletteData;
  colors: string[];
  dirty: boolean;
  busy: boolean;
  selected: number | null;
  setSelected: (index: number) => void;
  setColors: Dispatch<SetStateAction<string[] | null>>;
  fileRef: { current: HTMLInputElement | null };
  colorsRef: { current: string[] | null };
  committedRef: { current: string[] | null };
  setUndoStack: (fn: (stack: string[][]) => string[][]) => void;
  setRedoStack: (stack: string[][]) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const {
    pal, colors, dirty, busy, selected, setSelected, setColors, fileRef, colorsRef, committedRef,
    setUndoStack, setRedoStack, onSave, onCancel, onExport, onImport,
  } = props;
  return (
    <div className="palette">
      <PaletteBar
        count={pal.count}
        dirty={dirty}
        busy={busy}
        selected={selected}
        fileRef={fileRef}
        onSave={onSave}
        onCancel={onCancel}
        onExport={onExport}
        onImport={onImport}
      />
      <Swatches colors={colors} selected={selected} setSelected={setSelected} />
      {selected != null && colors[selected] && (
        <ColorPicker
          color={colors[selected]}
          onChange={(hex) => setColors((prev) => paintColor(prev, selected, hex))}
          onCommit={(hex) => commitSwatch(colorsRef.current ?? colors, selected, hex, committedRef, setColors, setUndoStack, setRedoStack)}
        />
      )}
    </div>
  );
}

/** Commits one swatch edit onto the undo stack. */
function commitSwatch(
  colors: string[],
  index: number,
  hex: string,
  committedRef: { current: string[] | null },
  setColors: Dispatch<SetStateAction<string[] | null>>,
  setUndoStack: (fn: (stack: string[][]) => string[][]) => void,
  setRedoStack: (stack: string[][]) => void
) {
  pushCommitted(commitColor(colors, index, hex), committedRef, setColors, setUndoStack, setRedoStack);
}

function PaletteBar(props: {
  count: number;
  dirty: boolean;
  busy: boolean;
  selected: number | null;
  fileRef: { current: HTMLInputElement | null };
  onSave: () => Promise<void>;
  onCancel: () => void;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const { count, dirty, busy, selected, fileRef, onSave, onCancel, onExport, onImport } = props;
  return (
    <div className="palette-bar">
      <div className="palette-info">
        {count} colors
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
        <button className="link-btn" onClick={() => { void onExport(); }}>
          Export PNG
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
  );
}

function Swatches(props: { colors: string[]; selected: number | null; setSelected: (index: number) => void }) {
  const { colors, selected, setSelected } = props;
  return (
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
  );
}
