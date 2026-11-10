// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../state/store";
import { PaletteViewer } from "./PaletteViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PaletteViewer", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  it("edits a swatch and saves or cancels", async () => {
    const setPaletteColors = vi.fn(() => Promise.resolve({ colors: 2, changed: 1 }));
    const importPalette = vi.fn(async () => ({ unique: 2, colors: 2 }));
    useStore.setState({
      romHandle: 1,
      editVersion: 1,
      selection: { ref: { container: -1, id: 5 }, name: "pal.nclr", format: "NCLR", compressed: false, size: 8 },
      setPaletteColors,
      importPalette,
      client: {
        ...useStore.getState().client,
        decodePalette: async () => ({ count: 2, colors: ["#112233", "#445566"] }),
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(PaletteViewer));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("2 colors");
    const swatch = host.querySelector(".swatch") as HTMLButtonElement;
    act(() => swatch.click());
    expect(host.textContent).toContain("#0");
    const hex = host.querySelector(".color-field input") as HTMLInputElement;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- React reads the prototype setter
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(hex, "ff0000");
      hex.dispatchEvent(new Event("input", { bubbles: true }));
      hex.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    expect(host.textContent).toContain("unsaved");
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;
    await act(async () => {
      save.click();
    });
    expect(setPaletteColors).toHaveBeenCalled();
    const file = host.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(file, "files", { configurable: true, value: [new File(["a"], "a.png")] });
    window.confirm = () => true;
    await act(async () => {
      file.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(importPalette).toHaveBeenCalled();
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
    act(() => cancel.click());
  });

  it("shows an error when the palette will not decode", async () => {
    useStore.setState({
      romHandle: 1,
      editVersion: 2,
      selection: { ref: { container: -1, id: 6 }, name: "bad.nclr", format: "NCLR", compressed: false, size: 8 },
      client: {
        ...useStore.getState().client,
        decodePalette: async () => {
          throw new Error("no");
        },
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(PaletteViewer));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Could not decode palette");
  });
});
