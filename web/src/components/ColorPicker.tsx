import { useEffect, useRef, useState } from "react";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, snapBgr555, snapHex } from "../color";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function ColorPicker({
  color,
  onChange,
  onCommit,
}: {
  color: string;
  onChange: (hex: string) => void;
  onCommit: (hex: string) => void;
}) {
  const snapped = snapHex(color);
  const rgb = hexToRgb(snapped);
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb.r, rgb.g, rgb.b));
  const [hexField, setHexField] = useState(snapped.slice(1));
  const dragging = useRef(false);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const kindRef = useRef<"sv" | "hue" | "val">("sv");

  // External color change (another swatch selected) — don't clobber an in-progress drag.
  useEffect(() => {
    if (dragging.current) return;
    const next = hexToRgb(snapHex(color));
    setHsv(rgbToHsv(next.r, next.g, next.b));
    setHexField(snapHex(color).slice(1));
  }, [color]);

  const emit = (next: { h: number; s: number; v: number }, commit: boolean) => {
    hsvRef.current = next;
    setHsv(next);
    const raw = hsvToRgb(next.h, next.s, next.v);
    const s555 = snapBgr555(raw.r, raw.g, raw.b);
    const hex = rgbToHex(s555.r, s555.g, s555.b);
    setHexField(hex.slice(1));
    onChange(hex);
    if (commit) onCommit(hex);
  };

  const fromPointer = (el: HTMLElement, e: React.PointerEvent, kind: "sv" | "hue" | "val") => {
    const r = el.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    const cur = hsvRef.current;
    if (kind === "sv") emit({ ...cur, s: x, v: 1 - y }, false);
    else if (kind === "hue") emit({ ...cur, h: x * 360 }, false);
    else emit({ ...cur, v: x }, false);
  };

  const onDown = (kind: "sv" | "hue" | "val") => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    kindRef.current = kind;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.currentTarget, e, kind);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    fromPointer(e.currentTarget, e, kindRef.current);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const cur = hsvRef.current;
    const raw = hsvToRgb(cur.h, cur.s, cur.v);
    const s555 = snapBgr555(raw.r, raw.g, raw.b);
    onCommit(rgbToHex(s555.r, s555.g, s555.b));
  };

  const setChannel = (ch: "r" | "g" | "b", n: number) => {
    const next = { ...rgb, [ch]: clamp(n | 0, 0, 255) };
    const s555 = snapBgr555(next.r, next.g, next.b);
    const hex = rgbToHex(s555.r, s555.g, s555.b);
    setHsv(rgbToHsv(s555.r, s555.g, s555.b));
    setHexField(hex.slice(1));
    onChange(hex);
  };

  const hueRgb = hsvToRgb(hsv.h, 1, 1);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const valRgb = hsvToRgb(hsv.h, hsv.s, 1);
  const valColor = rgbToHex(valRgb.r, valRgb.g, valRgb.b);

  return (
    <div className="color-picker">
      <div className="color-picker-visual">
        <div
          className="sv-square"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          }}
          onPointerDown={onDown("sv")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          role="slider"
          aria-label="Saturation and brightness"
        >
          <div
            className="sv-cursor"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: snapped }}
          />
        </div>
        <div className="color-sliders">
          <div
            className="hue-slider"
            onPointerDown={onDown("hue")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            role="slider"
            aria-label="Hue"
          >
            <div className="slider-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div
            className="val-slider"
            style={{ background: `linear-gradient(to right, #000, ${valColor})` }}
            onPointerDown={onDown("val")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            role="slider"
            aria-label="Brightness"
          >
            <div className="slider-thumb" style={{ left: `${hsv.v * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="color-picker-fields">
        <div className="color-preview" style={{ background: snapped }} title={snapped} />
        <label className="color-field">
          <span>Hex</span>
          <input
            value={hexField}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
              setHexField(v);
              if (v.length === 6) {
                const hex = snapHex("#" + v);
                const n = hexToRgb(hex);
                setHsv(rgbToHsv(n.r, n.g, n.b));
                onChange(hex);
              }
            }}
            onBlur={() => {
              const hex = snapHex("#" + hexField.padEnd(6, "0"));
              setHexField(hex.slice(1));
              onCommit(hex);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        {(["r", "g", "b"] as const).map((ch) => (
          <label key={ch} className="color-field color-field--ch">
            <span>{ch.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              step={8}
              value={rgb[ch]}
              onChange={(e) => setChannel(ch, +e.target.value)}
              onBlur={() => onCommit(snapped)}
            />
          </label>
        ))}
        <label className="color-field color-field--native" title="System color picker">
          <span>Picker</span>
          <input
            type="color"
            value={snapped}
            onChange={(e) => {
              const hex = snapHex(e.target.value);
              const n = hexToRgb(hex);
              setHsv(rgbToHsv(n.r, n.g, n.b));
              setHexField(hex.slice(1));
              onChange(hex);
            }}
            onBlur={() => onCommit(snapped)}
          />
        </label>
      </div>
      <div className="color-picker-hint">DS palettes are 15-bit (BGR555) — colors snap to steps of 8.</div>
    </div>
  );
}
