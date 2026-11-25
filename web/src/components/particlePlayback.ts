import { playbackRateFor } from "../state/grouping";
import { useStore } from "../state/store";
import type { NitroViewerClient } from "../transport";

/** One rendered SPA effect. */
export interface ParticleFrames {
  emitterCount: number;
  frames: string[];
  delaysCs?: number[];
}

/** The subset of the client the preview calls. */
type ParticleClient = Pick<NitroViewerClient, "renderParticles" | "renderRatedParticles">;

/** A React state setter that receives the previous value. */
type FrameUpdate = (update: (current: number) => number) => void;

/** Steady step used when a file has no per-frame delays, in milliseconds. */
const STEADY_FRAME_MS = 1000 / 30;

/**
 * Loads one effect and returns the cancel function.
 * A unit rate is forwarded. Without one, the preview keeps its own delays.
 */
export function loadParticles(
  client: ParticleClient,
  romHandle: number,
  container: number,
  id: number,
  setData: (frames: ParticleFrames) => void,
  setErr: (message: string) => void,
): () => void {
  const state = useStore.getState();
  const info = state.romInfo;
  let gameCode: string | undefined;

  // A missing banner has no game code, so no unit rate applies.
  if (info == null) {
    gameCode = undefined;
  } else {
    gameCode = info.gameCode;
  }

  const rate = playbackRateFor(gameCode, state.narcPathOf(container), id);
  let alive = true;
  const request = requestParticleFrames(client, romHandle, container, id, rate);

  request
    .then((frames) => {
      if (alive) {
        setData(frames);
      }
    })
    .catch((error: unknown) => {
      if (alive) {
        setErr(messageOf(error));
      }
    });

  return () => {
    alive = false;
  };
}

/** The preview call, with a rate only when the unit records one. */
export function requestParticleFrames(
  client: ParticleClient,
  romHandle: number,
  container: number,
  id: number,
  rate: number | null,
): Promise<ParticleFrames> {
  const ref = { container, id };

  if (rate == null) {
    return client.renderParticles(romHandle, ref, 256, 256, 48);
  }

  return client.renderRatedParticles(romHandle, ref, 256, 256, 48, rate);
}

/** Text of a thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Starts playback for the current effect and returns the stop function.
 * A stopped or missing effect does not schedule a timer.
 */
export function holdParticleClock(
  data: ParticleFrames | null,
  playing: boolean,
  frameRef: { current: number },
  setFrame: FrameUpdate,
): () => void {
  if (data == null) {
    return () => undefined;
  }

  if (!playing) {
    return () => undefined;
  }

  return startParticleClock(data.frames.length, data.delaysCs, setFrame, frameRef.current);
}

/** Arms a clock for {@code frameCount} frames and returns the stop function. */
export function startParticleClock(
  frameCount: number,
  delaysCs: number[] | undefined,
  setFrame: FrameUpdate,
  startIndex: number,
): () => void {
  if (frameCount <= 1) {
    return () => undefined;
  }

  const delays = listedDelays(frameCount, delaysCs);

  if (delays == null) {
    return steadyClock(frameCount, setFrame);
  }

  return delayedClock(frameCount, delays, setFrame, startIndex);
}

/** The delay list when it has one entry per frame, otherwise null. */
export function listedDelays(frameCount: number, delaysCs: number[] | undefined): number[] | null {
  if (delaysCs == null) {
    return null;
  }

  if (delaysCs.length !== frameCount) {
    return null;
  }

  return delaysCs;
}

/** Advances one frame on the steady step. */
function steadyClock(frameCount: number, setFrame: FrameUpdate): () => void {
  const timer = setInterval(() => {
    setFrame((current) => (current + 1) % frameCount);
  }, STEADY_FRAME_MS);

  return () => {
    clearInterval(timer);
  };
}

/** Advances one frame after that frame's own delay. */
function delayedClock(
  frameCount: number,
  delays: number[],
  setFrame: FrameUpdate,
  startIndex: number,
): () => void {
  let timer = 0;
  let alive = true;

  const arm = (index: number) => {
    const wait = delays[index] * 10;
    timer = window.setTimeout(() => {
      if (!alive) {
        return;
      }

      setFrame((current) => {
        const next = (current + 1) % frameCount;
        arm(next);
        return next;
      });
    }, wait);
  };

  arm(startIndex);

  return () => {
    alive = false;
    window.clearTimeout(timer);
  };
}
