import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { DecodedImage, FontGlyphSheet, FontMeta } from "../transport";
import { base64ToBytes } from "../util";

const SHEET_COLUMNS = 16;
const SHEET_SCALE = 2;
const EDITOR_CELL_PX = 22;

export function FontViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const setFontGlyphPixels = useStore((s) => s.setFontGlyphPixels);
  const editVersion = useStore((s) => s.editVersion);

  const [meta, setMeta] = useState<FontMeta | null>(null);
  const [sheet, setSheet] = useState<FontGlyphSheet | null>(null);
  const [err, setErr] = useState<string>();

  const [glyphIndex, setGlyphIndex] = useState<number | null>(null);
  const [pixels, setPixels] = useState<number[] | null>(null); // width*height intensities 0-255, draft
  const [savedPixels, setSavedPixels] = useState<number[] | null>(null);
  const [ink, setInk] = useState(255);
  const [busy, setBusy] = useState(false);
  const painting = useRef(false);

  const [preview, setPreview] = useState("Hello!");
  const [previewImg, setPreviewImg] = useState<DecodedImage | null>(null);

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  const ref = useMemo(() => ({ container: refContainer, id: refId }), [refContainer, refId]);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    setSheet(null);
    setErr(undefined);
    setGlyphIndex(null);
    setPixels(null);
    Promise.all([client.decodeFontMeta(romHandle, ref), client.renderFontGlyphSheet(romHandle, ref, SHEET_COLUMNS, SHEET_SCALE)])
      .then(([m, s]) => {
        if (!alive) return;
        setMeta(m);
        setSheet(s);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, ref, editVersion]);

  useEffect(() => {
    let alive = true;
    if (glyphIndex == null) return;
    client
      .decodeFontGlyphPixels(romHandle, ref, glyphIndex)
      .then((p) => {
        if (!alive) return;
        const bytes = Array.from(base64ToBytes(p.pixels));
        setPixels(bytes);
        setSavedPixels(bytes);
      })
      .catch((e) => alive && alert("Could not decode glyph: " + (e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, ref, glyphIndex, editVersion]);

  useEffect(() => {
    let alive = true;
    if (!preview) {
      setPreviewImg(null);
      return;
    }
    const id = setTimeout(() => {
      client
        .renderFontString(romHandle, ref, 3, preview)
        .then((img) => alive && setPreviewImg(img))
        .catch(() => alive && setPreviewImg(null));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [client, romHandle, ref, preview, editVersion]);

  const dirty = !!(pixels && savedPixels && pixels.some((v, i) => v !== savedPixels[i]));

  const paintAt = (i: number, value: number) => {
    setPixels((prev) => {
      if (!prev) return prev;
      if (prev[i] === value) return prev;
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  };

  const onSave = async () => {
    if (glyphIndex == null || !pixels) return;
    setBusy(true);
    try {
      await setFontGlyphPixels(selection.ref, glyphIndex, new Uint8Array(pixels));
    } catch (e) {
      alert("Saving glyph failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div className="error">Could not decode font: {err}</div>;
  if (!meta || !sheet) return <div className="placeholder">Decoding font…</div>;

  const rows = Math.ceil(meta.numGlyphs / SHEET_COLUMNS);
  const cellW = sheet.cellWidth * SHEET_SCALE + SHEET_SCALE; // matches renderGlyphSheet's (cw+1)*scale cell pitch
  const cellH = sheet.cellHeight * SHEET_SCALE + SHEET_SCALE;

  return (
    <div className="font">
      <div className="palette-bar">
        <div className="palette-info">
          {meta.numGlyphs} glyphs · {meta.cellWidth}×{meta.cellHeight}px · {meta.bitDepth}bpp · line feed {meta.lineFeed}
        </div>
      </div>

      <div className="font-preview">
        <input
          type="text"
          value={preview}
          onChange={(e) => setPreview(e.target.value)}
          placeholder="Preview text…"
        />
        {previewImg && <img className="sprite-img font-preview-img" src={previewImg.png} alt="" />}
      </div>

      <div className="font-sheet-wrap">
        <img className="sprite-img" src={sheet.png} width={sheet.width} height={sheet.height} alt="" />
        <div
          className="font-sheet-grid"
          style={{ gridTemplateColumns: `repeat(${SHEET_COLUMNS}, ${cellW}px)`, gridAutoRows: `${cellH}px` }}
        >
          {Array.from({ length: SHEET_COLUMNS * rows }, (_, i) => (
            <button
              key={i}
              type="button"
              className={"font-glyph-cell" + (glyphIndex === i ? " font-glyph-cell--selected" : "")}
              disabled={i >= meta.numGlyphs}
              title={`Glyph #${i}`}
              onClick={() => setGlyphIndex(i)}
            />
          ))}
        </div>
      </div>

      {glyphIndex != null && pixels && (
        <div className="font-editor">
          <div className="font-editor-head">
            <span>Glyph #{glyphIndex}</span>
            <label className="ctrl ctrl--inline">
              <span>Ink</span>
              <input type="range" min={0} max={255} value={ink} onChange={(e) => setInk(+e.target.value)} />
            </label>
            <button className="btn btn--save btn--sm" disabled={busy || !dirty} onClick={() => void onSave()}>
              {busy ? "…" : "Save"}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              disabled={busy || !dirty}
              onClick={() => setPixels(savedPixels ? savedPixels.slice() : pixels)}
            >
              Revert
            </button>
            <span className="dim">Left-click/drag to paint, right-click to erase</span>
          </div>
          <div
            className="font-glyph-editor"
            style={{ gridTemplateColumns: `repeat(${sheet.cellWidth}, ${EDITOR_CELL_PX}px)` }}
            onMouseLeave={() => (painting.current = false)}
            onMouseUp={() => (painting.current = false)}
          >
            {pixels.map((v, i) => (
              <div
                key={i}
                className="font-glyph-px"
                style={{ background: `rgb(${v},${v},${v})`, width: EDITOR_CELL_PX, height: EDITOR_CELL_PX }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  painting.current = true;
                  paintAt(i, e.button === 2 ? 0 : ink);
                }}
                onMouseEnter={() => {
                  if (painting.current) paintAt(i, ink);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  paintAt(i, 0);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
