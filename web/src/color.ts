/** DS palettes store BGR555 (5 bits/channel). Match Nds4j: pack via `/8`, unpack via `<< 3`. */
export function snapBgr555(r: number, g: number, b: number): { r: number; g: number; b: number } {
  return {
    r: (clamp8(r) >> 3) << 3,
    g: (clamp8(g) >> 3) << 3,
    b: (clamp8(b) >> 3) << 3,
  };
}

export function clamp8(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const v = parseInt(full, 16);
  if (!Number.isFinite(v) || full.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [clamp8(r), clamp8(g), clamp8(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function snapHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const s = snapBgr555(r, g, b);
  return rgbToHex(s.r, s.g, s.b);
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = clamp8(r) / 255;
  const gg = clamp8(g) / 255;
  const bb = clamp8(b) / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + 6) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rp = 0,
    gp = 0,
    bp = 0;
  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function sameHex(a: string, b: string): boolean {
  return snapHex(a) === snapHex(b);
}
