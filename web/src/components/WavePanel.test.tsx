// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WaveInfo, WavePreview } from "../transport";
import { WavePanel } from "./SoundViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wave: WaveInfo = { index: 0, sampleRate: 8000, samples: 16, type: "pcm8", loops: true };
const quiet: WaveInfo = { index: 1, sampleRate: 0, samples: 0, type: "pcm8", loops: false };
const preview: WavePreview = {
  sampleRate: 8000,
  samples: 16,
  loops: true,
  type: "pcm8",
  png: "data:image/png,xx",
  wavBase64: "",
};

describe("WavePanel", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function mount(props: Parameters<typeof WavePanel>[0]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(WavePanel, props));
    });
  }

  it("lists waves and plays the selected preview", () => {
    const onPlay = vi.fn();
    const onExport = vi.fn();
    const onImport = vi.fn();
    const onSeek = vi.fn();
    const onSelect = vi.fn();
    mount({
      waves: [wave, quiet],
      selected: 0,
      preview,
      busy: false,
      currentTime: 0,
      onSelect,
      onPlay,
      onExport,
      onImport,
      onSeek,
    });
    const rows = host?.querySelectorAll(".sound-row");
    expect(rows?.length).toBe(2);
    act(() => {
      rows?.[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(1);
    act(() => {
      (host?.querySelector(".play-btn") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPlay).toHaveBeenCalled();
    act(() => {
      (host?.querySelectorAll(".btn")[0] as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExport).toHaveBeenCalled();
    const input = host?.querySelector("input") as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "a.wav");
    Object.defineProperty(input, "files", { value: [file] });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onImport).toHaveBeenCalled();
  });

  it("asks for a wave when nothing is selected", () => {
    mount({
      waves: [],
      selected: null,
      preview: null,
      busy: true,
      currentTime: 0,
      onSelect: () => undefined,
      onPlay: () => undefined,
      onExport: () => undefined,
      onImport: () => undefined,
      onSeek: () => undefined,
    });
    expect(host?.textContent).toContain("Loading");
    act(() => root?.unmount());
    mount({
      waves: [{ ...wave, loops: false }],
      selected: null,
      preview: { ...preview, loops: false, sampleRate: 0, samples: 0 },
      busy: true,
      currentTime: 1,
      onSelect: () => undefined,
      onPlay: () => undefined,
      onExport: () => undefined,
      onImport: () => undefined,
      onSeek: () => undefined,
    });
    expect(host?.textContent).not.toContain("loops");
    expect(host?.textContent).not.toContain("Select a wave.");
    const input = host?.querySelector("input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [] });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      (host?.querySelectorAll(".btn")[1] as HTMLButtonElement).click();
    });
    act(() => root?.unmount());
    mount({
      waves: [{ ...wave, loops: false }],
      selected: null,
      preview: null,
      busy: false,
      currentTime: 0,
      onSelect: () => undefined,
      onPlay: () => undefined,
      onExport: () => undefined,
      onImport: () => undefined,
      onSeek: () => undefined,
    });
    expect(host?.textContent).toContain("Select a wave.");
  });
});
