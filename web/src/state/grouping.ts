// Per-game asset manifest resolver ("game DB", HANDOFF §8). Turns the foldered game DB into
// concrete answers — render hints and sibling groupings — for a clicked resource. Resolution is
// MANIFEST-FIRST, HEURISTIC-FALLBACK: a known game/NARC returns exact answers; anything unlisted
// returns null so the caller drops back to the pairing.ts heuristics. Pure data + pure functions, so
// an HTTP backend could serve the same manifest unchanged.

import type { ResourceRef } from "../transport";
import { FORMAT_ROLES, type KnownFormat } from "../util";
import { loadGameDb, winningKey } from "../gamedb/load";

/** Per-unit / per-entry render facts that heuristics otherwise have to guess (tile width is the big one). */
export interface RenderHints {
  tileWidth?: number; // sprite width in PIXELS (kills the "linear strip" problem); multiples of 8
  bitDepth?: number; // 4 or 8; overrides the auto-detected NCGR bit depth (battle sprites are 8bpp)
  paletteIndex?: number; // default 4bpp sub-palette
  transparent?: boolean; // render index 0 as transparent
  scanned?: boolean; // NCGR is a bitmap (its pixels are the whole sprite), not tile-composed
  scanDirection?: "front-to-back" | "back-to-front"; // key in the first word, or the last
}

/** Which entries of a NARC are ciphered, and which way the key walks. */
interface CipherRule {
  scanDirection: "front-to-back" | "back-to-front";
  indexMod?: number; // only index % indexMod === indexRem. Omit to cipher every entry.
  indexRem?: number;
}

/** The sibling refs (all in the selection's container) that make up a 2D sprite unit. */
export interface SpriteUnit {
  ncgr?: ResourceRef;
  nclr?: ResourceRef;
  ncer?: ResourceRef;
  nanr?: ResourceRef;
}

/** Lower-case formatOf name used as an explicit-unit role. */
export type FormatRole = Lowercase<KnownFormat>;

/** One hand-specified unit. A role is one member index, or a list when several files share it. */
export type ExplicitMember = Partial<Record<FormatRole, number | number[]>> & {
  playbackRate?: number;
};

/** Every file an explicit unit names, with each role expanded to a list of refs. */
export type ExplicitUnit = Partial<Record<FormatRole, ResourceRef[]>>;

/** Grouping for one NARC. Indexes listed in `units` resolve before a stride. */
export interface GroupingSpec {
  strategy: "lockstep" | "interleaved" | "explicit";
  order?: string[];
  count?: number;
  units?: ExplicitMember[];
}

interface NarcEntryDef {
  role?: string;
  render?: RenderHints;
  cipher?: CipherRule;
  grouping?: GroupingSpec;
  entries?: Record<string, RenderHints & { role?: string }>;
  sets?: unknown[];
}
interface GameDef {
  title: string;
  narcs?: Record<string, NarcEntryDef>;
}
interface GameDb {
  version: number;
  games: Record<string, GameDef>;
}

const db = loadGameDb() as unknown as GameDb;

/** A minimal (format, index) pair — what the caller knows about the container's entries. */
export interface EntryLike {
  index: number;
  format: string;
}

/** Best game-code key in `games`. An exact key wins over a `PREFIX*` wildcard. Codes are matched in upper case. */
function gameKey(games: Record<string, GameDef>, gameCode: string | undefined): string | null {
  return winningKey(games, gameCode);
}

/** Best game entry for a 4-char code: an exact key wins over a `PREFIX*` wildcard. Returns its title too. */
export function resolveGame(gameCode: string | undefined): { key: string; title: string } | null {
  const key = gameKey(db.games, gameCode);
  if (!key) return null;
  return { key, title: db.games[key].title };
}

/** NARC entry from one document, or null when the game or path is absent. */
function narcDefIn(source: GameDb, gameCode: string | undefined, narcPath: string | null): NarcEntryDef | null {
  // Exact code, else the family wildcard.
  const key = gameKey(source.games, gameCode);

  if (!key) {
    return null;
  }

  if (!narcPath) {
    return null;
  }

  // A game with no narcs map has nothing to look up.
  const narcs = source.games[key].narcs;

  if (narcs === undefined) {
    return null;
  }

  const narc = narcs[narcPath];

  if (narc === undefined) {
    return null;
  }

  return narc;
}

/** NARC entry from the loaded game DB. */
function narcDef(gameCode: string | undefined, narcPath: string | null): NarcEntryDef | null {
  return narcDefIn(db, gameCode, narcPath);
}

/** Human label for the resolved game/NARC (for the "game DB" badge), or null when unlisted. */
export function resolveNarcInfo(
  gameCode: string | undefined,
  narcPath: string | null
): { title: string; role?: string } | null {
  const game = resolveGame(gameCode);
  const def = narcDef(gameCode, narcPath);
  if (!game || !def) return null;
  return { title: game.title, role: def.role };
}

/** True when this NARC entry is one of the ciphered scans. */
function cipherMatches(rule: CipherRule, id: number): boolean {
  if (id < 0) return false;
  if (rule.indexMod == null) return true;

  const mod = rule.indexMod;
  if (mod <= 0) return false;

  const rem = rule.indexRem ?? 0;
  return ((id % mod) + mod) % mod === rem;
}

/** Render hints for one entry of `source`. Same precedence as `resolveRenderHints`. */
export function resolveRenderHintsIn(
  source: GameDb,
  gameCode: string | undefined,
  narcPath: string | null,
  id: number
): RenderHints | null {
  const key = gameKey(source.games, gameCode);
  if (!key || !narcPath) return null;
  const def = source.games[key].narcs?.[narcPath];
  if (!def) return null;
  const perEntry = def.entries?.[String(id)];
  const merged: RenderHints = { ...(def.render ?? {}) };
  if (def.cipher && cipherMatches(def.cipher, id)) {
    merged.scanned = true;
    merged.scanDirection = def.cipher.scanDirection;
  }
  Object.assign(merged, perEntry ?? {});
  return Object.keys(merged).length ? merged : null;
}

/** Render hints for one entry. A matching cipher rule sets scanned and the scan direction. */
export function resolveRenderHints(
  gameCode: string | undefined,
  narcPath: string | null,
  id: number
): RenderHints | null {
  return resolveRenderHintsIn(db, gameCode, narcPath, id);
}

const SPRITE_ROLES = ["ncgr", "nclr", "ncer", "nanr"] as const;

/** Problems in an explicit unit list. Empty when that list is safe to use. */
export function explicitIssues(units: unknown, strategy?: string): string[] {
  // Missing list: only an explicit strategy is required to have one.
  if (units === undefined) {
    if (strategy === "explicit") {
      return ["explicit grouping needs units"];
    }

    return [];
  }

  // A unit list is an array. An object here would be merged by mistake.
  if (!Array.isArray(units)) {
    return ["explicit units are not a list"];
  }

  // One unit at a time, in declaration order.
  const issues: string[] = [];

  for (let index = 0; index < units.length; index++) {
    const problems = unitIssues(units[index], index);

    for (const problem of problems) {
      issues.push(problem);
    }
  }

  return issues;
}

/** Problems for one unit object. */
function unitIssues(unit: unknown, index: number): string[] {
  if (!isPlain(unit)) {
    return [`unit ${index} is not an object`];
  }

  // A unit with no roles groups nothing.
  const keys = Object.keys(unit);

  if (keys.length === 0) {
    return [`unit ${index} has no members`];
  }

  const issues: string[] = [];
  let roles = 0;

  for (const key of keys) {
    // playbackRate is ticks per second for a preview, not a file role.
    if (key === "playbackRate") {
      const issue = playbackRateIssue(unit[key], index);

      if (issue !== null) {
        issues.push(issue);
      }

      continue;
    }

    roles += 1;
    const issue = roleIssue(key, unit[key], index);

    if (issue !== null) {
      issues.push(issue);
    }
  }

  // A timing field alone does not group a file.
  if (roles === 0) {
    issues.push(`unit ${index} has no members`);
  }

  return issues;
}

/** A bad playback rate, or null when the value can be passed to the preview. */
function playbackRateIssue(value: unknown, index: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return `unit ${index} playbackRate is not a positive number`;
  }

  return null;
}

/**
 * Ticks per second recorded on the unit that lists `id`, or null when that unit has none.
 */
export function playbackRateFor(
  gameCode: string | undefined,
  narcPath: string | null,
  id: number,
): number | null {
  const units = explicitUnitsIn(db, gameCode, narcPath);

  if (units === null) {
    return null;
  }

  // The first unit that names the file owns its rate.
  const found = explicitUnitsContaining(units, id);

  if (found.length === 0) {
    return null;
  }

  const rate = found[0].playbackRate;

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  return rate;
}

/** One bad role or index, or null when the pair is usable. */
function roleIssue(key: string, value: unknown, index: number): string | null {
  if (!isFormatRole(key)) {
    return `unit ${index} has unknown role ${key}`;
  }

  return indexesIssue(value, index, key);
}

/** True when `key` is a lower-case formatOf name. */
function isFormatRole(key: string): key is FormatRole {
  return (FORMAT_ROLES as readonly string[]).includes(key);
}

/** A single index or a list of indexes, or the first problem in that value. */
function indexesIssue(value: unknown, index: number, key: string): string | null {
  // A bare number is the one-file form.
  if (!Array.isArray(value)) {
    return oneIndexIssue(value, index, key);
  }

  // An empty list names no file.
  if (value.length === 0) {
    return `unit ${index} ${key} is empty`;
  }

  for (const item of value) {
    const issue = oneIndexIssue(item, index, key);

    if (issue !== null) {
      return issue;
    }
  }

  return null;
}

/** One member index, or a message when it is not a whole number from 0 up. */
function oneIndexIssue(value: unknown, index: number, key: string): string | null {
  const parsed = wholeIndex(value);

  if (parsed === null) {
    return `unit ${index} ${key} is not a whole number`;
  }

  if (parsed < 0) {
    return `unit ${index} ${key} is negative`;
  }

  return null;
}

/** True for a JSON object, not an array or null. */
function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  return true;
}

/** The value when it is a whole number, otherwise null. */
function wholeIndex(value: unknown): number | null {
  if (!Number.isInteger(value)) {
    return null;
  }

  return value as number;
}

/** Units that list `id`, in declaration order. */
export function explicitUnitsContaining(units: readonly ExplicitMember[], id: number): ExplicitMember[] {
  const found: ExplicitMember[] = [];

  for (const unit of units) {
    if (listsIndex(unit, id)) {
      found.push(unit);
    }
  }

  return found;
}

/** True when any role in the unit names `id`. */
function listsIndex(unit: ExplicitMember, id: number): boolean {
  // A shared palette or animation can sit under any role, including inside a list.
  for (const role of FORMAT_ROLES) {
    const indexes = memberIndexes(unit[role as FormatRole]);

    if (indexes.includes(id)) {
      return true;
    }
  }

  return false;
}

/** Indexes stored under one role. A bare number is a one-element list. */
function memberIndexes(value: number | number[] | undefined): number[] {
  if (typeof value === "number") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

/** Validated explicit units on a NARC, or null when that NARC has no usable list. */
export function explicitUnitsIn(
  source: GameDb,
  gameCode: string | undefined,
  narcPath: string | null,
): ExplicitMember[] | null {
  const narc = narcDefIn(source, gameCode, narcPath);

  if (narc === null) {
    return null;
  }

  const grouping = narc.grouping;

  if (grouping === undefined) {
    return null;
  }

  if (grouping.units === undefined) {
    return null;
  }

  // A bad list rejects the NARC.
  const issues = explicitIssues(grouping.units, grouping.strategy);

  if (issues.length > 0) {
    return null;
  }

  return grouping.units;
}

/** Full explicit unit for `id`, or null when no valid unit lists it. */
export function resolveExplicitUnit(
  gameCode: string | undefined,
  narcPath: string | null,
  container: number,
  id: number,
): ExplicitUnit | null {
  return resolveExplicitUnitIn(db, gameCode, narcPath, container, id);
}

/** Full explicit unit from one document. Stride groupings are not expanded. */
export function resolveExplicitUnitIn(
  source: GameDb,
  gameCode: string | undefined,
  narcPath: string | null,
  container: number,
  id: number,
): ExplicitUnit | null {
  // No usable list means this click is not an explicit member.
  const units = explicitUnitsIn(source, gameCode, narcPath);

  if (units === null) {
    return null;
  }

  const found = explicitUnitsContaining(units, id);

  if (found.length === 0) {
    return null;
  }

  // The first unit in the file wins when a member is shared.
  const unit = found[0];

  return fileUnitFrom(unit, container);
}

/**
 * Sprite unit for `id` in one game-db document. An explicit list is checked first. A malformed list
 * rejects the whole grouping, so a stride is not used in its place.
 */
export function resolveSpriteUnitIn(
  source: GameDb,
  gameCode: string | undefined,
  narcPath: string | null,
  container: number,
  entries: EntryLike[],
  id: number,
): SpriteUnit | null {
  const narc = narcDefIn(source, gameCode, narcPath);

  if (narc === null) {
    return null;
  }

  const grouping = narc.grouping;

  if (grouping === undefined) {
    return null;
  }

  // A bad explicit list rejects the grouping.
  const issues = explicitIssues(grouping.units, grouping.strategy);

  if (issues.length > 0) {
    return null;
  }

  return groupUnit(grouping, entries, id, container);
}

/**
 * Resolve the sprite unit (NCGR/NCLR/NCER/NANR sibling refs) that the entry `id` belongs to, using the
 * NARC's declared `grouping`. Returns null when the game/NARC/grouping isn't declared, so the caller
 * falls back to pairing.ts. `container` is the selection's container (all members share it here).
 */
export function resolveSpriteUnit(
  gameCode: string | undefined,
  narcPath: string | null,
  container: number,
  entries: EntryLike[],
  id: number,
): SpriteUnit | null {
  return resolveSpriteUnitIn(db, gameCode, narcPath, container, entries, id);
}

/**
 * Sibling unit for entry `id`. An index listed in `units` uses the first such unit.
 * Other indexes use lockstep or interleaved when that is the strategy.
 * Other indexes use lockstep or interleaved when that is the strategy.
 */
export function groupUnit(g: GroupingSpec, entries: EntryLike[], id: number, container: number): SpriteUnit | null {
  // A named index uses that unit.
  const listed = unitFromExplicit(g.units, id, container);

  if (listed !== null) {
    return listed;
  }

  if (g.strategy === "interleaved") {
    if (g.order !== undefined) {
      return interleavedUnit(g.order, entries, id, container);
    }
  }

  if (g.strategy === "lockstep") {
    if (g.order !== undefined) {
      return lockstepUnit(g.order, g.count, entries, id, container);
    }
  }

  return null;
}

/** First explicit unit that lists `id`, or null when none do. */
function unitFromExplicit(units: ExplicitMember[] | undefined, id: number, container: number): SpriteUnit | null {
  if (units === undefined) {
    return null;
  }

  const found = explicitUnitsContaining(units, id);

  if (found.length === 0) {
    return null;
  }

  const unit = found[0];

  return spriteUnitFrom(unit, container);
}

/** Sprite refs for the roles an explicit unit names. A list uses its first index. */
function spriteUnitFrom(unit: ExplicitMember, container: number): SpriteUnit {
  const files = fileUnitFrom(unit, container);

  return firstSpriteRefs(files);
}

/** First ref of each sprite role. */
function firstSpriteRefs(files: ExplicitUnit): SpriteUnit {
  const out: SpriteUnit = {};

  for (const role of SPRITE_ROLES) {
    const refs = files[role];

    if (refs === undefined) {
      continue;
    }

    out[role] = refs[0];
  }

  return out;
}

/** Every role on an explicit unit, each expanded to refs in this container. */
function fileUnitFrom(unit: ExplicitMember, container: number): ExplicitUnit {
  const out: ExplicitUnit = {};

  for (const role of FORMAT_ROLES) {
    const indexes = memberIndexes(unit[role as FormatRole]);

    if (indexes.length === 0) {
      continue;
    }

    const refs: ResourceRef[] = [];

    for (const index of indexes) {
      refs.push(refAt(container, index));
    }

    out[role as FormatRole] = refs;
  }

  return out;
}

/** One interleaved stride. A repeated format keeps its first slot, then the clicked file. */
function interleavedUnit(order: string[], entries: EntryLike[], id: number, container: number): SpriteUnit | null {
  const pos = entryPos(entries, id);

  if (pos < 0) {
    return null;
  }

  // One unit is `stride` files in a row.
  const stride = order.length;
  const start = Math.floor(pos / stride) * stride;
  const out: SpriteUnit = {};

  for (let k = 0; k < stride; k++) {
    const at = start + k;

    if (at >= entries.length) {
      break;
    }

    // The first time a format appears is the companion. Later copies wait.
    const role = roleKey(order[k]);

    if (out[role] === undefined) {
      const entry = entries[at];
      out[role] = refAt(container, entry.index);
    }
  }

  // The clicked file replaces the companion for its own role.
  const clicked = entries[pos];
  out[roleKey(clicked.format)] = refAt(container, clicked.index);

  return out;
}

/** One lockstep slot: the same offset into each format run. */
function lockstepUnit(
  order: string[],
  count: number | undefined,
  entries: EntryLike[],
  id: number,
  container: number,
): SpriteUnit | null {
  const pos = entryPos(entries, id);

  if (pos < 0) {
    return null;
  }

  // A declared count wins. Otherwise the archive is split evenly across the order.
  let runLen = count;

  if (runLen === undefined) {
    runLen = Math.floor(entries.length / order.length);
  }

  if (runLen <= 0) {
    return null;
  }

  const slot = pos % runLen;
  const out: SpriteUnit = {};

  for (let run = 0; run < order.length; run++) {
    const at = run * runLen + slot;

    if (at >= entries.length) {
      continue;
    }

    const entry = entries[at];
    out[roleKey(order[run])] = refAt(container, entry.index);
  }

  return out;
}

/** Position of `id` in `entries`, or -1. */
function entryPos(entries: EntryLike[], id: number): number {
  // Where this file sits in the listing.
  return entries.findIndex((entry) => entry.index === id);
}

/** Lower-case sprite role for a format name from `order`. */
function roleKey(fmt: string): keyof SpriteUnit {
  // Order names are upper case. Sprite slots are lower case.
  return fmt.toLowerCase() as keyof SpriteUnit;
}

/** A ref in the open container. */
function refAt(container: number, index: number): ResourceRef {
  return { container, id: index };
}
