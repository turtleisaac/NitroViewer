// Message contract between the main-thread engine controller (Task 8) and sseq-worklet.ts. Kept in
// its own module so both sides import the same types instead of two hand-synced copies.
import type { LoadedSequence } from "./load";

export interface WorkletInit {
  // Already base64-decoded on the main thread: AudioWorkletGlobalScope doesn't implement
  // WindowOrWorkerGlobalScope, so atob() (used to decode the wire-format SequenceEngineData) isn't
  // available inside the worklet — decode before construction and structured-clone the typed
  // arrays in, not the raw base64 JSON.
  seq: LoadedSequence;
  outRate: number;
  seedSeconds: number;
  /** bit i set = SSEQ track i audible, matching Stepper.trackEnabled directly. */
  trackMask: number;
}

export type MainToWorklet =
  | { type: "setTrackMask"; mask: number }
  | { type: "seek"; seconds: number };

export type WorkletToMain =
  | { type: "ready" }
  | { type: "position"; seconds: number }
  | { type: "ended" };

export const WORKLET_NAME = "nds-sseq-engine";
