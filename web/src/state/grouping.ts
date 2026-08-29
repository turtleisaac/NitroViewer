// Per-game asset manifest resolver ("game DB", HANDOFF §8). Turns the declarative gamedb.json into
// concrete answers — render hints and sibling groupings — for a clicked resource. Resolution is
// MANIFEST-FIRST, HEURISTIC-FALLBACK: a known game/NARC returns exact answers; anything unlisted
// returns null so the caller drops back to the pairing.ts heuristics. Pure data + pure functions, so
// an HTTP backend could serve the same manifest unchanged.

import type { ResourceRef } from "../transport";
import gamedb from "../gamedb/gamedb.json";

/** Per-unit / per-entry render facts that heuristics otherwise have to guess (tile width is the big one). */
export interface RenderHints {
  tileWidth?: number; // sprite width in PIXELS (kills the "linear strip" problem); multiples of 8
  bitDepth?: number; // 4 or 8; overrides the auto-detected NCGR bit depth (battle sprites are 8bpp)
  paletteIndex?: number; // default 4bpp sub-palette
  transparent?: boolean; // render index 0 as transparent
  scanned?: boolean; // NCGR is a bitmap (its pixels are the whole sprite), not tile-composed
  scanDirection?: "front-to-back" | "back-to-front"; // scan seed direction (Pt/HG/SS vs D/P)
}

/** The sibling refs (all in the selection's container) that make up a 2D sprite unit. */
export interface SpriteUnit {
  ncgr?: ResourceRef;
  nclr?: ResourceRef;
  ncer?: ResourceRef;
  nanr?: ResourceRef;
}

interface NarcEntryDef {
  role?: string;
  render?: RenderHints;
  grouping?: { strategy: "lockstep" | "interleaved"; order: string[]; count?: number };
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

const db = gamedb as unknown as GameDb;

/** A minimal (format, index) pair — what the caller knows about the container's entries. */
export interface EntryLike {
  index: number;
  format: string;
}

/** Best game entry for a 4-char code: an exact key wins over a `PREFIX*` wildcard. Returns its title too. */
export function resolveGame(gameCode: string | undefined): { key: string; title: string } | null {
  if (!gameCode) return null;
  if (db.games[gameCode]) return { key: gameCode, title: db.games[gameCode].title };
  for (const [key, def] of Object.entries(db.games)) {
    if (key.endsWith("*") && gameCode.startsWith(key.slice(0, -1))) return { key, title: def.title };
  }
  return null;
}

function narcDef(gameCode: string | undefined, narcPath: string | null): NarcEntryDef | null {
  const game = resolveGame(gameCode);
  if (!game || !narcPath) return null;
  return db.games[game.key].narcs?.[narcPath] ?? null;
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

/** Render hints for a specific entry: the NARC's per-unit `render` merged with any per-entry override. */
export function resolveRenderHints(
  gameCode: string | undefined,
  narcPath: string | null,
  id: number
): RenderHints | null {
  const def = narcDef(gameCode, narcPath);
  if (!def) return null;
  const perEntry = def.entries?.[String(id)];
  const merged: RenderHints = { ...(def.render ?? {}), ...(perEntry ?? {}) };
  return Object.keys(merged).length ? merged : null;
}

/**
 * Resolve the sprite unit (NCGR/NCLR/NCER/NANR sibling refs) that the entry `id` belongs to, using the
 * NARC's declared `grouping`. Returns null when the game/NARC/grouping isn't declared, so the caller
 * falls back to pairing.ts. `container` is the selection's container (all members share it here).
 *
 * - `interleaved` — entries repeat the `order` pattern per unit (e.g. [NCGR,NCLR,NCER,NANR] × N). The
 *   unit index is `floor(position / order.length)`; each role's ref is that unit's slot for the role.
 * - `lockstep` — equal-length runs of each format in `order` (a block of NCGR, then NCLR, …); unit i is
 *   the i-th entry of each run.
 */
export function resolveSpriteUnit(
  gameCode: string | undefined,
  narcPath: string | null,
  container: number,
  entries: EntryLike[],
  id: number
): SpriteUnit | null {
  const g = narcDef(gameCode, narcPath)?.grouping;
  if (!g) return null;
  return groupUnit(g, entries, id, container);
}

/**
 * Pure grouping math (exported for testing): given a grouping spec and the container's entries, return
 * the sibling unit that entry `id` belongs to. See {@link resolveSpriteUnit} for the strategy semantics.
 */
export function groupUnit(
  g: { strategy: "lockstep" | "interleaved"; order: string[]; count?: number },
  entries: EntryLike[],
  id: number,
  container: number
): SpriteUnit | null {
  const order = g.order;
  const ref = (index: number): ResourceRef => ({ container, id: index });
  const roleKey = (fmt: string) => fmt.toLowerCase() as keyof SpriteUnit;
  const pos = entries.findIndex((e) => e.index === id);
  if (pos < 0) return null;

  if (g.strategy === "interleaved") {
    // A unit is `stride` consecutive files repeating the `order` pattern (PokEditor-Core's
    // PokemonSpriteParser layout: battle sprites are [NCGR,NCGR,NCGR,NCGR,NCLR,NCLR] × species). When a
    // format repeats within the unit, the FIRST slot is the canonical companion (e.g. the non-shiny
    // PALETTE at index 4, not SHINY_PALETTE at 5) — but the clicked file itself wins for its own role, so
    // clicking any of the four sprites pairs it with that species' palette.
    const stride = order.length;
    const start = Math.floor(pos / stride) * stride;
    const out: SpriteUnit = {};
    for (let k = 0; k < stride && start + k < entries.length; k++) {
      const role = roleKey(order[k]);
      if (out[role] === undefined) out[role] = ref(entries[start + k].index);
    }
    out[roleKey(entries[pos].format)] = ref(entries[pos].index); // clicked file is authoritative for its role
    return out;
  }

  if (g.strategy === "lockstep") {
    // Equal-length runs of each format in `order` (a block of NCGR, then NCLR, …); unit = index in run.
    const runLen = g.count ?? Math.floor(entries.length / order.length);
    if (runLen <= 0) return null;
    const unit = pos % runLen;
    const out: SpriteUnit = {};
    order.forEach((fmt, run) => {
      const at = run * runLen + unit;
      if (at < entries.length) out[roleKey(fmt)] = ref(entries[at].index);
    });
    return out;
  }

  return null;
}
