import { describe, expect, it } from "vitest";
import { floodFill, pixelsEqual } from "./pixelTools";

describe("floodFill", () => {
  it("fills a contiguous region and leaves other pixels", () => {
    // 4x3, a 2x2 block of 1s in the corner
    const src = Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 0, 2]);
    const out = floodFill(src, 4, 3, 0, 0, 9, 15);
    expect(Array.from(out)).toEqual([9, 9, 0, 0, 9, 9, 0, 2, 0, 0, 0, 2]);
    expect(pixelsEqual(src, Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 0, 2]))).toBe(true);
  });

  it("is a no-op when the target already is the fill color", () => {
    const src = Uint8Array.from([3, 3, 1, 1]);
    const out = floodFill(src, 2, 2, 0, 0, 3, 15);
    expect(out).not.toBe(src);
    expect(pixelsEqual(out, src)).toBe(true);
  });
});
