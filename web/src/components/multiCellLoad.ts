import type { DecodedImage, ResourceRef } from "../transport";
import { base64ToBytes, download } from "../util";
import type { MultiCellPair } from "./multiCellPair";

type MetaClient = {
  decodeNmcrMeta: (rom: number, ref: ResourceRef) => Promise<{ multiCellCount: number }>;
  decodeNmarMeta: (rom: number, ref: ResourceRef) => Promise<{ animations: { name: string; frames: number }[] }>;
};

type DecodeClient = {
  decodeNmcr: (
    rom: number,
    ref: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    index: number,
    transparent: boolean
  ) => Promise<DecodedImage>;
  decodeNmar: (
    rom: number,
    ref: ResourceRef,
    nmcr: ResourceRef,
    ncer: ResourceRef,
    ncgr: ResourceRef,
    nclr: ResourceRef,
    animIndex: number,
    frameIndex: number,
    transparent: boolean
  ) => Promise<DecodedImage>;
};

/** Loads the multi-cell or animation counts for the open file. */
export function loadMultiMeta(
  fmt: string,
  romHandle: number,
  ref: ResourceRef,
  client: MetaClient,
  setMultiCellCount: (n: number) => void,
  setAnimFrames: (frames: { name: string; frames: number }[]) => void,
  setAnimIndex: (n: number) => void,
  setFrameIndex: (n: number) => void,
  setPlaying: (playing: boolean) => void
): () => void {
  let alive = true;
  if (fmt === "NMCR") {
    client
      .decodeNmcrMeta(romHandle, ref)
      .then((m) => alive && setMultiCellCount(m.multiCellCount))
      .catch(() => alive && setMultiCellCount(0));
  } else if (fmt === "NMAR") {
    client
      .decodeNmarMeta(romHandle, ref)
      .then((m) => applyNmarMeta(alive, m.animations, setAnimFrames, setAnimIndex, setFrameIndex, setPlaying))
      .catch(() => alive && setAnimFrames([]));
  }
  return () => {
    alive = false;
  };
}

/** Picks a looping animation when the file has one. */
function applyNmarMeta(
  alive: boolean,
  animations: { name: string; frames: number }[],
  setAnimFrames: (frames: { name: string; frames: number }[]) => void,
  setAnimIndex: (n: number) => void,
  setFrameIndex: (n: number) => void,
  setPlaying: (playing: boolean) => void
) {
  if (!alive) return;
  setAnimFrames(animations);
  const firstMulti = animations.findIndex((a) => a.frames > 1);
  if (firstMulti > 0) {
    setAnimIndex(firstMulti);
    setFrameIndex(0);
  }
  setPlaying(firstMulti >= 0);
}

/** Decodes the current multi-cell or animation frame. */
export function loadMultiImage(
  fmt: string,
  romHandle: number,
  ref: ResourceRef,
  pair: MultiCellPair,
  multiCellIndex: number,
  animIndex: number,
  frameIndex: number,
  transparent: boolean,
  client: DecodeClient,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  setImage: (image: DecodedImage | null) => void
): () => void {
  const alive = { current: true };
  void decodeMulti(alive, fmt, romHandle, ref, pair, multiCellIndex, animIndex, frameIndex, transparent, client, setBusy, setError, setImage);
  return () => {
    alive.current = false;
  };
}

async function decodeMulti(
  alive: { current: boolean },
  fmt: string,
  romHandle: number,
  ref: ResourceRef,
  pair: MultiCellPair,
  multiCellIndex: number,
  animIndex: number,
  frameIndex: number,
  transparent: boolean,
  client: DecodeClient,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  setImage: (image: DecodedImage | null) => void
) {
  setBusy(true);
  setError(null);
  try {
    const img = await decodedImage(fmt, romHandle, ref, pair, multiCellIndex, animIndex, frameIndex, transparent, client);
    if (alive.current) setImage(img);
  } catch (e) {
    if (alive.current) {
      setError((e as Error).message);
      setImage(null);
    }
  } finally {
    if (alive.current) setBusy(false);
  }
}

async function decodedImage(
  fmt: string,
  romHandle: number,
  ref: ResourceRef,
  pair: MultiCellPair,
  multiCellIndex: number,
  animIndex: number,
  frameIndex: number,
  transparent: boolean,
  client: DecodeClient
): Promise<DecodedImage> {
  if (fmt === "NMCR") return decodeNmcrImage(romHandle, ref, pair, multiCellIndex, transparent, client);
  if (fmt === "NMAR") return decodeNmarImage(romHandle, ref, pair, animIndex, frameIndex, transparent, client);
  throw new Error("Unsupported: " + fmt);
}

async function decodeNmcrImage(
  romHandle: number,
  ref: ResourceRef,
  pair: MultiCellPair,
  multiCellIndex: number,
  transparent: boolean,
  client: DecodeClient
): Promise<DecodedImage> {
  if (!pair.ncer || !pair.ncgr || !pair.nclr) throw new Error("A multi-cell needs NCER + NCGR + NCLR.");
  return client.decodeNmcr(romHandle, ref, pair.ncer, pair.ncgr, pair.nclr, multiCellIndex, transparent);
}

async function decodeNmarImage(
  romHandle: number,
  ref: ResourceRef,
  pair: MultiCellPair,
  animIndex: number,
  frameIndex: number,
  transparent: boolean,
  client: DecodeClient
): Promise<DecodedImage> {
  if (!pair.nmcr || !pair.ncer || !pair.ncgr || !pair.nclr)
    throw new Error("An NMAR animation needs NMCR + NCER + NCGR + NCLR.");
  return client.decodeNmar(romHandle, ref, pair.nmcr, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, transparent);
}

/** Downloads the decoded image. */
export function saveMultiPng(name: string, image: DecodedImage | null) {
  if (!image) return;
  const base = (name.split(/[/:]/).pop() || "image").replace(/[^\w.-]+/g, "_");
  download(`${base}.png`, base64ToBytes(image.png.split(",")[1]), "image/png");
}

/** Advances the frame while an animation with more than one frame is playing. */
export function startFrameLoop(frames: number, setFrameIndex: (fn: (f: number) => number) => void): (() => void) | void {
  if (frames <= 1) return;
  const id = setInterval(() => setFrameIndex((f) => (f + 1) % frames), 240);
  return () => clearInterval(id);
}
