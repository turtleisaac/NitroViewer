// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../state/store";
import { NarcBrowser } from "./NarcBrowser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = { index: 0, size: 4, format: "NCGR" };
const raw = { index: 1, size: 2, format: "" };

describe("NarcBrowser", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function mount() {
    host = document.createElement("div");
    host.className = "inspector-body";
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(NarcBrowser));
    });
  }

  it("lists entries and imports or exports them", async () => {
    const select = vi.fn(async () => undefined);
    const exportFile = vi.fn(() => Promise.resolve({ size: 4, format: "NCGR", compressed: false, base64: "YQ==" }));
    const exportNarcZip = vi.fn(() => Promise.resolve({ ok: true, count: 1, base64: "YQ==" }));
    const importFile = vi.fn(async () => undefined);
    const importNarcZip = vi.fn(async () => ({ count: 2 }));
    const setNarcScroll = vi.fn();
    useStore.setState({
      selection: { ref: { container: -1, id: 2 }, name: "field/data.narc", format: "NARC", compressed: false, size: 8 },
      romHandle: 1,
      editVersion: 1,
      narcs: {},
      narcScroll: { 9: 12 },
      setNarcScroll,
      select,
      importFile,
      importNarcZip,
      ensureNarc: async () => ({ narcHandle: 9, entries: [entry, raw] }),
      client: {
        ...useStore.getState().client,
        exportFile,
        exportNarcZip,
      },
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host?.textContent).toContain("#0");
    expect(host?.textContent).toContain("raw");
    const open = host?.querySelector(".narc-open") as HTMLButtonElement;
    await act(async () => {
      open.click();
    });
    expect(select).toHaveBeenCalled();
    const extract = host?.querySelector(".icon-btn") as HTMLButtonElement;
    await act(async () => {
      extract.click();
    });
    expect(exportFile).toHaveBeenCalled();
    host?.dispatchEvent(new Event("scroll"));
    expect(setNarcScroll).toHaveBeenCalled();

    const buttons = [...(host?.querySelectorAll(".btn") ?? [])] as HTMLButtonElement[];
    await act(async () => {
      buttons[0].click();
    });
    expect(exportNarcZip).toHaveBeenCalled();

    const inputs = host?.querySelectorAll("input") as NodeListOf<HTMLInputElement>;
    const file = new File([new Uint8Array([1])], "a.bin");
    Object.defineProperty(inputs[0], "files", { configurable: true, value: [file] });
    const upload = host?.querySelectorAll(".icon-btn")[1] as HTMLButtonElement;
    const click = vi.spyOn(inputs[0], "click");
    act(() => upload.click());
    expect(click).toHaveBeenCalled();
    await act(async () => {
      inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(importFile).toHaveBeenCalled();

    Object.defineProperty(inputs[1], "files", { configurable: true, value: [file] });
    await act(async () => {
      inputs[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(importNarcZip).toHaveBeenCalled();

    Object.defineProperty(inputs[0], "files", { configurable: true, value: [] });
    await act(async () => {
      inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  it("shows an error when the archive will not open", async () => {
    useStore.setState({
      selection: { ref: { container: -1, id: 3 }, name: "bad.narc", format: "NARC", compressed: false, size: 8 },
      romHandle: 1,
      editVersion: 2,
      ensureNarc: async () => {
        throw new Error("bad");
      },
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host?.textContent).toContain("Could not open NARC");
  });
});
