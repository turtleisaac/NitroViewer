import type { ResourceRef } from "../transport";
import type { ResourceItem } from "./store";

/**
 * Choose which sibling resource (e.g. an NCLR palette) to auto-pair with the selected file.
 *
 * @param cands     candidate siblings of the wanted format in the same container
 * @param selfPeers all resources of the *selected* file's own format, in container order
 * @param selfId    the selected file's container index (ref.id)
 *
 * Heuristic: if the candidate list is parallel to the self list (same length — the Gen IV
 * `sprite[k] ↔ palette[k]` layout), pair by ordinal position. Otherwise pick the candidate whose
 * container index is nearest the selection. Returns undefined only when there are no candidates.
 */
export function pickSibling(
  cands: ResourceItem[],
  selfPeers: ResourceItem[],
  selfId: number
): ResourceRef | undefined {
  if (cands.length === 0) return undefined;
  const sorted = cands.slice().sort((a, b) => a.ref.id - b.ref.id);
  const ord = selfPeers.findIndex((i) => i.ref.id === selfId);
  if (sorted.length === selfPeers.length && ord >= 0) return sorted[ord].ref;
  return sorted.reduce((best, c) =>
    Math.abs(c.ref.id - selfId) < Math.abs(best.ref.id - selfId) ? c : best
  ).ref;
}
