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
