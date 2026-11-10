import type { ResourceItem } from "../state/store";
import { pickSibling } from "../state/pairing";
import { resolveRenderHints, resolveSpriteUnit, type RenderHints, type SpriteUnit } from "../state/grouping";
import { refKey, type DecodedImage, type ResourceRef } from "../transport";
import { formatsOf, resourcesInContainer, type NarcListing } from "./viewerShared";

export interface SpritePair {
  ncgr?: ResourceRef;
  nclr?: ResourceRef;
  ncer?: ResourceRef;
}

export type PendingKind = "ncgr" | "screen" | "cell" | "nanr";

export interface PendingImport {
  bytes: Uint8Array;
  unmatched: number;
  w: number;
  h: number;
  kind: PendingKind;
}

/** Saved pairing, then a manifest unit, then the nearest sibling. */
export function savedOrUnit(saved: ResourceRef | undefined, unitRef: ResourceRef | undefined, picked: ResourceRef | undefined): ResourceRef | undefined {
  return saved ?? unitRef ?? picked;
}

/** One slot of a resolved sprite unit. */
export function unitSlot(unit: SpriteUnit | null, key: "ncgr" | "nclr" | "ncer"): ResourceRef | undefined {
  if (!unit) return undefined;
  return unit[key];
}

/** Pairing chosen when the selection or its container changes. */
export function nextSpritePair(args: {
  items: ResourceItem[];
  saved: SpritePair;
  gameCode: string | undefined;
  narcPath: string | null;
  container: number;
  id: number;
  peers: ResourceItem[];
  ncgrs: ResourceItem[];
  nclrs: ResourceItem[];
  ncers: ResourceItem[];
}): SpritePair {
  const likes = args.items.map((item) => ({ index: item.ref.id, format: item.format }));
  const unit = resolveSpriteUnit(args.gameCode, args.narcPath, args.container, likes, args.id);
  return {
    ncgr: savedOrUnit(args.saved.ncgr, unitSlot(unit, "ncgr"), pickSibling(args.ncgrs, args.peers, args.id)),
    nclr: savedOrUnit(args.saved.nclr, unitSlot(unit, "nclr"), pickSibling(args.nclrs, args.peers, args.id)),
    ncer: savedOrUnit(args.saved.ncer, unitSlot(unit, "ncer"), pickSibling(args.ncers, args.peers, args.id)),
  };
}

/** Resources of one format, in container order. */
export function peersOf(items: ResourceItem[], fmt: string): ResourceItem[] {
  return formatsOf(items, fmt).slice().sort((a, b) => a.ref.id - b.ref.id);
}

/** Stable key for the container's resource list. */
export function itemsKeyOf(items: ResourceItem[]): string {
  return items.map((item) => `${item.ref.container}:${item.ref.id}:${item.format}`).join("|");
}

/** Files the viewer can pair against. */
export function spriteResources(container: number, narcs: Record<number, NarcListing | undefined>, romSiblings: ResourceItem[]): ResourceItem[] {
  return resourcesInContainer(container, narcs, romSiblings);
}

/** View controls seeded from render hints. */
export function hintedTileCount(hints: RenderHints | null): number {
  const width = hints?.tileWidth ?? 0;
  if (!width) return 0;
  return Math.max(1, Math.round(width / 8));
}

/** Front-to-back unless the manifest says the sheet is scanned backwards. */
export function scanFront(hints: RenderHints | null): boolean {
  return hints?.scanDirection !== "back-to-front";
}

/** Initial controls for a newly selected file. */
export function spriteViewSeed(gameCode: string | undefined, narcPath: string | null, id: number): {
  paletteIndex: number;
  tilesWidth: number;
  transparent: boolean;
  scanFrontToBack: boolean;
} {
  const hints = resolveRenderHints(gameCode, narcPath, id);
  return {
    paletteIndex: hints?.paletteIndex ?? 0,
    tilesWidth: hintedTileCount(hints),
    transparent: hints?.transparent ?? true,
    scanFrontToBack: scanFront(hints),
  };
}

/** Dependency string for the decode effect. */
export function spriteDepKey(parts: {
  selKey: string;
  fmt: string;
  pair: SpritePair;
  transparent: boolean;
  tilesWidth: number;
  scanFrontToBack: boolean;
  paletteIndex: number;
  cellIndex: number;
  animIndex: number;
  frameIndex: number;
  editVersion: number;
}): string {
  return JSON.stringify({
    selKey: parts.selKey,
    fmt: parts.fmt,
    ncgr: parts.pair.ncgr && refKey(parts.pair.ncgr),
    nclr: parts.pair.nclr && refKey(parts.pair.nclr),
    ncer: parts.pair.ncer && refKey(parts.pair.ncer),
    transparent: parts.transparent,
    tilesWidth: parts.tilesWidth,
    scanFrontToBack: parts.scanFrontToBack,
    paletteIndex: parts.paletteIndex,
    cellIndex: parts.cellIndex,
    animIndex: parts.animIndex,
    frameIndex: parts.frameIndex,
    editVersion: parts.editVersion,
  });
}

/** True while a multi-frame NANR animation should advance. */
export function nanrPlaying(fmt: string, playing: boolean, frames: number[], index: number): boolean {
  if (fmt !== "NANR" || !playing) return false;
  return (frames[index] ?? 0) > 1;
}

/** Last frame index, or -1 when the clip has no frames. */
export function maxFrameOf(frames: number[], index: number): number {
  if (frames[index] == null) return -1;
  return frames[index] - 1;
}

/** Pixel width shown in the tiles control. */
export function tilesPx(tilesWidth: number): number {
  if (!tilesWidth) return 0;
  return tilesWidth * 8;
}

/** Tile count from a pixel width. */
export function tilesFromPx(raw: string): number {
  return Math.max(0, Math.round((+raw | 0) / 8));
}

/** Role suffix on the game-db badge. */
export function roleSuffix(role: string | undefined): string {
  if (!role) return "";
  return ` · ${role.replace(/-/g, " ")}`;
}

/** Formats that can import a PNG. */
export function showImporter(fmt: string): boolean {
  return fmt === "NCGR" || fmt === "NSCR" || fmt === "NCER" || fmt === "NANR";
}

/** Both refs are present. */
export function bothRefs(a: ResourceRef | undefined, b: ResourceRef | undefined): boolean {
  return !!(a && b);
}

/** NCER, NCGR, and NCLR are all present. */
export function threeRefs(a: ResourceRef | undefined, b: ResourceRef | undefined, c: ResourceRef | undefined): boolean {
  return !!(a && b && c);
}

/** True when the import button has the files it needs. */
export function importReady(fmt: string, pair: SpritePair): boolean {
  if (fmt === "NCGR") return !!pair.nclr;
  if (fmt === "NANR") return threeRefs(pair.ncer, pair.ncgr, pair.nclr);
  return bothRefs(pair.ncgr, pair.nclr);
}

/** Import stays disabled while editing or while a previous import is running. */
export function importDisabled(fmt: string, editing: boolean, impBusy: boolean, pair: SpritePair): boolean {
  if (editing || impBusy) return true;
  return !importReady(fmt, pair);
}

/** Ready/need title shared by the importers. */
export function readyTitle(ready: boolean, yes: string, no: string): string {
  if (ready) return yes;
  return no;
}

/** Tooltip on Import PNG. */
export function importTitle(fmt: string, pair: SpritePair): string {
  if (fmt === "NCGR") return readyTitle(!!pair.nclr, "Replace this sprite's pixels from an image file", "Pick a palette first");
  if (fmt === "NSCR") return readyTitle(bothRefs(pair.ncgr, pair.nclr), "Import a background image into this tilemap (rebuilds the tileset)", "Pick a tileset + palette first");
  if (fmt === "NCER") return readyTitle(bothRefs(pair.ncgr, pair.nclr), "Replace this cell's pixels (writes back to the NCGR)", "Pick a tileset + palette first");
  return readyTitle(threeRefs(pair.ncer, pair.ncgr, pair.nclr), "Replace the current frame's cell artwork (writes back to the NCGR)", "Pick NCER + NCGR + NCLR first");
}

/** Show the built-in editor for an NCGR that has a palette. */
export function showSpriteEditor(fmt: string, editing: boolean, nclr: ResourceRef | undefined): boolean {
  return fmt === "NCGR" && !!editing && !!nclr;
}

/** Canvas is hidden while that editor is open. */
export function hideSpriteCanvas(fmt: string, editing: boolean): boolean {
  return fmt === "NCGR" && editing;
}

/** Message under a pending import. */
export function pendingText(pending: PendingImport): string {
  if (pending.kind === "ncgr") return ` of ${(pending.w * pending.h).toLocaleString()} pixels don't match the current palette.`;
  return " pixels don't match the current palette.";
}

/** Blocker text when an NCGR import has no palette. */
export function ncgrBlock(nclr: ResourceRef | undefined): string | null {
  if (nclr) return null;
  return "Pick a palette (NCLR) first — the import needs one to match colors against.";
}

/** Blocker text when a screen or cell import is missing a tileset or palette. */
export function pairBlock(ncgr: ResourceRef | undefined, nclr: ResourceRef | undefined, message: string): string | null {
  if (ncgr && nclr) return null;
  return message;
}

/** Blocker text when an animation import is missing a piece. */
export function nanrBlock(ncer: ResourceRef | undefined, ncgr: ResourceRef | undefined, nclr: ResourceRef | undefined): string | null {
  if (ncer && ncgr && nclr) return null;
  return "An animation import needs NCER + NCGR + NCLR — pick them first.";
}

interface DryLike {
  ok?: boolean;
  unmatched: number;
  width?: number;
  height?: number;
}

/** Run a dry import, then either apply it or ask the user to match or rebuild. */
export async function runSpriteImport(
  file: File,
  plan: {
    blocked: string | null;
    requiresOk: boolean;
    kind: PendingKind;
    failPrefix: string;
    dry: (bytes: Uint8Array) => Promise<DryLike>;
    apply: (bytes: Uint8Array) => Promise<unknown>;
  },
  setImpBusy: (busy: boolean) => void,
  setPending: (pending: PendingImport) => void,
): Promise<void> {
  if (plan.blocked) {
    alert(plan.blocked);
    return;
  }
  setImpBusy(true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dry = await plan.dry(bytes);
    if (plan.requiresOk && dry.ok === false) throw new Error("import failed");
    if (dry.unmatched === 0) await plan.apply(bytes);
    else setPending({ bytes, unmatched: dry.unmatched, w: dry.width ?? 0, h: dry.height ?? 0, kind: plan.kind });
  } catch (err) {
    alert(plan.failPrefix + (err as Error).message);
  } finally {
    setImpBusy(false);
  }
}

type PendingApply = {
  screen: () => Promise<unknown>;
  cell: () => Promise<unknown>;
  nanr: () => Promise<unknown>;
  ncgr: () => Promise<unknown>;
};

/** Run `write` when both refs are still selected. */
async function applyWhenPaired(left: ResourceRef | undefined, right: ResourceRef | undefined, write: () => Promise<unknown>): Promise<boolean> {
  if (!left || !right) return false;
  await write();
  return true;
}

/** Write an animation import when the full stack is still selected. */
async function applyNanrKind(pair: SpritePair, apply: PendingApply): Promise<boolean> {
  if (!pair.ncer || !pair.ncgr || !pair.nclr) return false;
  await apply.nanr();
  return true;
}

/** Write an NCGR import when a palette is still selected. */
async function applyNcgrKind(pair: SpritePair, apply: PendingApply): Promise<boolean> {
  if (!pair.nclr) return false;
  await apply.ncgr();
  return true;
}

/** Apply the user's match-or-rebuild choice. Returns false when the pairing disappeared. */
export async function applyPendingKind(pending: PendingImport, pair: SpritePair, apply: PendingApply): Promise<boolean> {
  if (pending.kind === "screen") return applyWhenPaired(pair.ncgr, pair.nclr, apply.screen);
  if (pending.kind === "cell") return applyWhenPaired(pair.ncgr, pair.nclr, apply.cell);
  if (pending.kind === "nanr") return applyNanrKind(pair, apply);
  return applyNcgrKind(pair, apply);
}

/** Apply a pending import and clear it when the write happened. */
export async function finishPending(
  pending: PendingImport | null,
  pair: SpritePair,
  apply: {
    screen: () => Promise<unknown>;
    cell: () => Promise<unknown>;
    nanr: () => Promise<unknown>;
    ncgr: () => Promise<unknown>;
  },
  setImpBusy: (busy: boolean) => void,
  setPending: (pending: PendingImport | null) => void,
): Promise<void> {
  if (!pending) return;
  setImpBusy(true);
  try {
    const wrote = await applyPendingKind(pending, pair, apply);
    if (wrote) setPending(null);
  } catch (err) {
    alert("Import failed: " + (err as Error).message);
  } finally {
    setImpBusy(false);
  }
}

/** Decode dispatch. Throws the same messages the viewer used to throw inline. */
export async function decodeSprite(fmt: string, run: {
  ncgr: () => Promise<DecodedImage>;
  nscr: () => Promise<DecodedImage>;
  ncer: () => Promise<DecodedImage>;
  nanr: () => Promise<DecodedImage>;
}): Promise<DecodedImage> {
  if (fmt === "NCGR") return run.ncgr();
  if (fmt === "NSCR") return run.nscr();
  if (fmt === "NCER") return run.ncer();
  if (fmt === "NANR") return run.nanr();
  throw new Error("Unsupported: " + fmt);
}

/** Require a palette before decoding an NCGR. */
export function requireNclr(nclr: ResourceRef | undefined): ResourceRef {
  if (!nclr) throw new Error("No palette (NCLR) in this container — pick one to color the tiles.");
  return nclr;
}

/** Require a tileset and palette. */
export function requireTiles(ncgr: ResourceRef | undefined, nclr: ResourceRef | undefined, message: string): { ncgr: ResourceRef; nclr: ResourceRef } {
  if (!ncgr || !nclr) throw new Error(message);
  return { ncgr, nclr };
}

/** Require a full animation stack. */
export function requireNanr(ncer: ResourceRef | undefined, ncgr: ResourceRef | undefined, nclr: ResourceRef | undefined): { ncer: ResourceRef; ncgr: ResourceRef; nclr: ResourceRef } {
  if (!ncer || !ncgr || !nclr) throw new Error("An animation needs NCER + NCGR + NCLR.");
  return { ncer, ncgr, nclr };
}
