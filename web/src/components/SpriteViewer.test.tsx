// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../state/store";
import { acceptSpriteFile, applyNanrMeta, decodeInto, loadSelectionImage, pendingBytes, saveSpritePng, SpriteViewer } from "./SpriteViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const image = { width: 8, height: 8, png: "data:image/png,xx", subPalettes: 2, scanned: true };

describe("SpriteViewer", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  it("decodes an NCGR and shows the scanned note for a cell", async () => {
    window.alert = vi.fn();
    useStore.setState({
      romHandle: 1,
      selection: { ref: { container: -1, id: 3 }, name: "hero.ncgr", format: "NCGR", compressed: false, size: 4 },
      romSiblings: [
        { ref: { container: -1, id: 3 }, label: "#3", format: "NCGR" },
        { ref: { container: -1, id: 4 }, label: "#4", format: "NCLR" },
      ],
      narcs: {},
      editVersion: 0,
      client: {
        ...useStore.getState().client,
        decodeNcgr: async () => image,
        decodeNcer: async () => image,
        decodeNscr: async () => { throw new Error("screen"); },
        decodeNanr: async () => image,
        decodeNcerMeta: async () => ({ cellCount: 2 }),
        decodeNanrMeta: async () => ({ animations: [{ frames: 1 }, { frames: 4 }] }),
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root?.render(createElement(SpriteViewer)); });
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Save PNG");
    const palette = [...host.querySelectorAll("label")].find((el) => el.textContent?.includes("Palette (NCLR)"));
    const select = palette?.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "-1:4";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector("img")).toBeTruthy();
  });

  it("covers decode and import helpers", async () => {
    const setImage = vi.fn();
    const setError = vi.fn();
    const setBusy = vi.fn();
    const setSub = vi.fn();
    await decodeInto(() => true, async () => image, setBusy, setError, setImage, setSub);
    await decodeInto(() => false, async () => { throw new Error("late"); }, setBusy, setError, setImage, setSub);
    await decodeInto(() => true, async () => { throw new Error("bad"); }, setBusy, setError, setImage, setSub);
    expect(setError).toHaveBeenCalledWith("bad");
    const client = {
      decodeNcgr: async () => image,
      decodeNscr: async () => image,
      decodeNcer: async () => image,
      decodeNanr: async () => image,
    };
    const base = { client, romHandle: 1, ref: { container: -1, id: 1 }, tilesWidth: 0, transparent: true, paletteIndex: 0, scanFrontToBack: true, cellIndex: 0, animIndex: 0, frameIndex: 0 };
    const nclr = { container: -1, id: 2 };
    const ncgr = { container: -1, id: 1 };
    const ncer = { container: -1, id: 3 };
    await loadSelectionImage({ ...base, fmt: "NCGR", pair: { nclr } });
    await loadSelectionImage({ ...base, fmt: "NSCR", pair: { ncgr, nclr } });
    await loadSelectionImage({ ...base, fmt: "NCER", pair: { ncgr, nclr } });
    await loadSelectionImage({ ...base, fmt: "NANR", pair: { ncer, ncgr, nclr } });
    expect(() => loadSelectionImage({ ...base, fmt: "NOPE", pair: {} })).toThrow(/Unsupported/);
    const frames: number[] = [];
    const setFrames = vi.fn();
    const setAnim = vi.fn();
    const setFrame = vi.fn();
    const setPlaying = vi.fn();
    applyNanrMeta(false, { animations: [] }, setFrames, setAnim, setFrame, setPlaying);
    applyNanrMeta(true, { animations: [{ frames: 1 }, { frames: 3 }] }, setFrames, setAnim, setFrame, setPlaying);
    expect(setPlaying).toHaveBeenCalledWith(true);
    expect(pendingBytes(null).length).toBe(0);
    expect(pendingBytes({ bytes: new Uint8Array([1]), unmatched: 0, w: 0, h: 0, kind: "ncgr" })[0]).toBe(1);
    saveSpritePng(null, "x");
    saveSpritePng({ ...image, png: "data:image/png,QQ==" }, "hero/sprite");
    const input = document.createElement("input");
    const handlers = { screen: vi.fn(), cell: vi.fn(), nanr: vi.fn(), ncgr: vi.fn() };
    acceptSpriteFile({ target: input } as unknown as Parameters<typeof acceptSpriteFile>[0], "NCGR", handlers);
    const file = new File([new Uint8Array([1])], "a.png");
    Object.defineProperty(input, "files", { value: [file] });
    acceptSpriteFile({ target: input } as unknown as Parameters<typeof acceptSpriteFile>[0], "NSCR", handlers);
    acceptSpriteFile({ target: input } as unknown as Parameters<typeof acceptSpriteFile>[0], "NCER", handlers);
    acceptSpriteFile({ target: input } as unknown as Parameters<typeof acceptSpriteFile>[0], "NANR", handlers);
    acceptSpriteFile({ target: input } as unknown as Parameters<typeof acceptSpriteFile>[0], "NCGR", handlers);
    expect(handlers.screen).toHaveBeenCalled();
    expect(handlers.ncgr).toHaveBeenCalled();
    void frames;
  });
});
