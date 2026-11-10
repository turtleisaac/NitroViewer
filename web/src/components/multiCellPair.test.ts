import { describe, expect, it } from "vitest";
import type { ResourceItem } from "../state/store";
import { canPlayFrames, maxFrameOf, pairMultiCell } from "./multiCellPair";

function item(id: number, format: string): ResourceItem {
  return { ref: { container: 1, id }, label: `#${id}`, format };
}

const nmcr = item(0, "NMCR");
const ncer = item(1, "NCER");
const ncgr = item(2, "NCGR");
const nclr = item(3, "NCLR");
const lists = { nmcrs: [nmcr], ncers: [ncer], ncgrs: [ncgr], nclrs: [nclr] };

describe("pairMultiCell", () => {
  it("pairs an NMCR with the sibling cell, tileset, and palette", () => {
    const pair = pairMultiCell("NMCR", 0, [nmcr, ncer, ncgr, nclr], lists, [nmcr], {});
    expect(pair.nmcr).toBeUndefined();
    expect(pair.ncer?.id).toBe(1);
    expect(pair.ncgr?.id).toBe(2);
    expect(pair.nclr?.id).toBe(3);
  });

  it("keeps a saved override and pairs an NMAR through its multi-cell", () => {
    const saved = { ncer: { container: 1, id: 9 } };
    const pair = pairMultiCell("NMAR", 4, [nmcr, ncer, ncgr, nclr], lists, [item(4, "NMAR")], saved);
    expect(pair.nmcr?.id).toBe(0);
    expect(pair.ncer?.id).toBe(9);
  });

  it("reports the frame range and whether playback is useful", () => {
    expect(maxFrameOf([{ frames: 3 }], 0)).toBe(2);
    expect(maxFrameOf(undefined, 0)).toBe(-1);
    expect(canPlayFrames(2)).toBe(true);
    expect(canPlayFrames(1)).toBe(false);
    expect(canPlayFrames(undefined)).toBe(false);
  });
});
