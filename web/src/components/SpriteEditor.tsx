import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { base64ToBytes } from "../util";
import { sameHex, snapHex } from "../color";
import { blitIndexed, floodFill, pixelsEqual } from "../pixelTools";
import { useDraftEditor } from "../useDraftEditor";
import type { ResourceRef } from "../transport";
import { ColorPicker } from "./ColorPicker";

type Tool = "pencil" | "fill" | "eyedropper";

interface Frame {
  pixels: Uint8Array;
  colors: string[];
}

function cloneFrame(f: Frame): Frame {
  return { pixels: new Uint8Array(f.pixels), colors: f.colors.slice() };
}

function framesEqual(a: Frame, b: Frame): boolean {
  return pixelsEqual(a.pixels, b.pixels) && a.colors.length === b.colors.length && a.colors.every((c, i) => sameHex(c, b.colors[i]));
}

export function SpriteEditor({
  ncgr,
  nclr,
  tilesWidth,
  paletteIndex,
  scanFrontToBack,
  transparent,
  initialZoom,
  onClose,
}: {
  ncgr: ResourceRef;
  nclr: ResourceRef;
  tilesWidth: number;
  paletteIndex: number;
  scanFrontToBack: boolean;
  transparent: boolean;
  initialZoom: number;
  onClose: () => void;
}) {
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const saveSpriteEdit = useStore((s) => s.saveSpriteEdit);

  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [bitDepth, setBitDepth] = useState(4);
  const [scanned, setScanned] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [baseline, setBaseline] = useState<Frame | null>(null);
  const [undoStack, setUndoStack] = useState<Frame[]>([]);
  const [redoStack, setRedoStack] = useState<Frame[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [selected, setSelected] = useState(1); // skip 0 (usually transparent)
  const [zoom, setZoom] = useState(Math.max(2, initialZoom));
  const [editColor, setEditColor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const committedRef = useRef<Frame | null>(null);
  const frameRef = useRef<Frame | null>(null);
  frameRef.current = frame;
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const strokeStart = useRef<Frame | null>(null);

  const maxIndex = (1 << bitDepth) - 1;
  const blockLen = bitDepth === 8 ? 256 : 16;
  const blockStart = bitDepth === 8 ? 0 : Math.max(0, paletteIndex) * 16;

  useEffect(() => {
    let alive = true;
    setErr(undefined);
    setBusy(true);
    (async () => {
      const [raster, pal] = await Promise.all([
        client.decodeNcgrIndexed(romHandle, ncgr, tilesWidth, scanFrontToBack),
        client.decodePalette(romHandle, nclr),
      ]);
      if (!alive) return;
      const pixels = base64ToBytes(raster.pixels);
      const colors = pal.colors.map(snapHex);
      const f: Frame = { pixels, colors };
      setWidth(raster.width);
      setHeight(raster.height);
      setBitDepth(raster.bitDepth);
      setScanned(!!raster.scanned);
      setFrame(f);
      setBaseline(cloneFrame(f));
      committedRef.current = cloneFrame(f);
      setUndoStack([]);
      setRedoStack([]);
      setSelected(raster.bitDepth === 4 ? 1 : 1);
    })()
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [client, romHandle, ncgr, nclr, tilesWidth, scanFrontToBack]);

  const visibleColors = frame
    ? frame.colors.slice(blockStart, bitDepth === 8 ? frame.colors.length : blockStart + blockLen)
    : [];

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame || width <= 0) return;
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    const vis = frame.colors.slice(blockStart, bitDepth === 8 ? frame.colors.length : blockStart + blockLen);
    blitIndexed(img, frame.pixels, vis, transparent ? 0 : null);
    ctx.putImageData(img, 0, 0);
  }, [frame, width, height, transparent, blockStart, blockLen, bitDepth]);

  const dirty = !!(frame && baseline && !framesEqual(frame, baseline));
  const paletteDirty = !!(frame && baseline && !frame.colors.every((c, i) => sameHex(c, baseline.colors[i])));

  const pushCommitted = (next: Frame) => {
    const prev = committedRef.current;
    if (!prev || framesEqual(prev, next)) {
      setFrame(cloneFrame(next));
      committedRef.current = cloneFrame(next);
      return;
    }
    setUndoStack((s) => [...s, cloneFrame(prev)]);
    setRedoStack([]);
    committedRef.current = cloneFrame(next);
    setFrame(cloneFrame(next));
  };

  const undo = () => {
    setUndoStack((stack) => {
      if (stack.length === 0 || !committedRef.current) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, cloneFrame(committedRef.current!)]);
      committedRef.current = cloneFrame(prev);
      setFrame(cloneFrame(prev));
      return stack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((stack) => {
      if (stack.length === 0 || !committedRef.current) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, cloneFrame(committedRef.current!)]);
      committedRef.current = cloneFrame(next);
      setFrame(cloneFrame(next));
      return stack.slice(0, -1);
    });
  };

  useDraftEditor({
    dirty,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    captureUndo: true,
    undo,
    redo,
    discardMessage: "You have unsaved sprite edits. Discard them and leave?",
  });

  const pixelAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv || width <= 0) return null;
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  };

  const trackHover = (p: { x: number; y: number } | null) => {
    const prev = hoverRef.current;
    if (!p && !prev) return;
    if (p && prev && p.x === prev.x && p.y === prev.y) return;
    setHover(p);
  };

  const paintAt = (buf: Uint8Array, x: number, y: number) => {
    // Scanned NCGRs store the XOR key in the first decrypted u16 (always reads as index 0).
    if (scanned && y === 0 && x < (bitDepth === 4 ? 4 : 2)) return;
    buf[y * width + x] = Math.max(0, Math.min(maxIndex, selected));
  };

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!frame || e.button !== 0) return;
    const p = pixelAt(e);
    if (!p) return;
    trackHover(p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eyedropper") {
      setSelected(frame.pixels[p.y * width + p.x]);
      setTool("pencil");
      return;
    }
    if (tool === "fill") {
      if (scanned && p.y === 0 && p.x < (bitDepth === 4 ? 4 : 2)) return;
      const filled = floodFill(frame.pixels, width, height, p.x, p.y, selected, maxIndex);
      if (scanned) {
        const z = bitDepth === 4 ? 4 : 2;
        for (let x = 0; x < z && x < width; x++) filled[x] = 0;
      }
      pushCommitted({ pixels: filled, colors: frame.colors.slice() });
      return;
    }
    painting.current = true;
    strokeStart.current = cloneFrame(frame);
    const buf = new Uint8Array(frame.pixels);
    paintAt(buf, p.x, p.y);
    setFrame({ pixels: buf, colors: frame.colors });
  };

  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pixelAt(e);
    trackHover(p);
    if (!painting.current || !frameRef.current || !p) return;
    const cur = frameRef.current;
    const buf = new Uint8Array(cur.pixels);
    paintAt(buf, p.x, p.y);
    setFrame({ pixels: buf, colors: cur.colors });
  };

  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    painting.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const cur = frameRef.current;
    const start = strokeStart.current;
    strokeStart.current = null;
    if (cur && start) pushCommitted(cur);
  };

  const onSave = async () => {
    if (!frame) return;
    setSaving(true);
    try {
      await saveSpriteEdit(
        ncgr,
        nclr,
        tilesWidth,
        scanFrontToBack,
        frame.pixels,
        paletteDirty ? frame.colors : undefined
      );
      onClose();
    } catch (e) {
      alert("Saving sprite failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    if (dirty && !window.confirm("Discard unsaved sprite edits?")) return;
    onClose();
  };

  const setVisibleColor = (hex: string, commit: boolean) => {
    const cur = frameRef.current;
    if (!cur) return;
    const next = cur.colors.slice();
    const i = blockStart + selected;
    if (i < 0 || i >= next.length) return;
    next[i] = snapHex(hex);
    const f: Frame = { pixels: new Uint8Array(cur.pixels), colors: next };
    if (commit) pushCommitted(f);
    else setFrame(f);
  };

  if (err) {
    return (
      <div className="sprite-editor">
        <div className="error">Could not open sprite editor: {err}</div>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (busy || !frame) return <div className="placeholder">Loading sprite editor…</div>;

  return (
    <div className="sprite-editor">
      <div className="editor-toolbar">
        <div className="editor-tools" role="toolbar" aria-label="Sprite tools">
          {(
            [
              ["pencil", "Pencil"],
              ["fill", "Fill"],
              ["eyedropper", "Eyedropper"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={"chip" + (tool === id ? " chip--on" : "")}
              onClick={() => setTool(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ctrl">
          <span>Zoom</span>
          <select value={zoom} onChange={(e) => setZoom(+e.target.value)}>
            {[1, 2, 3, 4, 6, 8, 12, 16].map((z) => (
              <option key={z} value={z}>
                {z}×
              </option>
            ))}
          </select>
        </label>
        <div className="editor-status">
          {width}×{height}px · {bitDepth}bpp
          {hover
            ? ` · (${hover.x}, ${hover.y})${frame ? ` #${frame.pixels[hover.y * width + hover.x]}` : ""}`
            : null}
          {dirty ? <span className="palette-dirty"> · unsaved</span> : null}
        </div>
        <span className="spacer" />
        <button className="btn btn--save btn--sm" disabled={saving || !dirty} onClick={() => void onSave()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn btn--ghost btn--sm" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="canvas-wrap editor-canvas-wrap">
        <div className="editor-canvas-stage" style={{ width: width * zoom, height: height * zoom }}>
          <canvas
            ref={canvasRef}
            className="editor-canvas"
            style={{ width: width * zoom, height: height * zoom }}
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            onPointerUp={onCanvasUp}
            onPointerLeave={() => trackHover(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              const p = pixelAt(e as unknown as React.PointerEvent<HTMLCanvasElement>);
              if (p && frame) setSelected(frame.pixels[p.y * width + p.x]);
            }}
          />
          {hover && (
            <div
              className="editor-pixel-hover"
              style={{
                left: hover.x * zoom,
                top: hover.y * zoom,
                width: zoom,
                height: zoom,
              }}
            />
          )}
        </div>
      </div>

      <div className="editor-palette-block">
        <div className="editor-palette-label">
          Palette
          {bitDepth === 4 ? ` · sub-palette ${paletteIndex}` : ""}
          {selected < visibleColors.length ? ` · #${selected} ${visibleColors[selected]}` : ""}
          <button
            className="link-btn"
            disabled={selected >= visibleColors.length}
            onClick={() => setEditColor((v) => !v)}
          >
            {editColor ? "Hide color editor" : "Edit color"}
          </button>
        </div>
        <div className="swatches editor-swatches">
          {visibleColors.map((c, i) => (
            <button
              key={i}
              type="button"
              className={"swatch" + (selected === i ? " swatch--selected" : "") + (transparent && i === 0 ? " swatch--trans" : "")}
              style={{ background: c }}
              title={`#${i} ${c}${i === 0 && transparent ? " (transparent)" : ""}`}
              aria-pressed={selected === i}
              onClick={() => {
                setSelected(i);
                setTool((t) => (t === "eyedropper" ? "pencil" : t));
              }}
              onDoubleClick={() => {
                setSelected(i);
                setEditColor(true);
              }}
            />
          ))}
        </div>
        {editColor && visibleColors[selected] && (
          <ColorPicker
            color={visibleColors[selected]}
            onChange={(hex) => setVisibleColor(hex, false)}
            onCommit={(hex) => setVisibleColor(hex, true)}
          />
        )}
      </div>
    </div>
  );
}
