import { describe, it, expect } from "vitest";
import { pickSibling } from "./pairing";
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

  it("falls back to nearest container index when the lists are not parallel", () => {
    const ncgrs = [item(0, "NCGR"), item(1, "NCGR"), item(2, "NCGR"), item(3, "NCGR")];
    const nclrs = [item(10, "NCLR"), item(20, "NCLR")]; // fewer palettes than sprites
    expect(pickSibling(nclrs, ncgrs, 3)).toEqual({ container: 0, id: 10 }); // 3 nearer 10
    expect(pickSibling(nclrs, ncgrs, 18)).toEqual({ container: 0, id: 20 }); // 18 nearer 20
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
