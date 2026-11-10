// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ROM_CONTAINER, type TreeFolder } from "../transport";
import { useStore } from "../state/store";
import { TreePane } from "./TreePane";

const tree: TreeFolder = {
  name: "/",
  folders: [{ name: "nested", folders: [], files: [] }],
  files: [
    { id: 1, name: "sprite.NCGR" },
    { id: 2, name: "" },
  ],
};

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(TreePane));
  });
  return { host, root };
}

describe("TreePane", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("lists files, selects the banner, and searches", () => {
    useStore.setState({
      tree,
      navOpen: true,
      revealPath: "/",
      revealTick: 1,
      idToPath: { 1: "/sprite.NCGR", 2: "/unnamed" },
      selection: { ref: { container: ROM_CONTAINER, id: 1 }, name: "sprite.NCGR", format: "NCGR", compressed: false, size: 1 },
      expanded: new Set(["/", "/nested/"]),
    });
    window.alert = () => undefined;
    useStore.setState({
      romHandle: 1,
      select: async () => undefined,
      client: {
        ...useStore.getState().client,
        exportFolderZip: async () => {
          throw new Error("nope");
        },
      },
    });
    ({ host, root } = mount());
    expect(host?.textContent).toContain("sprite.NCGR");
    expect(host?.textContent).toContain("#2");

    const click = (selector: string) => {
      const el = host?.querySelector(selector) as HTMLElement;
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    click(".tree-pinned");
    click(".tree-row.file:not(.tree-pinned)");
    click(".tree-row.folder");
    click(".tree-extract");

    const input = host?.querySelector("input") as HTMLInputElement;
    act(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- React reads the prototype setter
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "sprite");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(host?.textContent).toContain("matches");
  });

  it("shows the tree when the search box is empty", () => {
    useStore.setState({
      tree: null,
      navOpen: false,
      revealPath: null,
      idToPath: {},
      selection: null,
      expanded: new Set<string>(),
    });
    ({ host, root } = mount());
    expect(host?.querySelector(".tree-pane.open")).toBeNull();
    expect(host?.textContent).toContain("Game icon");
  });
});
