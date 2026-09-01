// Holds at most one "live" EngineHandle at a time and guarantees its onPosition subscription is
// torn down exactly when it stops being current — whether by attaching a replacement or by clearing
// the slot outright. AudioWorkletNode has no stop(): disconnecting it doesn't guarantee its
// postMessage traffic stops right away, so a forgotten unsubscribe means a detached engine's
// position updates can keep landing on a callback that's still wired to live UI state — clobbering
// whatever is now playing with a stale elapsed time from something else entirely. That exact bug
// (SoundViewer's note-roll playhead teleporting to an unrelated position after switching sequences)
// is why this exists as its own module: the "detach always unsubscribes first" invariant is
// unit-testable here without a real AudioContext/AudioWorkletNode or any React/DOM harness.
export interface PositionSource {
  onPosition(cb: (seconds: number) => void): () => void;
}

export class LiveEngineSlot<E extends PositionSource> {
  private current: E | null = null;
  private unsubscribe: () => void = () => {};

  get engine(): E | null {
    return this.current;
  }

  /** Attach a new engine, subscribing `onPosition` to `cb`. Any previous engine is fully detached first. */
  set(engine: E, onPosition: (seconds: number) => void): void {
    this.clear();
    this.current = engine;
    this.unsubscribe = engine.onPosition(onPosition);
  }

  /** Detach the current engine, if any, unsubscribing its position callback so it can never fire again. */
  clear(): void {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.current = null;
  }
}
