// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROM_CONTAINER, refKey, type FormatInfo, type NitroViewerClient, type ResourceRef, type TreeFolder } from "../transport";
import { useStore } from "../state/store";
import ModelViewer from "./ModelViewer";

vi.mock("three", () => {
  /** A DOM node the viewer can parent, with the methods the scene setup calls. */
  function canvas() {
    const el = document.createElement("canvas");
    el.getContext = () => null;
    return el;
  }
  class WebGLRenderer {
    domElement = canvas();
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  class Scene {
    add() {}
    remove() {}
  }
  class PerspectiveCamera {
    aspect = 1;
    position = { set() {} };
    updateProjectionMatrix() {}
  }
  class Group {
    children: unknown[] = [];
    add() {}
  }
  class Clock {
    getDelta() {
      return 0;
    }
  }
  return { WebGLRenderer, Scene, PerspectiveCamera, Group, Clock };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControls {
    target = { copy() {} };
    addEventListener() {}
    removeEventListener() {}
    update() {}
    dispose() {}
  }
  return { OrbitControls };
});

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  class GLTFLoader {
    parse() {}
  }
  return { GLTFLoader };
});

const MODEL_A = 1;
const TEX = 2;
const MODEL_B = 3;

interface ModelCalls {
  info: ResourceRef[];
  gltf: Array<ResourceRef | null>;
}

/** A client that records model-info and glTF calls and answers with one synthetic model. */
function recordingClient(calls: ModelCalls): NitroViewerClient {
  const handler: ProxyHandler<NitroViewerClient> = {
    get(_target, prop) {
      if (prop === "getModelSetInfo") {
        return (_handle: number, ref: ResourceRef) => {
          calls.info.push(ref);
          return Promise.resolve({ hasEmbeddedTextures: true, models: ["body"] });
        };
      }
      if (prop === "exportModelGltf") {
        return (_handle: number, _nsbmd: ResourceRef, _index: number, nsbtx: ResourceRef | null) => {
          calls.gltf.push(nsbtx);
          return Promise.resolve('{"asset":{"version":"2.0"}}');
        };
      }
      if (prop === "detectFormat") {
        return () => Promise.resolve({ format: "NSBMD", compressed: false, size: 4 });
      }
      if (typeof prop !== "string") return undefined;
      return () => Promise.reject(new Error("unexpected client call: " + prop));
    },
  };
  return new Proxy({} as NitroViewerClient, handler);
}

/** A loose-file tree: two models and one external texture, none of it from a ROM. */
function looseTree(): TreeFolder {
  return {
    name: "/",
    folders: [],
    files: [
      { id: MODEL_A, name: "model-a.nsbmd" },
      { id: TEX, name: "textures.nsbtx" },
      { id: MODEL_B, name: "model-b.nsbmd" },
    ],
  };
}

/** Format map select() reads so it does not ask the client to detect these files. */
function formats(): Record<string, FormatInfo> {
  const entry = (format: string): FormatInfo => ({ format, compressed: false, size: 4 });
  return {
    [refKey({ container: ROM_CONTAINER, id: MODEL_A })]: entry("NSBMD"),
    [refKey({ container: ROM_CONTAINER, id: TEX })]: entry("NSBTX"),
    [refKey({ container: ROM_CONTAINER, id: MODEL_B })]: entry("NSBMD"),
  };
}

/** Commit effect promises and the microtasks the viewer queues after them. */
async function flushView(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The Textures control, present once model info has been applied. */
function texturesSelect(host: HTMLElement): HTMLSelectElement {
  const label = [...host.querySelectorAll("label")].find((el) => el.querySelector("span")?.textContent === "Textures");
  const select = label?.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("Textures select is not mounted");
  return select;
}

/** Choose an external texture the way the Textures dropdown does. */
function pickTextures(select: HTMLSelectElement, value: string): void {
  act(() => {
    // React reads the DOM value from this setter; calling it needs the select as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setValue?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ModelViewer re-select", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("keeps an external NSBTX when the open NSBMD is re-selected with a new ref, and refetches a different file", async () => {
    const calls: ModelCalls = { info: [], gltf: [] };
    const texKey = refKey({ container: ROM_CONTAINER, id: TEX });
    useStore.setState({
      client: recordingClient(calls),
      romHandle: 1,
      romName: "synthetic.nds",
      tree: looseTree(),
      formats: formats(),
      selection: null,
      romSiblings: [],
      editorDirty: false,
      editVersion: 0,
      narcs: {},
      narcByRef: {},
    });

    await act(async () => {
      await useStore.getState().select({ container: ROM_CONTAINER, id: MODEL_A }, "model-a.nsbmd");
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(ModelViewer));
    });
    await flushView();

    expect(calls.info.map((ref) => ref.id)).toEqual([MODEL_A]);
    expect(calls.gltf).toEqual([null]);
    expect(texturesSelect(host).value).toBe("embedded");

    pickTextures(texturesSelect(host), texKey);
    await flushView();

    expect(calls.info.map((ref) => ref.id)).toEqual([MODEL_A]);
    expect(calls.gltf.map((nsbtx) => (nsbtx ? refKey(nsbtx) : null))).toEqual([null, texKey]);
    expect(texturesSelect(host).value).toBe(texKey);

    // select() always stores the object it was given, including a second click of the same file.
    const openRef = useStore.getState().selection?.ref;
    await act(async () => {
      await useStore.getState().select({ container: ROM_CONTAINER, id: MODEL_A }, "model-a.nsbmd");
    });
    await flushView();

    const reselected = useStore.getState().selection?.ref;
    expect(reselected).not.toBe(openRef);
    expect(reselected && openRef && refKey(reselected)).toBe(openRef ? refKey(openRef) : "");
    expect(calls.info.map((ref) => ref.id)).toEqual([MODEL_A]);
    expect(calls.gltf.map((nsbtx) => (nsbtx ? refKey(nsbtx) : null))).toEqual([null, texKey]);
    expect(texturesSelect(host).value).toBe(texKey);

    await act(async () => {
      await useStore.getState().select({ container: ROM_CONTAINER, id: MODEL_B }, "model-b.nsbmd");
    });
    await flushView();

    expect(calls.info.map((ref) => ref.id)).toEqual([MODEL_A, MODEL_B]);
    expect(calls.gltf.map((nsbtx) => (nsbtx ? refKey(nsbtx) : null))).toEqual([null, texKey, null]);
    expect(texturesSelect(host).value).toBe("embedded");
  });
});
