import type { OamBox } from "../transport";
import type { ResourceItem } from "./store";

/** Indexes chosen for the tileset, palette, and cell bank. */
export interface AutoPair {
  ncgr?: number;
  nclr?: number;
  ncer?: number;
}

/**
 * Pair a sprite file that has no game-database unit.
 * A column pattern that repeats at least twice wins. Otherwise the nearest compatible files.
 */
export function autoPair(items: ResourceItem[], format: string, id: number): AutoPair {
  // Repeated columns share one row. A single pass through the archive is not a pattern.
  const stride = detectStride(items);

  if (stride !== undefined) {
    return pairRow(items, format, id, stride);
  }

  return pairByFit(items, format, id);
}

/** Smallest stride from 2 to 8 whose columns each hold one format. */
function detectStride(items: ResourceItem[]): number | undefined {
  const formats = packedFormats(items);

  if (!formats) return undefined;

  const count = formats.length;

  for (let stride = 2; stride <= 8; stride++) {
    if (!repeats(count, stride)) continue;
    if (uniformColumns(formats, stride)) return stride;
  }

  return undefined;
}

/** True when `stride` tiles the list at least twice. */
function repeats(count: number, stride: number): boolean {
  if (count < stride * 2) return false;

  return count % stride === 0;
}

/** Every column is a single format, and at least two formats appear. */
function uniformColumns(formats: string[], stride: number): boolean {
  if (!eachColumn(formats, stride)) return false;

  return distinctColumns(formats, stride) >= 2;
}

/** True when no column mixes two formats. Empty slots are ignored. */
function eachColumn(formats: string[], stride: number): boolean {
  for (let column = 0; column < stride; column++) {
    if (!oneKind(formats, stride, column)) return false;
  }

  return true;
}

/** True when the non-empty files in one column share a format. */
function oneKind(formats: string[], stride: number, column: number): boolean {
  let kind = "";

  for (let at = column; at < formats.length; at += stride) {
    const format = formats[at];
    if (!format) continue;
    if (!kind) {
      kind = format;
      continue;
    }
    if (format !== kind) return false;
  }

  return true;
}

/** How many different formats the columns use. */
function distinctColumns(formats: string[], stride: number): number {
  const seen: Record<string, boolean> = {};
  let count = 0;

  for (let column = 0; column < stride; column++) {
    const kind = columnKind(formats, stride, column);
    if (!kind || seen[kind]) continue;
    seen[kind] = true;
    count += 1;
  }

  return count;
}

/** The format stored in a column, or empty when the column is blank. */
function columnKind(formats: string[], stride: number, column: number): string {
  for (let at = column; at < formats.length; at += stride) {
    if (formats[at]) return formats[at];
  }

  return "";
}

/** Formats for a packed 0..n archive, or undefined when an index is missing or repeated. */
function packedFormats(items: ResourceItem[]): string[] | undefined {
  const last = maxId(items);

  if (last < 0 || items.length !== last + 1) return undefined;

  const formats: string[] = [];
  const seen: boolean[] = [];

  for (let id = 0; id <= last; id++) {
    formats.push("");
    seen.push(false);
  }

  for (const item of items) {
    if (item.ref.id < 0 || seen[item.ref.id]) return undefined;
    seen[item.ref.id] = true;
    formats[item.ref.id] = item.format;
  }

  return formats;
}

/** Highest index in the list, or -1 when it is empty. */
function maxId(items: ResourceItem[]): number {
  let max = -1;

  for (const item of items) {
    if (item.ref.id > max) max = item.ref.id;
  }

  return max;
}

/** Companions from the same row of a repeating pattern. */
function pairRow(items: ResourceItem[], format: string, id: number, stride: number): AutoPair {
  const start = Math.floor(id / stride) * stride;
  const ncgr = rowNcgr(items, format, id, start, stride);
  const nclr = firstRole(items, start, stride, "NCLR");
  const ncer = firstRole(items, start, stride, "NCER");

  return { ncgr, nclr, ncer };
}

/** The selected tileset, or the first tileset in the row. */
function rowNcgr(items: ResourceItem[], format: string, id: number, start: number, stride: number): number | undefined {
  if (format === "NCGR") return id;

  return firstRole(items, start, stride, "NCGR");
}

/** First file of `format` in one row. */
function firstRole(items: ResourceItem[], start: number, stride: number, format: string): number | undefined {
  const end = start + stride;

  for (let id = start; id < end; id++) {
    const item = findItem(items, id);
    if (!item) continue;
    if (item.format === format) return id;
  }

  return undefined;
}

/** Nearest cell bank, then a tileset that can hold it, then a palette. */
function pairByFit(items: ResourceItem[], format: string, id: number): AutoPair {
  // Screens and cells start at the tileset. An animation starts at its cell bank.
  const ncer = chooseNcer(items, format, id);
  const ncgr = chooseNcgr(items, format, id, ncer);

  // The palette has to cover the tileset just chosen.
  const nclr = chooseNclr(items, ncgr);

  return { ncgr, nclr, ncer };
}

/** Nearest cell bank for an animation. Other formats keep their own cells. */
function chooseNcer(items: ResourceItem[], format: string, id: number): number | undefined {
  if (format !== "NANR") return undefined;

  return nearest(idsOf(items, "NCER"), id);
}

/** Selected tileset, or the nearest tileset that can hold the anchor. */
function chooseNcgr(items: ResourceItem[], format: string, id: number, ncer: number | undefined): number | undefined {
  if (format === "NCGR") return id;

  const anchor = tilesetAnchor(items, format, id, ncer);
  const candidates = idsOf(items, "NCGR");

  if (!anchor) return nearest(candidates, id);

  return nearestAllowed(candidates, items, anchor);
}

/** The file whose tiles the tileset has to cover. */
function tilesetAnchor(items: ResourceItem[], format: string, id: number, ncer: number | undefined): ResourceItem | undefined {
  if (format === "NSCR" || format === "NCER") return findItem(items, id);
  if (format !== "NANR") return undefined;

  return findItem(items, ncer);
}

/** Nearest palette that has enough colors for the tileset. */
function chooseNclr(items: ResourceItem[], ncgr: number | undefined): number | undefined {
  const tileset = findItem(items, ncgr);

  if (!tileset) return undefined;

  return nearestAllowed(idsOf(items, "NCLR"), items, tileset);
}

/** Candidates that are not ruled out, preferring a smaller index on a tie. */
function nearestAllowed(candidates: number[], items: ResourceItem[], anchor: ResourceItem): number | undefined {
  const kept: number[] = [];

  for (const cand of candidates) {
    if (keeps(anchor, findItem(items, cand))) kept.push(cand);
  }

  return nearest(kept, anchor.ref.id);
}

/** Keep a candidate when it fits, or when the check cannot be made. */
function keeps(anchor: ResourceItem, cand: ResourceItem | undefined): boolean {
  if (!cand) return false;

  const answer = fits(anchor, cand);

  if (answer === undefined) return true;

  return answer;
}

/** Fit of one candidate against the anchor, or undefined when a needed field is missing. */
function fits(anchor: ResourceItem, cand: ResourceItem): boolean | undefined {
  if (anchor.format === "NSCR" && cand.format === "NCGR") return screenFits(anchor, cand);
  if (anchor.format === "NCER" && cand.format === "NCGR") return bankFits(anchor, cand);
  if (anchor.format === "NCGR" && cand.format === "NCLR") return paletteFits(anchor, cand);

  return undefined;
}

/** Whether a screen's tile numbers fit in the tileset. @see https://problemkaputt.de/gbatek-lcd-vram-bg-screen-data-format-bg-map.htm */
function screenFits(screen: ResourceItem, tileset: ResourceItem): boolean | undefined {
  if (screen.maxTile === undefined) return undefined;

  const tiles = tileCount(tileset);

  if (tiles === undefined) return undefined;

  return screen.maxTile < tiles;
}

/** How many tiles the tileset holds. @see https://problemkaputt.de/gbatek-ds-files-2d-video.htm */
function tileCount(tileset: ResourceItem): number | undefined {
  // Tile byte size for the tileset's color depth.
  const bytes = depthBytes(tileset.depth);

  if (bytes === undefined || tileset.tileBytes === undefined) return undefined;

  return Math.floor(tileset.tileBytes / bytes);
}

/** Bytes per tile for a color depth. @see https://problemkaputt.de/gbatek-lcd-vram-character-data.htm */
function depthBytes(depth: number | undefined): number | undefined {
  if (depth === 3) return 32;
  if (depth === 4) return 64;

  return undefined;
}

/** Whether the palette has enough colors for the tileset. @see https://problemkaputt.de/gbatek-lcd-vram-character-data.htm */
function paletteFits(tileset: ResourceItem, palette: ResourceItem): boolean | undefined {
  if (tileset.depth === undefined || palette.colors === undefined) return undefined;
  if (tileset.depth === 3) return palette.colors >= 16;
  if (tileset.depth === 4) return palette.colors >= 256;

  return undefined;
}

/** Whether the cell's OBJs land inside the tileset. @see https://problemkaputt.de/gbatek-ds-video-objs.htm */
function bankFits(cell: ResourceItem, tileset: ResourceItem): boolean | undefined {
  const boundary = boundaryOf(cell);

  if (boundary === undefined || !cell.objects) return undefined;
  if (tileset.tileBytes === undefined) return undefined;

  for (const obj of cell.objects) {
    const answer = objectFits(obj, boundary, tileset);
    if (answer === undefined) return undefined;
    if (!answer) return false;
  }

  return true;
}

/** 1D boundary shift, when the NCER field is one of the four OBJ boundaries. */
function boundaryOf(cell: ResourceItem): number | undefined {
  if (cell.boundary === undefined) return undefined;
  if (cell.boundary < 0 || cell.boundary > 3) return undefined;

  return cell.boundary;
}

/** One OBJ's tile run against the tileset. @see https://problemkaputt.de/gbatek-ds-video-objs.htm */
function objectFits(obj: OamBox, boundary: number, tileset: ResourceItem): boolean | undefined {
  if (tileset.depth === undefined || tileset.tileBytes === undefined) return undefined;

  const mode = colorMode(obj, tileset.depth);
  const bytes = depthBytes(tileset.depth);

  if (mode === undefined || bytes === undefined) return undefined;
  if (!mode) return false;

  // 256-color names step by two.
  if (oddColorTile(obj, tileset.depth)) return false;

  return tileEnd(obj, boundary, bytes) <= tileset.tileBytes;
}

/** True when the OBJ color mode matches the tileset depth. @see https://problemkaputt.de/gbatek-lcd-obj-oam-attributes.htm */
function colorMode(obj: OamBox, depth: number): boolean | undefined {
  if (depth !== 3 && depth !== 4) return undefined;
  if (obj.colors !== 16 && obj.colors !== 256) return undefined;
  if (depth === 3) return obj.colors === 16;

  return obj.colors === 256;
}

/** Tile-number check for a 256-color OBJ. @see https://problemkaputt.de/gbatek-lcd-obj-oam-attributes.htm */
function oddColorTile(obj: OamBox, depth: number | undefined): boolean {
  if (depth !== 4) return false;

  return (obj.tile & 1) !== 0;
}

/** End of one OBJ in the tileset. @see https://problemkaputt.de/gbatek-ds-video-objs.htm */
function tileEnd(obj: OamBox, boundary: number, bytes: number): number {
  const start = (obj.tile << boundary) * 32;

  return start + obj.wide * obj.high * bytes;
}

/** Indexes of one format, in archive order. */
function idsOf(items: ResourceItem[], format: string): number[] {
  const ids: number[] = [];

  for (const item of items) {
    if (item.format !== format) continue;
    ids.push(item.ref.id);
  }

  ids.sort((left, right) => left - right);

  return ids;
}

/** The item with this index. */
function findItem(items: ResourceItem[], id: number | undefined): ResourceItem | undefined {
  if (id === undefined) return undefined;

  for (const item of items) {
    if (item.ref.id === id) return item;
  }

  return undefined;
}

/** Closest index, with the lower index winning a tie. */
function nearest(ids: number[], at: number): number | undefined {
  if (ids.length === 0) return undefined;

  let best = ids[0];

  for (const id of ids) {
    if (closer(id, best, at)) best = id;
  }

  return best;
}

/** True when `id` is a better choice than `best` for `at`. */
function closer(id: number, best: number, at: number): boolean {
  const gap = Math.abs(id - at);
  const bestGap = Math.abs(best - at);

  if (gap < bestGap) return true;
  if (gap > bestGap) return false;

  return id < best;
}
