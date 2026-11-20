import { describe, expect, it } from "vitest";
import type { OamBox } from "../transport";
import { autoPair } from "./autoPair";
import type { ResourceItem } from "./store";

function item(id: number, format: string, facts: Partial<ResourceItem> = {}): ResourceItem {
  return { ref: { container: 0, id }, label: `#${id}`, format, ...facts };
}

const box = (tile: number, colors: number, wide = 1, high = 1): OamBox => ({ tile, wide, high, colors });

describe("autoPair", () => {
  it("pairs inside a repeated row instead of the nearest file", () => {
    const items = [
      item(0, "NCGR"),
      item(1, "NCLR"),
      item(2, "NCGR"),
      item(3, "NCLR"),
    ];

    const pair = autoPair(items, "NCGR", 2);

    expect(pair.nclr).toBe(3);
    expect(pair.ncgr).toBe(2);
  });

  it("keeps the first palette in a row when a later copy shares the column", () => {
    const items = [
      item(0, "NCGR"),
      item(1, "NCGR"),
      item(2, "NCGR"),
      item(3, "NCGR"),
      item(4, "NCLR"),
      item(5, "NCLR"),
      item(6, "NCGR"),
      item(7, "NCGR"),
      item(8, "NCGR"),
      item(9, "NCGR"),
      item(10, "NCLR"),
      item(11, "NCLR"),
    ];

    const pair = autoPair(items, "NCGR", 8);

    expect(pair.nclr).toBe(10);
  });

  it("ignores an empty slot when deciding the column format", () => {
    const items = [
      item(0, "NCGR"),
      item(1, ""),
      item(2, "NCGR"),
      item(3, "NCGR"),
      item(4, "NCLR"),
      item(5, "NCLR"),
      item(6, "NCGR"),
      item(7, "NCGR"),
      item(8, "NCGR"),
      item(9, "NCGR"),
      item(10, "NCLR"),
      item(11, "NCLR"),
    ];

    const pair = autoPair(items, "NCGR", 6);

    expect(pair.nclr).toBe(10);
  });

  it("pairs a trainer row with its first tileset, palette, and cells", () => {
    const row = (base: number) => [
      item(base, "NCGR"),
      item(base + 1, "NCLR"),
      item(base + 2, "NCER"),
      item(base + 3, "NANR"),
      item(base + 4, "NCGR"),
    ];
    const items = [...row(0), ...row(5)];

    const pair = autoPair(items, "NANR", 3);

    expect(pair).toEqual({ ncgr: 0, nclr: 1, ncer: 2 });
  });

  it("does not treat one short archive as a repeating pattern", () => {
    const items = [
      item(0, "NCGR", { depth: 3, tileBytes: 32 }),
      item(1, "NCLR", { colors: 256 }),
      item(2, "NCER", { boundary: 0, objects: [box(0, 16, 2, 2)] }),
      item(3, "NANR"),
    ];

    const pair = autoPair(items, "NANR", 3);

    expect(pair.ncer).toBe(2);
    expect(pair.ncgr).toBeUndefined();
  });

  it("picks the neighbor tileset and palette that can hold the animation", () => {
    const objects = [box(0, 16, 2, 2)];
    const items = [
      item(39, "NCGR", { depth: 3, tileBytes: 32 }),
      item(59, "NCLR", { colors: 256 }),
      item(63, "NCLR", { colors: 256 }),
      item(64, "NCGR", { depth: 3, tileBytes: 4480 }),
      item(65, "NCER", { boundary: 0, objects }),
      item(66, "NANR"),
    ];

    const pair = autoPair(items, "NANR", 66);

    expect(pair).toEqual({ ncgr: 64, nclr: 63, ncer: 65 });
  });

  it("uses a 64-byte boundary when the cell bank says so", () => {
    const objects = [box(1, 16)];
    const items = [
      item(0, "NCER", { boundary: 1, objects }),
      item(1, "NCGR", { depth: 3, tileBytes: 64 }),
      item(2, "NCGR", { depth: 3, tileBytes: 128 }),
      item(3, "NCLR", { colors: 16 }),
    ];

    const pair = autoPair(items, "NCER", 0);

    expect(pair.ncgr).toBe(2);
  });

  it("rejects a tileset whose color depth does not match the OBJ", () => {
    const items = [
      item(0, "NCER", { boundary: 0, objects: [box(0, 16)] }),
      item(1, "NCGR", { depth: 4, tileBytes: 4096 }),
      item(2, "NCGR", { depth: 3, tileBytes: 4096 }),
      item(3, "NCLR", { colors: 256 }),
    ];

    const pair = autoPair(items, "NCER", 0);

    expect(pair.ncgr).toBe(2);
  });

  it("rejects an odd tile number on an 8bpp OBJ", () => {
    const items = [
      item(0, "NCER", { boundary: 0, objects: [box(1, 256)] }),
      item(1, "NCGR", { depth: 4, tileBytes: 4096 }),
      item(2, "NCLR", { colors: 256 }),
    ];

    const pair = autoPair(items, "NCER", 0);

    expect(pair.ncgr).toBeUndefined();
  });

  it("keeps a screen on the tileset that contains its tile numbers", () => {
    const items = [
      item(0, "NCGR", { depth: 3, tileBytes: 32 * 128 }),
      item(1, "NCLR", { colors: 256 }),
      item(2, "NCGR", { depth: 3, tileBytes: 32 }),
      item(3, "NSCR", { maxTile: 100 }),
    ];

    const pair = autoPair(items, "NSCR", 3);

    expect(pair.ncgr).toBe(0);
    expect(pair.nclr).toBe(1);
  });

  it("needs 256 colors for an 8bpp tileset", () => {
    const items = [
      item(0, "NCGR", { depth: 4, tileBytes: 128 }),
      item(1, "NCLR", { colors: 16 }),
      item(2, "NCLR", { colors: 256 }),
    ];

    const pair = autoPair(items, "NCGR", 0);

    expect(pair.nclr).toBe(2);
  });

  it("skips a palette that does not hold a 4bpp bank", () => {
    const items = [
      item(0, "NCGR", { depth: 3, tileBytes: 64 }),
      item(1, "NCLR", { colors: 8 }),
      item(2, "NCLR", { colors: 16 }),
    ];

    const pair = autoPair(items, "NCGR", 0);

    expect(pair.nclr).toBe(2);
  });

  it("does not compare palette and tileset depth fields", () => {
    const items = [
      item(0, "NCGR", { depth: 3, tileBytes: 64 }),
      item(1, "NCLR", { colors: 16 }),
    ];

    const pair = autoPair(items, "NCGR", 0);

    expect(pair.nclr).toBe(1);
  });

  it("skips a check when the header field is missing", () => {
    const items = [
      item(0, "NCER", { objects: [box(0, 16, 4, 4)] }),
      item(1, "NCGR", { depth: 3, tileBytes: 32 }),
      item(2, "NCLR"),
    ];

    const pair = autoPair(items, "NCER", 0);

    expect(pair.ncgr).toBe(1);
    expect(pair.nclr).toBe(2);
  });

  it("falls back to the nearest tileset when an animation has no cell bank", () => {
    const items = [
      item(0, "NCGR", { depth: 3, tileBytes: 64 }),
      item(1, "NCLR", { colors: 16 }),
      item(4, "NANR"),
    ];

    const pair = autoPair(items, "NANR", 4);

    expect(pair.ncer).toBeUndefined();
    expect(pair.ncgr).toBe(0);
    expect(pair.nclr).toBe(1);
  });
});
