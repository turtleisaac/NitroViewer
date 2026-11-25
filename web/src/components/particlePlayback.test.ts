// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../state/store";
import {
  holdParticleClock,
  listedDelays,
  loadParticles,
  requestParticleFrames,
  startParticleClock,
  type ParticleFrames,
} from "./particlePlayback";

const rendered: ParticleFrames = { emitterCount: 1, frames: ["data:image/png,a"] };

function client() {
  return {
    renderParticles: vi.fn(() => Promise.resolve(rendered)),
    renderRatedParticles: vi.fn(() => Promise.resolve({ ...rendered, delaysCs: [3, 3, 4] })),
  };
}

describe("particle playback", () => {
  afterEach(() => {
    vi.useRealTimers();
    useStore.setState({ romInfo: null, narcs: {}, idToPath: {} });
  });

  it("omits the rate when the unit has none", async () => {
    const transport = client();
    const frames = await requestParticleFrames(transport, 1, -1, 4, null);
    expect(frames).toEqual(rendered);
    expect(transport.renderParticles).toHaveBeenCalledWith(1, { container: -1, id: 4 }, 256, 256, 48);
    expect(transport.renderRatedParticles).not.toHaveBeenCalled();
  });

  it("forwards a unit rate", async () => {
    const transport = client();
    const frames = await requestParticleFrames(transport, 2, 9, 151, 30);
    expect(frames.delaysCs).toEqual([3, 3, 4]);
    expect(transport.renderRatedParticles).toHaveBeenCalledWith(2, { container: 9, id: 151 }, 256, 256, 48, 30);
  });

  it("stores frames and ignores a result after cancel", async () => {
    let resolveFrames: (frames: ParticleFrames) => void = () => undefined;
    const transport = client();
    transport.renderParticles.mockReturnValue(new Promise((resolve) => {
      resolveFrames = resolve;
    }));
    const seen: ParticleFrames[] = [];
    const stop = loadParticles(transport, 1, -1, 3, (frames) => seen.push(frames), () => undefined);
    stop();
    resolveFrames(rendered);
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("stores a successful render", async () => {
    const transport = client();
    const seen: ParticleFrames[] = [];
    loadParticles(transport, 1, -1, 3, (frames) => seen.push(frames), () => undefined);
    await Promise.resolve();
    expect(seen).toEqual([rendered]);
  });

  it("reports a thrown error", async () => {
    const transport = client();
    transport.renderParticles.mockRejectedValue(new Error("nope"));
    const messages: string[] = [];
    loadParticles(transport, 1, -1, 3, () => undefined, (message) => messages.push(message));
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual(["nope"]);
  });

  it("reports a non-error throw", async () => {
    const transport = client();
    transport.renderParticles.mockRejectedValue("bad");
    const messages: string[] = [];
    loadParticles(transport, 1, -1, 3, () => undefined, (message) => messages.push(message));
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual(["bad"]);
  });

  it("ignores an error after cancel", async () => {
    let rejectFrames: (reason: unknown) => void = () => undefined;
    const transport = client();
    transport.renderParticles.mockReturnValue(new Promise((_resolve, reject) => {
      rejectFrames = reject;
    }));
    const messages: string[] = [];
    const stop = loadParticles(transport, 1, -1, 3, () => undefined, (message) => messages.push(message));
    stop();
    rejectFrames(new Error("late"));
    await Promise.resolve();
    expect(messages).toEqual([]);
  });

  it("reads a unit rate from the open game", async () => {
    useStore.setState({
      romInfo: { title: "HEARTGOLD", gameCode: "IPKE", numFiles: 1 },
      narcs: { 4: { ref: { container: -1, id: 8 }, entries: [] } },
      idToPath: { 8: "/a/1/0/9" },
    });
    const transport = client();
    loadParticles(transport, 1, 4, 151, () => undefined, () => undefined);
    await Promise.resolve();
    expect(transport.renderRatedParticles).toHaveBeenCalledWith(1, { container: 4, id: 151 }, 256, 256, 48, 30);
  });

  it("accepts a delay list only when it matches the frames", () => {
    expect(listedDelays(3, undefined)).toBeNull();
    expect(listedDelays(3, [3, 3])).toBeNull();
    expect(listedDelays(3, [3, 3, 4])).toEqual([3, 3, 4]);
  });

  it("does not schedule a single frame or a paused effect", () => {
    vi.useFakeTimers();
    const setFrame = vi.fn();
    const single = startParticleClock(1, [3], setFrame, 0);
    single();
    const paused = holdParticleClock(
      { emitterCount: 1, frames: ["a", "b"], delaysCs: [3, 4] },
      false,
      { current: 0 },
      setFrame,
    );
    paused();
    const missing = holdParticleClock(null, true, { current: 0 }, setFrame);
    missing();
    vi.advanceTimersByTime(1000);
    expect(setFrame).not.toHaveBeenCalled();
  });

  it("steps a steady clock when delays are absent", () => {
    vi.useFakeTimers();
    let current = 0;
    const stop = startParticleClock(3, [3], (update) => {
      current = update(current);
    }, 0);
    vi.advanceTimersByTime(1000 / 30);
    expect(current).toBe(1);
    stop();
    vi.advanceTimersByTime(1000 / 30);
    expect(current).toBe(1);
  });

  it("waits each frame's own delay", () => {
    vi.useFakeTimers();
    let current = 0;
    const stop = holdParticleClock(
      { emitterCount: 1, frames: ["a", "b", "c"], delaysCs: [3, 3, 4] },
      true,
      { current: 0 },
      (update) => {
        current = update(current);
      },
    );
    vi.advanceTimersByTime(29);
    expect(current).toBe(0);
    vi.advanceTimersByTime(1);
    expect(current).toBe(1);
    vi.advanceTimersByTime(30);
    expect(current).toBe(2);
    vi.advanceTimersByTime(40);
    expect(current).toBe(0);
    stop();
    vi.advanceTimersByTime(100);
    expect(current).toBe(0);
  });
});
