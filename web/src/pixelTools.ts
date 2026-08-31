/** 4-connected flood fill on a row-major index buffer. Returns a new buffer; `src` is not mutated. */
export function floodFill(
  src: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: number,
  maxIndex: number
): Uint8Array {
  if (x < 0 || y < 0 || x >= width || y >= height) return src;
  const out = new Uint8Array(src);
  const target = out[y * width + x];
  const paint = Math.max(0, Math.min(maxIndex, color | 0));
  if (target === paint) return out;
  const stack: number[] = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    const i = cy * width + cx;
    if (out[i] !== target) continue;
    out[i] = paint;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  return out;
}

export function setPixel(src: Uint8Array, width: number, x: number, y: number, color: number, maxIndex: number): Uint8Array {
  const out = new Uint8Array(src);
  out[y * width + x] = Math.max(0, Math.min(maxIndex, color | 0));
  return out;
}

export function pixelsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function blitIndexed(
  dest: ImageData,
  pixels: Uint8Array,
  colors: string[],
  transparentIndex: number | null
): void {
  const d = dest.data;
  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i];
    const hex = colors[idx] ?? "#000000";
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    const o = i * 4;
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = transparentIndex != null && idx === transparentIndex ? 0 : 255;
  }
}
