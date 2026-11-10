// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROM_CONTAINER, refKey, type FormatInfo, type NitroViewerClient, type ResourceRef } from "../transport";
import { useStore } from "../state/store";
import ModelViewer from "./ModelViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threeMock = vi.hoisted(() => {
  class Object3D {
    children: Object3D[] = [];
    traverse(fn: (obj: Object3D) => void): void {
      fn(this);
      for (const child of this.children) child.traverse(fn);
    }
    add(child: Object3D): void {
      this.children.push(child);
    }
    remove(child: Object3D): void {
      this.children = this.children.filter((item) => item !== child);
    }
  }
  class Mesh extends Object3D {
    material: unknown;
    constructor(material?: unknown) {
      super();
      this.material = material;
    }
  }
  class Material {
    name = "";
  }
  class MeshStandardMaterial extends Material {
    map = null;
    color = { clone() { return {}; } };
    transparent = false;
    opacity = 1;
    alphaTest = 0;
    side = 0;
    vertexColors = false;
  }
  class MeshBasicMaterial extends Material {}
  class Color {
    clone() { return this; }
  }
  class Box3 {
    min = { y: 0 };
    setFromObject() { return this; }
    getSize() { return { x: 2, y: 1, z: 0 }; }
    getCenter() { return { x: 0, y: 0, z: 0 }; }
  }
  class Vector3 {}
  class GridHelper {
    position = { set() { return undefined; } };
    material = { dispose() { return undefined; } };
    geometry = { dispose() { return undefined; } };
    renderOrder = 0;
  }
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    setPixelRatio() { return undefined; }
    setSize() { return undefined; }
    render() { return undefined; }
    dispose() { return undefined; }
  }
  class Scene extends Object3D {}
  class Group extends Object3D {}
  class PerspectiveCamera {
    fov = 45;
    aspect = 1;
    near = 0.1;
    far = 100;
    position = { set() { return undefined; } };
    updateProjectionMatrix() { return undefined; }
  }
  class Clock {
    getDelta() { return 0.01; }
  }
  class AnimationMixer {
    clipAction() {
      return { reset() { return undefined; }, play() { return undefined; }, stop() { return undefined; }, paused: false };
    }
    stopAllAction() { return undefined; }
    update() { return undefined; }
  }
  class TextureLoader {
    loadAsync() {
      return Promise.resolve({});
    }
  }
  return {
    Object3D, Mesh, Material, MeshStandardMaterial, MeshBasicMaterial, Color, Box3, Vector3, GridHelper,
    WebGLRenderer, Scene, Group, PerspectiveCamera, Clock, AnimationMixer, TextureLoader,
    SRGBColorSpace: "srgb", NearestFilter: 1,
  };
});

vi.mock("three", () => threeMock);

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControls {
    target = { copy() { return undefined; } };
    addEventListener() { return undefined; }
    removeEventListener() { return undefined; }
    update() { return undefined; }
    dispose() { return undefined; }
  }
  return { OrbitControls };
});

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  class GLTFLoader {
    parse(_data: string, _path: string, onLoad: (gltf: unknown) => void): void {
      const scene = new threeMock.Group();
      const named = new threeMock.MeshStandardMaterial();
      named.name = "body";
      scene.add(new threeMock.Mesh(named));
      scene.add(new threeMock.Mesh([new threeMock.MeshStandardMaterial()]));
      scene.add(new threeMock.Object3D());
      onLoad({ scene, animations: [{ name: "" }] });
    }
  }
  return { GLTFLoader };
});

class ImmediateResize extends ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super(callback);
    callback([], this);
  }
}

const MODEL = 1;
const NSBCA_OK = 4;
const NSBCA_BAD = 8;
const NSBMA = 5;
const NSBVA = 6;
const NSBTP = 7;

function ref(id: number): ResourceRef {
  return { container: ROM_CONTAINER, id };
}

describe("ModelViewer paths", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const realResize = globalThis.ResizeObserver;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    globalThis.ResizeObserver = realResize;
  });

  it("loads a model, its tracks, and an OBJ", async () => {
    globalThis.ResizeObserver = ImmediateResize;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 120 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 80 });
    const alerted = vi.fn();
    window.alert = alerted;
    const importObj = vi.fn(() => Promise.resolve({ vertices: 3, triangles: 1, textured: false }));
    const importObjTextured = vi.fn(() => Promise.resolve({ vertices: 3, triangles: 1, textured: true }));
    const client = {
      getModelSetInfo: () => Promise.resolve({ hasEmbeddedTextures: true, models: ["body", "head"] }),
      exportModelGltf: () => Promise.resolve("{}"),
      getAnimationSetInfo: (_handle: number, file: ResourceRef) => {
        if (file.id === NSBCA_BAD) return Promise.reject(new Error("no names"));
        return Promise.resolve({ animations: [{ name: "walk" }] });
      },
      getMaterialColorAnim: () => Promise.resolve({ frameCount: 1, materials: [] }),
      getVisibilityAnim: () => Promise.resolve({ frameCount: 1, nodeCount: 1, visible: [[1]] }),
      getModelRig: () => Promise.resolve({ meshes: [{ material: "body", node: 0 }, { material: "body", node: 1 }] }),
      getTexturePatternAnim: () => Promise.resolve({
        frameCount: 1,
        materials: [],
        textures: { skin: "data:image/png,xx" },
      }),
      detectFormat: () => Promise.resolve({ format: "NSBMD", compressed: false, size: 4 }),
    };
    const formats: Record<string, FormatInfo> = {};
    for (const [id, format] of [[MODEL, "NSBMD"], [NSBCA_OK, "NSBCA"], [NSBCA_BAD, "NSBCA"], [NSBMA, "NSBMA"], [NSBVA, "NSBVA"], [NSBTP, "NSBTP"]] as const) {
      formats[refKey(ref(id))] = { format, compressed: false, size: 4 };
    }
    useStore.setState({
      client: client as unknown as NitroViewerClient,
      romHandle: 1,
      tree: {
        name: "/",
        folders: [],
        files: [
          { id: MODEL, name: "hero.nsbmd" },
          { id: NSBCA_OK, name: "walk.nsbca" },
          { id: NSBCA_BAD, name: "bad.nsbca" },
          { id: NSBMA, name: "color.nsbma" },
          { id: NSBVA, name: "vis.nsbva" },
          { id: NSBTP, name: "pat.nsbtp" },
        ],
      },
      formats,
      selection: null,
      romSiblings: [],
      importObj,
      importObjTextured,
      editVersion: 0,
      narcs: {},
    });
    await act(async () => {
      await useStore.getState().select(ref(MODEL), "hero.nsbmd");
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root?.render(createElement(ModelViewer)); });
    for (let i = 0; i < 8; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    expect(host.textContent).toContain("Capture PNG");

    const choose = (label: string, value: string) => {
      const row = [...host!.querySelectorAll("label")].find((el) => el.querySelector("span")?.textContent === label);
      const select = row?.querySelector("select") as HTMLSelectElement;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- React reads the prototype setter
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      act(() => {
        setValue?.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    choose("Material color", refKey(ref(NSBMA)));
    choose("Visibility", refKey(ref(NSBVA)));
    choose("Texture pattern", refKey(ref(NSBTP)));
    for (let i = 0; i < 6; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }

    const input = host.querySelector("input[type=file]") as HTMLInputElement;
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [png] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(alerted).toHaveBeenCalled();
    const obj = new File([new Uint8Array([2])], "a.obj");
    Object.defineProperty(input, "files", { configurable: true, value: [obj, png] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(importObjTextured).toHaveBeenCalled();

    act(() => { useStore.setState({ romHandle: 2 }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });
});
