import { sameHex, snapHex } from "../color";
import type { PaletteData, ResourceRef } from "../transport";
import { download } from "../util";

/** A copy of the color list so later edits do not change the stored one. */
export function cloneColors(colors: string[]): string[] {
  return colors.slice();
}

/** True when both lists are the same colors in the same order. */
export function colorsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameHex(a[i], b[i])) return false;
  return true;
}

/** True when the working colors differ from the last saved palette. */
export function paletteDirty(colors: string[] | null, baseline: string[] | null): boolean {
  return !!(colors && baseline && !colorsEqual(colors, baseline));
}

/** Records a committed edit, skipping the undo stack when nothing changed. */
export function pushCommitted(
  next: string[],
  committedRef: { current: string[] | null },
  setColors: (colors: string[]) => void,
  setUndoStack: (fn: (stack: string[][]) => string[][]) => void,
  setRedoStack: (stack: string[][]) => void
) {
  const prev = committedRef.current;
  if (!prev || colorsEqual(prev, next)) {
    setColors(next);
    committedRef.current = cloneColors(next);
    return;
  }
  setUndoStack((s) => [...s, cloneColors(prev)]);
  setRedoStack([]);
  committedRef.current = cloneColors(next);
  setColors(next);
}

/** Pops this stack and pushes the colors it replaced onto the other one. */
export function stepColorStack(
  stack: string[][],
  committedRef: { current: string[] | null },
  pushOther: (fn: (stack: string[][]) => string[][]) => void,
  setColors: (colors: string[]) => void
): string[][] {
  if (stack.length === 0 || !committedRef.current) return stack;
  const restored = stack[stack.length - 1];
  pushOther((other) => [...other, cloneColors(committedRef.current!)]);
  committedRef.current = cloneColors(restored);
  setColors(cloneColors(restored));
  return stack.slice(0, -1);
}

/** Applies one picker edit onto a copy of the current colors. */
export function paintColor(colors: string[] | null, index: number, hex: string): string[] | null {
  if (!colors) return colors;
  const next = colors.slice();
  next[index] = hex;
  return next;
}

/** Snaps a committed picker color onto a copy of the colors. */
export function commitColor(colors: string[], index: number, hex: string): string[] {
  const next = colors.slice();
  next[index] = snapHex(hex);
  return next;
}

/** Stores a freshly decoded palette and clears the edit stacks. */
export function applyDecodedPalette(
  palette: PaletteData,
  setPal: (palette: PaletteData) => void,
  setColors: (colors: string[]) => void,
  setBaseline: (colors: string[]) => void,
  committedRef: { current: string[] | null },
  setUndoStack: (stack: string[][]) => void,
  setRedoStack: (stack: string[][]) => void
) {
  setPal(palette);
  const colors = palette.colors.map(snapHex);
  setColors(colors);
  setBaseline(colors);
  committedRef.current = cloneColors(colors);
  setUndoStack([]);
  setRedoStack([]);
}

/** File name for an exported palette PNG. */
export function paletteFileBase(name: string): string {
  return (name.split(/[/:]/).pop() || "palette").replace(/[^\w.-]+/g, "_");
}

/** Downloads the palette PNG, preferring unsaved colors over the decoded ones. */
export async function exportPalettePng(
  name: string,
  colors: string[] | null,
  palette: PaletteData | null,
  toPng: (colors: string[]) => Promise<Uint8Array>
) {
  const src = colors ?? palette?.colors;
  if (!src) return;
  download(`${paletteFileBase(name)}.png`, await toPng(src), "image/png");
}

/** Imports a PNG unless the user keeps unsaved edits. */
export async function importPaletteFile(
  file: File,
  dirty: boolean,
  confirmReplace: () => boolean,
  ref: ResourceRef,
  importPalette: (ref: ResourceRef, bytes: Uint8Array) => Promise<{ unique: number; colors: number }>,
  setBusy: (busy: boolean) => void
) {
  if (dirty && !confirmReplace()) return;
  setBusy(true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await importPalette(ref, bytes);
    if (res.unique < res.colors)
      console.info(`Palette import: ${res.unique} unique colors → padded to ${res.colors}.`);
  } catch (e) {
    alert("Palette import failed: " + (e as Error).message);
  } finally {
    setBusy(false);
  }
}

/** Writes the working colors back to the ROM. */
export async function savePaletteColors(
  colors: string[] | null,
  ref: ResourceRef,
  setPaletteColors: (ref: ResourceRef, colors: string[]) => Promise<unknown>,
  setBusy: (busy: boolean) => void
) {
  if (!colors) return;
  setBusy(true);
  try {
    await setPaletteColors(ref, colors);
  } catch (e) {
    alert("Saving palette failed: " + (e as Error).message);
  } finally {
    setBusy(false);
  }
}

/** Drops unsaved edits and goes back to the decoded colors. */
export function cancelPaletteEdits(
  baseline: string[] | null,
  setColors: (colors: string[]) => void,
  committedRef: { current: string[] | null },
  setUndoStack: (stack: string[][]) => void,
  setRedoStack: (stack: string[][]) => void,
  setSelected: (index: number | null) => void
) {
  if (!baseline) return;
  setColors(cloneColors(baseline));
  committedRef.current = cloneColors(baseline);
  setUndoStack([]);
  setRedoStack([]);
  setSelected(null);
}
