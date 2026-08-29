import type { ResourceRef } from "../transport";
import type { ResourceItem } from "./store";

/**
 * Choose which sibling resource (e.g. an NCLR palette) to auto-pair with the selected file.
 *
 * @param cands     candidate siblings of the wanted format in the same container
 * @param selfPeers all resources of the *selected* file's own format, in container order
 * @param selfId    the selected file's container index (ref.id)
 *
 * Heuristic: map the selection's ordinal position among its own kind proportionally onto the
 * candidate list. When the lists are the same length this is an exact 1:1 (`sprite[k] ↔ palette[k]`);
 * when there are fewer palettes than sprites it groups consecutive sprites onto a shared palette
 * (the common Gen IV layout); when there are more it spreads them. If the selection somehow isn't
 * among its peers, fall back to the candidate whose container index is nearest. Returns undefined
 * only when there are no candidates.
 */
export function pickSibling(
  cands: ResourceItem[],
  selfPeers: ResourceItem[],
  selfId: number
): ResourceRef | undefined {
  if (cands.length === 0) return undefined;
  const sorted = cands.slice().sort((a, b) => a.ref.id - b.ref.id);
  const ord = selfPeers.findIndex((i) => i.ref.id === selfId);
  if (ord >= 0 && selfPeers.length > 0) {
    const idx = Math.min(sorted.length - 1, Math.floor((ord * sorted.length) / selfPeers.length));
    return sorted[idx].ref;
  }
  return sorted.reduce((best, c) =>
    Math.abs(c.ref.id - selfId) < Math.abs(best.ref.id - selfId) ? c : best
  ).ref;
}

/**
 * Choose the animation/companion resource to auto-pair with a model. DS archives store a model's
 * animations right after it, so pick the first candidate at or after the model's index; if there is
 * none after it, fall back to the last one before it. Returns undefined when there are no candidates.
 */
export function pickNearestAfter(cands: ResourceItem[], selfId: number): ResourceRef | undefined {
  if (cands.length === 0) return undefined;
  const sorted = cands.slice().sort((a, b) => a.ref.id - b.ref.id);
  const after = sorted.find((c) => c.ref.id >= selfId);
  return (after ?? sorted[sorted.length - 1]).ref;
}

/** Normalise a DS asset name for comparison: lower-case, strip a leading game prefix (pl_/hg_/…),
 *  and drop a trailing "_<clip>" suffix so "manene_aruku" and "pl_manene" both reduce to "manene". */
export function baseName(name: string): string {
  let s = (name || "").toLowerCase().replace(/^(pl|dp|hg|ss|pt|d|p)_/, "");
  const us = s.indexOf("_");
  if (us > 0) s = s.slice(0, us);
  return s;
}

/**
 * True if an NSBCA (identified by its clip names) belongs to the model named `modelName` — i.e. any of
 * its clips shares the model's base name ("manene" ↔ "manene_aruku"). DS archives store a model's own
 * animations under names prefixed with the model name, so this scopes a model to its own animation sets
 * and rejects a neighbour's (e.g. "kami_pur") that the index heuristic would otherwise grab.
 */
export function namesMatchModel(clipNames: string[], modelName: string): boolean {
  const base = baseName(modelName);
  if (!base) return false;
  return clipNames.some((n) => baseName(n) === base);
}

/**
 * Pick the animation set for a model by NAME: the lowest-indexed candidate whose clips belong to the
 * model. Falls back to {@link pickNearestAfter} when name data is unavailable or nothing matches, so it
 * degrades to today's behaviour on games/archives we have no names for.
 */
export function pickAnimByName(
  cands: ResourceItem[],
  namesByKey: Record<string, string[]>,
  modelName: string,
  selfId: number
): ResourceRef | undefined {
  const matching = cands
    .filter((c) => {
      const names = namesByKey[`${c.ref.container}:${c.ref.id}`];
      return names && namesMatchModel(names, modelName);
    })
    .sort((a, b) => a.ref.id - b.ref.id);
  if (matching.length > 0) return matching[0].ref;
  return pickNearestAfter(cands, selfId);
}
