// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useStore } from "./state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("App", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    delete window.nitroviewer;
  });

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(App));
    });
  }

  it("opens a ROM from the empty state and from the header", async () => {
    const openRom = vi.fn(async () => undefined);
    const openUnpackedFolder = vi.fn(async () => undefined);
    const openRomBytes = vi.fn(async () => undefined);
    const openUnpackedEntries = vi.fn(async () => undefined);
    useStore.setState({
      boot: async () => undefined,
      booted: true,
      loading: false,
      status: "Ready",
      romHandle: null,
      romName: "",
      openRom,
      openUnpackedFolder,
      openRomBytes,
      openUnpackedEntries,
      dirty: false,
      editorDirty: false,
    });
    mount();
    expect(host?.textContent).toContain("Open ROM…");

    const open = host?.querySelector(".btn--primary") as HTMLButtonElement;
    await act(async () => {
      open.click();
    });
    expect(host?.querySelector("[role=menu]")).toBeTruthy();
    await act(async () => {
      open.click();
    });
    expect(host?.querySelector("[role=menu]")).toBeNull();
    await act(async () => {
      open.click();
    });
    const item = host?.querySelector("[role=menuitem]") as HTMLButtonElement;
    const input = host?.querySelector("input[accept='.nds']") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    act(() => item.click());
    expect(click).toHaveBeenCalled();
    const file = new File([new Uint8Array([1])], "tiny.nds");
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(openRom).toHaveBeenCalled();

    const folder = host?.querySelector("input[multiple]") as HTMLInputElement;
    Object.defineProperty(folder, "files", { value: [] });
    await act(async () => {
      folder.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(openUnpackedFolder).not.toHaveBeenCalled();

    window.nitroviewer = {
      pickOpen: async () => ({ kind: "file", name: "a.nds", bytes: new Uint8Array([2]) }),
    };
    await act(async () => {
      open.click();
    });
    expect(openRomBytes).toHaveBeenCalled();

    window.nitroviewer = {
      pickOpen: async () => ({ kind: "file", name: "b.nds", bytes: [3, 4] as unknown as Uint8Array }),
    };
    await act(async () => {
      open.click();
    });
    window.nitroviewer = {
      pickOpen: async () => ({
        kind: "folder",
        name: "rom",
        files: [{ path: "header.bin", data: [1] as unknown as Uint8Array }],
      }),
    };
    await act(async () => {
      open.click();
    });
    expect(openUnpackedEntries).toHaveBeenCalled();
    window.nitroviewer = { pickOpen: async () => ({ canceled: true }) };
    await act(async () => {
      open.click();
    });
    expect(host?.querySelector("[role=menu]")).toBeNull();
  });

  it("shows the browser, undo, and save once a ROM is open", async () => {
    const undo = vi.fn(async () => undefined);
    const redo = vi.fn(async () => undefined);
    const saveRom = vi.fn(async () => undefined);
    const setTreeWidth = vi.fn();
    const setTreeCollapsed = vi.fn();
    const setNavOpen = vi.fn();
    useStore.setState({
      boot: async () => undefined,
      booted: true,
      loading: false,
      status: "Ready",
      romHandle: 1,
      romName: "TINY.nds",
      dirty: true,
      editorDirty: true,
      editorCapturesUndo: false,
      editorCanUndo: true,
      editorCanRedo: false,
      undoStack: [],
      redoStack: [],
      saving: false,
      undo,
      redo,
      saveRom,
      setTreeWidth,
      setTreeCollapsed,
      setNavOpen,
      treeCollapsed: false,
      navOpen: true,
      treeWidth: 340,
      tree: null,
      selection: null,
    });
    mount();
    expect(host?.textContent).toContain("Unsaved");
    expect(host?.textContent).toContain("TINY.nds");
    const undoBtn = host?.querySelector("button[title='Undo the last color/pixel edit']") as HTMLButtonElement;
    const redoBtn = host?.querySelector("button[title='Nothing to redo']") as HTMLButtonElement;
    await act(async () => {
      undoBtn.click();
      redoBtn.click();
    });
    expect(undo).toHaveBeenCalled();
    const save = host?.querySelector(".btn--save") as HTMLButtonElement;
    await act(async () => {
      save.click();
    });
    expect(saveRom).toHaveBeenCalled();

    const resizer = host?.querySelector(".tree-resizer") as HTMLElement;
    act(() => {
      resizer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 280 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(setTreeWidth).toHaveBeenCalled();

    const collapse = host?.querySelector(".tree-collapse-btn") as HTMLButtonElement;
    act(() => collapse.click());
    expect(setTreeCollapsed).toHaveBeenCalled();
    const scrim = host?.querySelector(".scrim") as HTMLElement;
    act(() => scrim.click());
    expect(setNavOpen).toHaveBeenCalledWith(false);

    const headerOpen = [...(host?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("Open"));
    await act(async () => {
      headerOpen?.click();
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host?.querySelector("[role=menu]")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    });
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    field.remove();
    expect(undo).toHaveBeenCalled();
    expect(redo).toHaveBeenCalled();

    act(() => {
      useStore.setState({
        editorDirty: false,
        editorCapturesUndo: false,
        undoStack: [{ label: "a" } as never],
        redoStack: [{ label: "b" } as never],
        saving: true,
        dirty: false,
        treeCollapsed: true,
        navOpen: false,
      });
    });
    expect(host?.querySelector("button[title='Undo the last edit']")).toBeTruthy();
    expect(host?.querySelector("button[title='Redo the undone edit']")).toBeTruthy();
    expect(host?.textContent).toContain("Saving…");
    expect(host?.querySelector(".tree-resizer")).toBeNull();
    expect(host?.querySelector(".scrim")).toBeNull();

    act(() => {
      useStore.setState({
        editorDirty: true,
        editorCanUndo: false,
        editorCanRedo: true,
        dirty: true,
        saving: false,
      });
    });
    expect(host?.querySelector("button[title='Nothing to undo']")).toBeTruthy();
    expect(host?.querySelector("button[title='Redo the last color/pixel edit']")).toBeTruthy();
    expect(host?.querySelector("button[title='Download the edited .nds']")).toBeTruthy();
  });

  it("warns before unload while a draft is dirty and shows the loading screen", () => {
    useStore.setState({
      boot: async () => undefined,
      booted: false,
      loading: true,
      status: "Starting",
      romHandle: null,
      dirty: true,
      editorDirty: false,
    });
    mount();
    expect(host?.querySelector(".loading-screen")).toBeTruthy();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
