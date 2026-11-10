import { pickSibling } from "../state/pairing";
import type { ResourceItem } from "../state/store";
import type { ResourceRef } from "../transport";

export interface MultiCellPair {
  nmcr?: ResourceRef;
  ncer?: ResourceRef;
  ncgr?: ResourceRef;
  nclr?: ResourceRef;
}

/** Peers of one format, in file order. */
function peersOf(items: ResourceItem[], format: string): ResourceItem[] {
  return items.filter((i) => i.format === format).slice().sort((a, b) => a.ref.id - b.ref.id);
}

/**
 * Cascading auto-pair: NMAR to NMCR to NCER to NCGR/NCLR.
 * A saved override wins over the sibling guess.
 */
export function pairMultiCell(
  fmt: string,
  selectionId: number,
  items: ResourceItem[],
  lists: { nmcrs: ResourceItem[]; ncers: ResourceItem[]; ncgrs: ResourceItem[]; nclrs: ResourceItem[] },
  selfPeers: ResourceItem[],
  saved: MultiCellPair
): MultiCellPair {
  let nmcr: ResourceRef | undefined;
  let ncerPeerId = selectionId;
  let ncerPeerList = selfPeers;
  if (fmt === "NMAR") {
    nmcr = saved.nmcr ?? pickSibling(lists.nmcrs, selfPeers, selectionId);
    const nmcrPeers = peersOf(items, "NMCR");
    ncerPeerId = nmcr ? nmcr.id : selectionId;
    ncerPeerList = nmcrPeers;
  }
  const ncer = saved.ncer ?? pickSibling(lists.ncers, ncerPeerList, ncerPeerId);
  const ncerPeers = peersOf(items, "NCER");
  const ncgrPeerId = ncer ? ncer.id : ncerPeerId;
  const ncgr = saved.ncgr ?? pickSibling(lists.ncgrs, ncerPeers, ncgrPeerId);
  const nclr = saved.nclr ?? pickSibling(lists.nclrs, ncerPeers, ncgrPeerId);
  return { nmcr, ncer, ncgr, nclr };
}

/** The frame stepper's max, or -1 when the animation has no frames. */
export function maxFrameOf(frames: { frames: number }[] | undefined, animIndex: number): number {
  const anim = frames?.[animIndex];
  return anim ? anim.frames - 1 : -1;
}

/** Playback needs more than one frame. */
export function canPlayFrames(frames: number | undefined): boolean {
  return (frames ?? 0) > 1;
}
