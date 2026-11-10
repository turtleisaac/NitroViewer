// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { describe, expect, it, vi } from "vitest";
import type { ResourceItem } from "../state/store";
import {
  applyPendingKind,
  bothRefs,
  decodeSprite,
  finishPending,
  hintedTileCount,
  importDisabled,
  importReady,
  importTitle,
  itemsKeyOf,
  maxFrameOf,
  nanrBlock,
  nanrPlaying,
  ncgrBlock,
  nextSpritePair,
  pairBlock,
  pendingText,
  requireNanr,
  requireNclr,
  requireTiles,
  roleSuffix,
  runSpriteImport,
  savedOrUnit,
  scanFront,
  showImporter,
  showSpriteEditor,
  spriteDepKey,
  spriteViewSeed,
  threeRefs,
  tilesFromPx,
  tilesPx,
  unitSlot,
} from "./spriteViewerLogic";

const ref = (id: number) => ({ container: 1, id });
const item = (id: number, format: string): ResourceItem => ({ ref: ref(id), label: `#${id}`, format });

describe("sprite viewer logic", () => {
  it("pairs, seeds, and describes controls", () => {
    expect(savedOrUnit(ref(1), ref(2), ref(3))).toEqual(ref(1));
    expect(savedOrUnit(undefined, undefined, ref(3))).toEqual(ref(3));
    expect(unitSlot(null, "ncgr")).toBeUndefined();
    expect(unitSlot({ ncgr: ref(4) }, "ncgr")).toEqual(ref(4));
    const items = [item(1, "NCGR"), item(2, "NCLR"), item(3, "NCER")];
    const pair = nextSpritePair({
      items, saved: {}, gameCode: undefined, narcPath: null, container: 1, id: 1,
      peers: [item(1, "NCGR")], ncgrs: [item(1, "NCGR")], nclrs: [item(2, "NCLR")], ncers: [item(3, "NCER")],
    });
    expect(pair.nclr).toEqual(ref(2));
    expect(itemsKeyOf(items)).toContain("NCLR");
    expect(hintedTileCount(null)).toBe(0);
    expect(hintedTileCount({ tileWidth: 16 })).toBe(2);
    expect(scanFront(null)).toBe(true);
    expect(scanFront({ scanDirection: "back-to-front" })).toBe(false);
    const seed = spriteViewSeed(undefined, null, 1);
    expect(seed.transparent).toBe(true);
    expect(tilesPx(0)).toBe(0);
    expect(tilesPx(2)).toBe(16);
    expect(tilesFromPx("17")).toBe(2);
    expect(roleSuffix(undefined)).toBe("");
    expect(roleSuffix("battle-sprite")).toContain("battle sprite");
    expect(showImporter("NSCR")).toBe(true);
    expect(showImporter("NCLR")).toBe(false);
    expect(maxFrameOf([], 0)).toBe(-1);
    expect(maxFrameOf([3], 0)).toBe(2);
    expect(nanrPlaying("NANR", true, [2], 0)).toBe(true);
    expect(nanrPlaying("NCGR", true, [2], 0)).toBe(false);
    expect(bothRefs(ref(1), undefined)).toBe(false);
    expect(threeRefs(ref(1), ref(2), ref(3))).toBe(true);
    expect(importReady("NCGR", { nclr: ref(1) })).toBe(true);
    expect(importReady("NANR", {})).toBe(false);
    expect(importReady("NSCR", { ncgr: ref(1), nclr: ref(2) })).toBe(true);
    expect(importDisabled("NCGR", true, false, { nclr: ref(1) })).toBe(true);
    expect(importTitle("NCGR", {})).toContain("palette");
    expect(importTitle("NCGR", { nclr: ref(1) })).toContain("Replace");
    expect(importTitle("NSCR", {})).toContain("tileset");
    expect(importTitle("NCER", { ncgr: ref(1), nclr: ref(2) })).toContain("cell");
    expect(importTitle("NANR", {})).toContain("NCER");
    expect(showSpriteEditor("NCGR", true, ref(1))).toBe(true);
    expect(pendingText({ bytes: new Uint8Array(), unmatched: 1, w: 2, h: 2, kind: "ncgr" })).toContain("pixels");
    expect(pendingText({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "cell" })).toContain("don't match");
    expect(ncgrBlock(ref(1))).toBeNull();
    expect(ncgrBlock(undefined)).toContain("palette");
    expect(pairBlock(ref(1), undefined, "need")).toBe("need");
    expect(nanrBlock(ref(1), ref(2), ref(3))).toBeNull();
    expect(spriteDepKey({
      selKey: "1:1", fmt: "NCGR", pair: { ncgr: ref(1) }, transparent: true, tilesWidth: 0,
      scanFrontToBack: true, paletteIndex: 0, cellIndex: 0, animIndex: 0, frameIndex: 0, editVersion: 0,
    })).toContain("NCGR");
    expect(() => requireNclr(undefined)).toThrow(/palette/);
    expect(requireTiles(ref(1), ref(2), "x").ncgr).toEqual(ref(1));
    expect(() => requireTiles(undefined, ref(2), "x")).toThrow(/x/);
    expect(() => requireNanr(undefined, ref(1), ref(2))).toThrow(/animation/i);
  });

  it("imports, applies, and rejects unknown formats", async () => {
    const alerted = vi.fn();
    window.alert = alerted;
    const setBusy = vi.fn();
    const setPending = vi.fn();
    await runSpriteImport(new File([new Uint8Array([1])], "a.png"), {
      blocked: "nope", requiresOk: false, kind: "ncgr", failPrefix: "PNG import failed: ",
      dry: async () => ({ unmatched: 0 }), apply: async () => undefined,
    }, setBusy, setPending);
    expect(alerted).toHaveBeenCalledWith("nope");
    await runSpriteImport(new File([new Uint8Array([1])], "a.png"), {
      blocked: null, requiresOk: true, kind: "screen", failPrefix: "Background import failed: ",
      dry: async () => ({ ok: false, unmatched: 1 }), apply: async () => undefined,
    }, setBusy, setPending);
    expect(alerted).toHaveBeenCalled();
    await runSpriteImport(new File([new Uint8Array([1])], "a.png"), {
      blocked: null, requiresOk: false, kind: "ncgr", failPrefix: "PNG import failed: ",
      dry: async () => ({ unmatched: 2, width: 4, height: 4 }), apply: async () => undefined,
    }, setBusy, setPending);
    expect(setPending).toHaveBeenCalled();
    await runSpriteImport(new File([new Uint8Array([1])], "a.png"), {
      blocked: null, requiresOk: false, kind: "ncgr", failPrefix: "PNG import failed: ",
      dry: async () => ({ unmatched: 0 }), apply: async () => undefined,
    }, setBusy, setPending);
    const apply = { screen: vi.fn(async () => undefined), cell: vi.fn(async () => undefined), nanr: vi.fn(async () => undefined), ncgr: vi.fn(async () => undefined) };
    expect(await applyPendingKind({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "screen" }, {}, apply)).toBe(false);
    expect(await applyPendingKind({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "cell" }, { ncgr: ref(1), nclr: ref(2) }, apply)).toBe(true);
    expect(await applyPendingKind({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "nanr" }, { ncer: ref(1), ncgr: ref(2), nclr: ref(3) }, apply)).toBe(true);
    expect(await applyPendingKind({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "ncgr" }, {}, apply)).toBe(false);
    const clear = vi.fn();
    await finishPending(null, {}, apply, setBusy, clear);
    await finishPending({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "ncgr" }, { nclr: ref(1) }, apply, setBusy, clear);
    expect(clear).toHaveBeenCalledWith(null);
    apply.ncgr.mockRejectedValueOnce(new Error("no"));
    await finishPending({ bytes: new Uint8Array(), unmatched: 1, w: 0, h: 0, kind: "ncgr" }, { nclr: ref(1) }, apply, setBusy, clear);
    await expect(decodeSprite("NOPE", { ncgr: async () => { throw new Error("x"); }, nscr: async () => { throw new Error("x"); }, ncer: async () => { throw new Error("x"); }, nanr: async () => { throw new Error("x"); } })).rejects.toThrow(/Unsupported/);
    const image = { width: 1, height: 1, png: "data:image/png,xx" };
    await expect(decodeSprite("NCGR", { ncgr: async () => image, nscr: async () => image, ncer: async () => image, nanr: async () => image })).resolves.toBe(image);
  });
});
