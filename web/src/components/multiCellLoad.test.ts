// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMultiImage, loadMultiMeta, saveMultiPng, startFrameLoop } from "./multiCellLoad";

describe("multi-cell loading", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads an NMCR count and an NMAR animation list", async () => {
    const setCount = vi.fn();
    const setFrames = vi.fn();
    const setAnim = vi.fn();
    const setFrame = vi.fn();
    const setPlaying = vi.fn();
    const client = {
      decodeNmcrMeta: vi.fn(async () => ({ multiCellCount: 4 })),
      decodeNmarMeta: vi.fn(async () => ({ animations: [{ name: "a", frames: 1 }, { name: "b", frames: 3 }] })),
    };
    loadMultiMeta("NMCR", 1, { container: -1, id: 0 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    await Promise.resolve();
    expect(setCount).toHaveBeenCalledWith(4);

    loadMultiMeta("NMAR", 1, { container: -1, id: 1 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    await Promise.resolve();
    await Promise.resolve();
    expect(setFrames).toHaveBeenCalled();
    expect(setPlaying).toHaveBeenCalledWith(true);
    expect(setAnim).toHaveBeenCalledWith(1);

    client.decodeNmcrMeta.mockRejectedValueOnce(new Error("no"));
    client.decodeNmarMeta.mockRejectedValueOnce(new Error("no"));
    loadMultiMeta("OTHER", 1, { container: -1, id: 2 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    loadMultiMeta("NMCR", 1, { container: -1, id: 2 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    loadMultiMeta("NMAR", 1, { container: -1, id: 3 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    await Promise.resolve();
    await Promise.resolve();
    expect(setCount).toHaveBeenCalledWith(0);
    expect(setFrames).toHaveBeenCalledWith([]);

    client.decodeNmarMeta.mockResolvedValueOnce({ animations: [{ name: "a", frames: 4 }] });
    loadMultiMeta("NMAR", 1, { container: -1, id: 4 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    await Promise.resolve();
    await Promise.resolve();
    expect(setPlaying).toHaveBeenCalledWith(true);

    client.decodeNmarMeta.mockResolvedValueOnce({ animations: [{ name: "a", frames: 1 }] });
    loadMultiMeta("NMAR", 1, { container: -1, id: 5 }, client, setCount, setFrames, setAnim, setFrame, setPlaying);
    await Promise.resolve();
    await Promise.resolve();
    expect(setPlaying).toHaveBeenCalledWith(false);
  });

  it("decodes an image and ignores a result after cleanup", async () => {
    const image = { png: "data:image/png,YQ==", width: 2, height: 2 };
    const pair = { ncer: { container: 1, id: 1 }, ncgr: { container: 1, id: 2 }, nclr: { container: 1, id: 3 } };
    const full = { nmcr: { container: 1, id: 0 }, ...pair };
    let resolveNmcr: (value: typeof image) => void = () => undefined;
    const pending = {
      decodeNmcr: () => new Promise<typeof image>((resolve) => {
        resolveNmcr = resolve;
      }),
      decodeNmar: async () => image,
    };
    const ignored = vi.fn();
    const stop = loadMultiImage(
      "NMCR", 1, { container: -1, id: 0 }, pair, 0, 0, 0, true, pending, vi.fn(), vi.fn(), ignored
    );
    stop();
    resolveNmcr(image);
    await Promise.resolve();
    await Promise.resolve();
    expect(ignored).not.toHaveBeenCalled();

    const client = {
      decodeNmcr: async () => image,
      decodeNmar: async () => image,
    };
    const setImage = vi.fn();
    const setError = vi.fn();
    loadMultiImage("NMCR", 1, { container: -1, id: 0 }, pair, 0, 0, 0, true, client, vi.fn(), setError, setImage);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(setImage).toHaveBeenCalledWith(image);
    loadMultiImage("NMAR", 1, { container: -1, id: 0 }, {}, 0, 0, 0, true, client, vi.fn(), setError, setImage);
    loadMultiImage("NSBMD", 1, { container: -1, id: 0 }, pair, 0, 0, 0, true, client, vi.fn(), setError, setImage);
    loadMultiImage("NMCR", 1, { container: -1, id: 0 }, {}, 0, 0, 0, true, client, vi.fn(), setError, setImage);
    await Promise.resolve();
    expect(setError).toHaveBeenCalled();
    loadMultiImage("NMAR", 1, { container: -1, id: 0 }, full, 0, 0, 0, true, client, vi.fn(), setError, setImage);
    await Promise.resolve();
    await Promise.resolve();

    saveMultiPng("field/cell.nmcr", image);
    saveMultiPng("/", null);
  });

  it("steps the frame until stopped", () => {
    vi.useFakeTimers();
    const setFrame = vi.fn();
    const stop = startFrameLoop(3, setFrame);
    vi.advanceTimersByTime(240);
    expect(setFrame).toHaveBeenCalled();
    stop?.();
    expect(startFrameLoop(1, setFrame)).toBeUndefined();
  });
});
