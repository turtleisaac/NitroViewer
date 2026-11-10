// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceItem } from "../state/store";
import { useStore } from "../state/store";
import { MultiCellViewer } from "./MultiCellViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(id: number, format: string): ResourceItem {
  return { ref: { container: -1, id }, label: `#${id}`, format };
}

const image = { png: "data:image/png,YQ==", width: 4, height: 4 };

describe("MultiCellViewer", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(MultiCellViewer));
    });
  }

  it("draws an NMCR and an NMAR", async () => {
    const setPairingOverride = vi.fn();
    const siblings = [item(0, "NMCR"), item(1, "NCER"), item(2, "NCGR"), item(3, "NCLR"), item(4, "NMAR")];
    useStore.setState({
      romHandle: 1,
      editVersion: 1,
      narcs: {},
      romSiblings: siblings,
      pairingOverrides: {},
      setPairingOverride,
      selection: { ref: { container: -1, id: 0 }, name: "cell.nmcr", format: "NMCR", compressed: false, size: 8 },
      client: {
        ...useStore.getState().client,
        decodeNmcrMeta: async () => ({ multiCellCount: 2 }),
        decodeNmarMeta: async () => ({ animations: [{ name: "a", frames: 2 }] }),
        decodeNmcr: async () => image,
        decodeNmar: async () => image,
      },
    });
    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host?.querySelector(".sprite-img")).toBeTruthy();
    const save = [...(host?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Save PNG");
    act(() => save?.click());

    act(() => {
      useStore.setState({
        selection: { ref: { container: -1, id: 4 }, name: "anim.nmar", format: "NMAR", compressed: false, size: 8 },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const play = host?.querySelector(".play-btn") as HTMLButtonElement;
    act(() => play.click());
    expect(host?.textContent).toContain("Play");
  });
});
