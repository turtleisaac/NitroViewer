// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../state/store";
import { ParticleViewer } from "./ParticleViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ParticleViewer", () => {
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
      root?.render(createElement(ParticleViewer));
    });
  }

  it("shows a frame and toggles playback", async () => {
    let resolveFrames: (value: { emitterCount: number; frames: string[] }) => void = () => undefined;
    useStore.setState({
      romHandle: 1,
      selection: { ref: { container: -1, id: 3 }, name: "fx.spa", format: "SPA", compressed: false, size: 4 },
      client: {
        ...useStore.getState().client,
        renderParticles: () => new Promise((resolve) => {
          resolveFrames = resolve;
        }),
      },
    });
    mount();
    expect(host?.textContent).toContain("Rendering particle effect");
    await act(async () => {
      resolveFrames({ emitterCount: 2, frames: ["data:image/png,aaa"] });
    });
    expect(host?.querySelector(".pframe")).toBeTruthy();
    const button = host?.querySelector(".play-btn") as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host?.textContent).toContain("Play");
  });

  it("shows an error when rendering fails", async () => {
    useStore.setState({
      romHandle: 1,
      selection: { ref: { container: -1, id: 4 }, name: "bad.spa", format: "SPA", compressed: false, size: 4 },
      client: {
        ...useStore.getState().client,
        renderParticles: async () => {
          throw new Error("nope");
        },
      },
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host?.textContent).toContain("Could not render effect");
  });
});
