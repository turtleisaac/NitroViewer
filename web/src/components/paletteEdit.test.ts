// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { describe, expect, it, vi } from "vitest";
import {
  cancelPaletteEdits,
  colorsEqual,
  commitColor,
  exportPalettePng,
  importPaletteFile,
  paintColor,
  paletteDirty,
  paletteFileBase,
  pushCommitted,
  savePaletteColors,
  stepColorStack,
} from "./paletteEdit";

describe("palette edits", () => {
  it("compares, paints, and commits colors", () => {
    expect(colorsEqual(["#fff"], ["#ffffff"])).toBe(true);
    expect(colorsEqual(["#fff"], ["#000"])).toBe(false);
    expect(colorsEqual(["#fff"], ["#fff", "#000"])).toBe(false);
    expect(paletteDirty(["#000"], ["#fff"])).toBe(true);
    expect(paletteDirty(null, ["#fff"])).toBe(false);
    expect(paintColor(null, 0, "#111")).toBeNull();
    expect(paintColor(["#000"], 0, "#111")).toEqual(["#111"]);
    expect(commitColor(["#abc"], 0, "abc")).toEqual(["#a8b8c8"]);
    expect(paletteFileBase("a/b/pal.nclr")).toBe("pal.nclr");
    expect(paletteFileBase("")).toBe("palette");
  });

  it("pushes undo and walks it back and forward", () => {
    const ref = { current: ["#000"] as string[] | null };
    const colors: string[][] = [];
    const undos: string[][][] = [];
    const redos: string[][][] = [];
    const pushUndo = (fn: (stack: string[][]) => string[][]) => {
      undos.push(fn([]));
    };
    pushCommitted(["#000"], ref, (c) => colors.push(c), pushUndo, (s) => redos.push(s));
    expect(undos).toEqual([]);
    pushCommitted(["#111"], ref, (c) => colors.push(c), pushUndo, (s) => redos.push(s));
    expect(undos[0]).toEqual([["#000"]]);

    const setOther = vi.fn();
    const setColors = vi.fn();
    expect(stepColorStack([], ref, setOther, setColors)).toEqual([]);
    const left = stepColorStack([["#000"]], ref, (fn: (stack: string[][]) => string[][]) => {
      setOther(fn([]));
    }, setColors);
    expect(left).toEqual([]);
    expect(setColors).toHaveBeenCalledWith(["#000"]);

    ref.current = ["#000"];
    const again = stepColorStack([["#111"]], ref, (fn: (stack: string[][]) => string[][]) => {
      setOther(fn([]));
    }, setColors);
    expect(again).toEqual([]);
    expect(setColors).toHaveBeenCalledWith(["#111"]);
  });

  it("imports, saves, exports, and cancels", async () => {
    const setBusy = vi.fn();
    const importPalette = vi.fn(async () => ({ unique: 1, colors: 4 }));
    await importPaletteFile(new File(["a"], "a.png"), true, () => false, { container: -1, id: 1 }, importPalette, setBusy);
    expect(importPalette).not.toHaveBeenCalled();
    await importPaletteFile(new File(["a"], "a.png"), false, () => true, { container: -1, id: 1 }, importPalette, setBusy);
    expect(importPalette).toHaveBeenCalled();
    importPalette.mockResolvedValueOnce({ unique: 4, colors: 4 });
    await importPaletteFile(new File(["a"], "a.png"), false, () => true, { container: -1, id: 1 }, importPalette, setBusy);
    importPalette.mockRejectedValueOnce(new Error("bad"));
    const alerted = vi.fn();
    window.alert = alerted;
    await importPaletteFile(new File(["a"], "a.png"), false, () => true, { container: -1, id: 1 }, importPalette, setBusy);
    expect(alerted).toHaveBeenCalled();

    const setPaletteColors = vi.fn(async () => undefined);
    await savePaletteColors(null, { container: -1, id: 1 }, setPaletteColors, setBusy);
    await savePaletteColors(["#000"], { container: -1, id: 1 }, setPaletteColors, setBusy);
    expect(setPaletteColors).toHaveBeenCalled();
    setPaletteColors.mockRejectedValueOnce(new Error("no"));
    await savePaletteColors(["#000"], { container: -1, id: 1 }, setPaletteColors, setBusy);

    const downloaded: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pal");
    HTMLAnchorElement.prototype.click = function click() {
      downloaded.push(this.download);
    };
    await exportPalettePng("pal.nclr", ["#000"], null, async () => new Uint8Array([1]));
    await exportPalettePng("pal.nclr", null, null, async () => new Uint8Array([1]));
    expect(downloaded).toEqual(["pal.nclr.png"]);

    const setColors = vi.fn();
    const ref = { current: ["#111"] as string[] | null };
    cancelPaletteEdits(null, setColors, ref, vi.fn(), vi.fn(), vi.fn());
    cancelPaletteEdits(["#000"], setColors, ref, vi.fn(), vi.fn(), vi.fn());
    expect(setColors).toHaveBeenCalledWith(["#000"]);
  });
});
