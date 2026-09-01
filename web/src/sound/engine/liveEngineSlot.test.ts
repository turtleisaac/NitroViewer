import { describe, expect, it } from "vitest";
import { LiveEngineSlot, type PositionSource } from "./liveEngineSlot";

class FakeEngine implements PositionSource {
  private listeners = new Set<(seconds: number) => void>();

  onPosition(cb: (seconds: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Simulate a worklet 'position' postMessage arriving, whether or not this engine is still current. */
  emit(seconds: number): void {
    this.listeners.forEach((f) => f(seconds));
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe("LiveEngineSlot", () => {
  it("delivers position updates from the current engine", () => {
    const slot = new LiveEngineSlot<FakeEngine>();
    const engine = new FakeEngine();
    const seen: number[] = [];
    slot.set(engine, (s) => seen.push(s));

    engine.emit(1.5);
    engine.emit(2.5);

    expect(seen).toEqual([1.5, 2.5]);
    expect(slot.engine).toBe(engine);
  });

  it("clear() stops a detached engine's stale position updates from ever firing again", () => {
    // This is the exact bug: an AudioWorkletNode has no stop(), so disconnecting/discarding it
    // doesn't guarantee its 'position' postMessages stop arriving. Regression guard for the fix in
    // SoundViewer's stopLive(), which forgot to call the onPosition unsubscribe function.
    const slot = new LiveEngineSlot<FakeEngine>();
    const engine = new FakeEngine();
    const seen: number[] = [];
    slot.set(engine, (s) => seen.push(s));

    slot.clear();
    engine.emit(99); // a "zombie" position report arriving after the engine was stopped

    expect(seen).toEqual([]);
    expect(slot.engine).toBeNull();
    expect(engine.listenerCount).toBe(0);
  });

  it("set() with a new engine detaches the previous one first, so its stale updates can't leak into the new callback", () => {
    // Reproduces the reported symptom directly: switch from song A (still "live" and posting
    // updates) to song B — A's elapsed-time reports must never reach B's position callback and
    // clobber its playhead with a number that belongs to a completely different sequence.
    const slot = new LiveEngineSlot<FakeEngine>();
    const engineA = new FakeEngine();
    const engineB = new FakeEngine();
    const seenA: number[] = [];
    const seenB: number[] = [];

    slot.set(engineA, (s) => seenA.push(s));
    engineA.emit(10);
    slot.set(engineB, (s) => seenB.push(s));

    engineA.emit(999); // A is a zombie now — must not reach either callback
    engineB.emit(0.1);

    expect(seenA).toEqual([10]);
    expect(seenB).toEqual([0.1]);
    expect(engineA.listenerCount).toBe(0);
    expect(slot.engine).toBe(engineB);
  });

  it("clear() on an empty slot is a no-op", () => {
    const slot = new LiveEngineSlot<FakeEngine>();
    expect(() => slot.clear()).not.toThrow();
    expect(slot.engine).toBeNull();
  });

  it("switching through several engines in a row leaves no listeners subscribed on any earlier one", () => {
    // Mirrors the real-world repro: rapidly switching sequences several times in a row, which the
    // bug made progressively worse as more zombie engines accumulated.
    const slot = new LiveEngineSlot<FakeEngine>();
    const engines = [new FakeEngine(), new FakeEngine(), new FakeEngine(), new FakeEngine()];
    for (const e of engines) slot.set(e, () => {});
    for (const e of engines.slice(0, -1)) expect(e.listenerCount).toBe(0);
    expect(engines[engines.length - 1].listenerCount).toBe(1);
  });
});
