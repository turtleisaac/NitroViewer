// Main-thread side of the realtime engine: loads the AudioWorklet module once per AudioContext,
// constructs a node seeded to a starting position, and exposes a small control surface (mute/solo
// mask, seek, position/ended callbacks) over the worklet's message port.
import type { SequenceEngineData } from "../../transport/types";
import { loadSequenceEngineData } from "./load";
import { WORKLET_NAME, type MainToWorklet, type WorkletInit, type WorkletToMain } from "./protocol";

const moduleLoaded = new WeakMap<AudioContext, Promise<void>>();

function workletUrl(): URL {
  // scripts/build-worklet.mjs pre-bundles sseq-worklet.ts into public/sseq-worklet.js — a real,
  // self-contained ES module (imports resolved, TS stripped) — because AudioWorkletProcessor is
  // loaded via addModule(url), not a static `import`, so nothing in the app's module graph ever
  // reaches it for Vite to bundle on its own; see that script for the full story. public/ files are
  // served at the site root the page itself was loaded from (apex domain, GitHub Pages project
  // subpath, or Electron's local server), so resolve against location.href — not import.meta.url,
  // which for this (bundled, chunked) module resolves to that chunk's own assets/ subdirectory, not
  // the site root the worklet actually lives at.
  return new URL("sseq-worklet.js", location.href);
}

function ensureModule(ctx: AudioContext): Promise<void> {
  let p = moduleLoaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl());
    moduleLoaded.set(ctx, p);
  }
  return p;
}

export interface EngineHandle {
  readonly node: AudioWorkletNode;
  setTrackMask(mask: number): void;
  seek(seconds: number): void;
  onPosition(cb: (seconds: number) => void): () => void;
  onEnded(cb: () => void): () => void;
}

/** Construct a worklet node already fast-forwarded to `seedSeconds` — resolves once it reports ready. */
export async function createEngine(
  ctx: AudioContext,
  engineData: SequenceEngineData,
  opts: { seedSeconds?: number; trackMask?: number } = {}
): Promise<EngineHandle> {
  // Kick off the module fetch/compile without blocking on it yet — loadSequenceEngineData is pure
  // CPU work (decoding potentially large base64 wave-archive PCM) that can run while that network
  // round-trip is in flight instead of strictly after it.
  const modulePromise = ensureModule(ctx);
  const seq = loadSequenceEngineData(engineData);
  await modulePromise;

  const init: WorkletInit = {
    seq,
    outRate: ctx.sampleRate,
    seedSeconds: opts.seedSeconds ?? 0,
    trackMask: opts.trackMask ?? 0xffff,
  };
  const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: init,
  });

  const positionListeners = new Set<(seconds: number) => void>();
  const endedListeners = new Set<() => void>();
  const ready = new Promise<void>((resolveReady) => {
    node.port.onmessage = (e: MessageEvent<WorkletToMain>) => {
      const msg = e.data;
      if (msg.type === "ready") resolveReady();
      else if (msg.type === "position") positionListeners.forEach((f) => f(msg.seconds));
      else if (msg.type === "ended") endedListeners.forEach((f) => f());
    };
  });
  await ready;

  const send = (m: MainToWorklet) => node.port.postMessage(m);
  return {
    node,
    setTrackMask: (mask) => send({ type: "setTrackMask", mask }),
    seek: (seconds) => send({ type: "seek", seconds }),
    onPosition: (cb) => {
      positionListeners.add(cb);
      return () => positionListeners.delete(cb);
    },
    onEnded: (cb) => {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
    },
  };
}
