import { describe, expect, it } from "vitest";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, snapBgr555, snapHex } from "./color";

describe("BGR555 snap", () => {
  it("matches Nds4j's /8 then <<3 unpack (255 → 248)", () => {
    expect(snapBgr555(255, 0, 255)).toEqual({ r: 248, g: 0, b: 248 });
    expect(snapHex("#ff00ff")).toBe("#f800f8");
  });

  it("is idempotent on already-snapped values", () => {
    const s = snapBgr555(248, 16, 80);
    expect(snapBgr555(s.r, s.g, s.b)).toEqual(s);
  });
});

describe("hex ↔ rgb", () => {
  it("round-trips 6-digit hex", () => {
    expect(rgbToHex(248, 0, 248)).toBe("#f800f8");
    expect(hexToRgb("#f800f8")).toEqual({ r: 248, g: 0, b: 248 });
  });

  it("expands 3-digit hex", () => {
    expect(hexToRgb("#f0f")).toEqual({ r: 255, g: 0, b: 255 });
  });
});

describe("hsv", () => {
  it("round-trips primary colors", () => {
    for (const hex of ["#f80000", "#00f800", "#0000f8", "#f8f8f8", "#000000"]) {
      const rgb = hexToRgb(hex);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(rgbToHex(back.r, back.g, back.b)).toBe(hex);
    }
  });
});
