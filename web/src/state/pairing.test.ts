import { describe, it, expect } from "vitest";
import { pickSibling, pickNearestAfter } from "./pairing";
import type { ResourceItem } from "./store";

const item = (id: number, format: string): ResourceItem => ({
  ref: { container: 0, id },
  label: `#${id}`,
  format,
});

describe("pickSibling", () => {
  it("returns undefined when there are no candidates", () => {
    expect(pickSibling([], [item(0, "NCGR")], 0)).toBeUndefined();
  });

  it("matches by ordinal when sibling and self lists are parallel (sprite[k] ↔ palette[k])", () => {
    const ncgrs = [item(0, "NCGR"), item(1, "NCGR"), item(2, "NCGR")];
    const nclrs = [item(10, "NCLR"), item(11, "NCLR"), item(12, "NCLR")];
    expect(pickSibling(nclrs, ncgrs, 0)).toEqual({ container: 0, id: 10 });
    expect(pickSibling(nclrs, ncgrs, 1)).toEqual({ container: 0, id: 11 });
    expect(pickSibling(nclrs, ncgrs, 2)).toEqual({ container: 0, id: 12 });
  });

  it("groups consecutive sprites onto a shared palette when there are fewer palettes", () => {
    const ncgrs = [item(0, "NCGR"), item(1, "NCGR"), item(2, "NCGR"), item(3, "NCGR")];
    const nclrs = [item(10, "NCLR"), item(20, "NCLR")]; // 4 sprites, 2 palettes
    expect(pickSibling(nclrs, ncgrs, 0)).toEqual({ container: 0, id: 10 });
    expect(pickSibling(nclrs, ncgrs, 1)).toEqual({ container: 0, id: 10 });
    expect(pickSibling(nclrs, ncgrs, 2)).toEqual({ container: 0, id: 20 });
    expect(pickSibling(nclrs, ncgrs, 3)).toEqual({ container: 0, id: 20 });
  });

  it("spreads sprites across palettes when there are more palettes than sprites", () => {
    const ncgrs = [item(0, "NCGR"), item(1, "NCGR")];
    const nclrs = [item(10, "NCLR"), item(11, "NCLR"), item(12, "NCLR"), item(13, "NCLR")];
    expect(pickSibling(nclrs, ncgrs, 0)).toEqual({ container: 0, id: 10 });
    expect(pickSibling(nclrs, ncgrs, 1)).toEqual({ container: 0, id: 12 });
  });

  it("falls back to nearest container index when the selection is not among its peers", () => {
    const nclrs = [item(10, "NCLR"), item(30, "NCLR")];
    expect(pickSibling(nclrs, [], 25)).toEqual({ container: 0, id: 30 });
  });

  it("returns the only candidate for a singleton bundle (NANR → its one NCER)", () => {
    expect(pickSibling([item(2, "NCER")], [item(0, "NANR")], 0)).toEqual({ container: 0, id: 2 });
  });

  it("sorts unordered candidates before matching by ordinal", () => {
    const ncgrs = [item(0, "NCGR"), item(1, "NCGR")];
    const nclrs = [item(21, "NCLR"), item(20, "NCLR")]; // out of order
    expect(pickSibling(nclrs, ncgrs, 0)).toEqual({ container: 0, id: 20 });
    expect(pickSibling(nclrs, ncgrs, 1)).toEqual({ container: 0, id: 21 });
  });
});

describe("pickNearestAfter", () => {
  it("picks the first candidate at or after the model index (manene: model 51 → anim 53)", () => {
    const nsbca = [item(40, "NSBCA"), item(53, "NSBCA"), item(56, "NSBCA")];
    expect(pickNearestAfter(nsbca, 51)).toEqual({ container: 0, id: 53 });
    expect(pickNearestAfter(nsbca, 53)).toEqual({ container: 0, id: 53 }); // exact
  });

  it("falls back to the last candidate before the model when none are after", () => {
    const nsbca = [item(10, "NSBCA"), item(20, "NSBCA")];
    expect(pickNearestAfter(nsbca, 99)).toEqual({ container: 0, id: 20 });
  });

  it("returns undefined with no candidates", () => {
    expect(pickNearestAfter([], 5)).toBeUndefined();
  });
});
