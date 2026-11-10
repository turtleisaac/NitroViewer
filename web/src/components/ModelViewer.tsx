import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useStore, type ResourceItem } from "../state/store";
import {
  refKey,
  type MaterialColorAnim,
  type ResourceRef,
  type TexturePatternAnim,
  type VisibilityAnim,
} from "../transport";
import { ModelExportButtons, ModelToolbar, showModelExports, ViewportStatus } from "./ModelControls";
import {
  canPlayModel,
  frameObjPayload,
  modelNameAt,
  nsbcaPairKey,
  pairedNsbca,
  pickObjFile,
  pickTexFile,
} from "./modelViewerLogic";
import { fileStem, formatsOf, refDep, resourcesInContainer, useApplyOnChange } from "./viewerShared";

function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint" || err == null) return String(err);
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
  return "unknown error";
}

interface TexPat {
  anim: TexturePatternAnim;
  texCache: Map<string, THREE.Texture>;
}

interface Three {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  render: () => void;
  clock: THREE.Clock;
  mixer: THREE.AnimationMixer | null;
  actions: THREE.AnimationAction[];
  ro: ResizeObserver;
  grid: THREE.GridHelper | null; // ground grid, sized to the model (toggled from the UI)
  fit: () => void; // re-fit the camera to the current model (Reset view)
  // Track driving (NSBMA/NSBVA/NSBTP have no glTF path, so they're applied here per frame):
  trackTime: number;
  materialsByName: Map<string, THREE.MeshBasicMaterial[]>;
  meshes: THREE.Mesh[];
  matColor: MaterialColorAnim | null;
  vis: VisibilityAnim | null;
  visNodeByMaterial: Map<string, number>;
  texPat: TexPat | null;
}

const frameOf = (timeSec: number, frameCount: number) =>
  frameCount > 0 ? Math.floor(timeSec * 30) % frameCount : 0;

// Apply the loaded non-skeletal tracks at the given time. Safe to call with any subset missing.
function applyTracks(t: Three) {
  const time = t.trackTime;
  if (t.matColor) {
    const f = frameOf(time, t.matColor.frameCount);
    for (const m of t.matColor.materials) {
      const mats = t.materialsByName.get(m.name);
      if (!mats) continue;
      const alpha = m.alpha[f] ?? 1;
      for (const mat of mats) {
        mat.color.set(m.diffuse[f] ?? "#ffffff");
        mat.opacity = alpha;
        mat.transparent = mat.transparent || alpha < 1;
      }
    }
  }
  if (t.texPat) {
    const f = frameOf(time, t.texPat.anim.frameCount);
    for (const m of t.texPat.anim.materials) {
      const mats = t.materialsByName.get(m.name);
      const tex = t.texPat.texCache.get(m.frames[f]);
      if (!mats || !tex) continue;
      for (const mat of mats) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  }
  if (t.vis) {
    const f = frameOf(time, t.vis.frameCount);
    for (const mesh of t.meshes) {
      const name = (mesh.material as THREE.MeshBasicMaterial).name;
      const node = t.visNodeByMaterial.get(name);
      if (node == null) continue;
      const row = t.vis.visible[node];
      if (row) mesh.visible = row[f] !== 0;
    }
  }
}

// DS models are unlit — the texture + vertex colors are the final look. glTF exports them as PBR,
// which three.js then shades (washing them out). Swap to unlit MeshBasicMaterial so they render crisp,
// exactly as the hardware does, preserving the texture, alpha-test, and double-sidedness.
function makeUnlit(obj: THREE.Object3D) {
  const convert = (m: THREE.Material) => {
    const s = m as THREE.MeshStandardMaterial;
    const basic = new THREE.MeshBasicMaterial({
      map: s.map ?? null,
      color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
      transparent: s.transparent,
      opacity: s.opacity,
      alphaTest: s.alphaTest,
      side: s.side,
      vertexColors: s.vertexColors,
    });
    basic.name = s.name; // preserve DS material name so animation tracks can target it
    return basic;
  };
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    const material = mesh.material;
    mesh.material = Array.isArray(material) ? material.map(convert) : convert(material);
  });
}

function fitCamera(obj: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.5;
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.position.set(center.x + dist * 0.4, center.y + dist * 0.35, center.z + dist);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// Build a ground grid sized to the model, sitting under its feet (box min-Y), centred on it in X/Z.
// Two subtly-different line colors read clearly on the dark viewport without competing with the model.
function buildGrid(obj: THREE.Object3D): THREE.GridHelper {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z) * 2.5 || 2;
  const grid = new THREE.GridHelper(span, 20, 0x5b6b8c, 0x30384d);
  grid.position.set(center.x, box.min.y, center.z);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  grid.renderOrder = -1; // draw behind the model
  return grid;
}

type SetNum = Dispatch<SetStateAction<number>>;


/** Build the WebGL renderer for the model viewport. */
function createRenderer(mount: HTMLDivElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight || 400);
  mount.appendChild(renderer.domElement);
  return renderer;
}

/** Perspective camera framed on an empty viewport. */
function createCamera(mount: HTMLDivElement): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / (mount.clientHeight || 400), 0.01, 1000);
  camera.position.set(0, 0, 3);
  return camera;
}

/** Keep the camera aspect in step with the mount element. */
function observeViewport(
  mount: HTMLDivElement,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  render: () => void,
): ResizeObserver {
  const ro = new ResizeObserver(() => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w && h) resizeViewport(renderer, camera, render, w, h);
  });
  ro.observe(mount);
  return ro;
}

/** Apply a measured viewport size and draw once. */
function resizeViewport(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  render: () => void,
  w: number,
  h: number,
): void {
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}

/** Re-render after the browser restores a dropped WebGL context. */
function bindContextRestores(canvas: HTMLCanvasElement, render: () => void): () => void {
  const onLost = (event: Event) => event.preventDefault();
  const onRestored = () => render();
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}

/** Expose the live scene for screenshot drivers, matching `window.__store`. */
function publishThree(state: Three): void {
  if (typeof window !== "undefined") (window as unknown as { __three: Three }).__three = state;
}

/** Drop the ground grid and its GPU buffers. */
function disposeGrid(state: Three): void {
  if (!state.grid) return;
  state.scene.remove(state.grid);
  state.grid.geometry.dispose();
  (state.grid.material as THREE.Material).dispose();
}

/** Tear down the viewport created by `mountModelViewport`. */
function disposeViewport(
  mount: HTMLDivElement,
  state: Three,
  controls: OrbitControls,
  renderer: THREE.WebGLRenderer,
  render: () => void,
  unbindContext: () => void,
  three: MutableRefObject<Three | null>,
): void {
  state.ro.disconnect();
  controls.removeEventListener("change", render);
  unbindContext();
  controls.dispose();
  disposeGrid(state);
  renderer.dispose();
  if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
  three.current = null;
}

/** Create the on-demand three.js viewport and store it on `three`. */
function mountModelViewport(mount: HTMLDivElement, three: MutableRefObject<Three | null>): () => void {
  const renderer = createRenderer(mount);
  const scene = new THREE.Scene();
  const camera = createCamera(mount);
  const controls = new OrbitControls(camera, renderer.domElement);
  const root = new THREE.Group();
  scene.add(root);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);
  const unbindContext = bindContextRestores(renderer.domElement, render);
  const state: Three = {
    renderer, scene, camera, controls, root, render,
    clock: new THREE.Clock(), mixer: null, actions: [], ro: null as unknown as ResizeObserver,
    grid: null, fit: () => undefined, trackTime: 0, materialsByName: new Map(), meshes: [],
    matColor: null, vis: null, visNodeByMaterial: new Map(), texPat: null,
  };
  state.ro = observeViewport(mount, renderer, camera, render);
  three.current = state;
  publishThree(state);
  render();
  return () => disposeViewport(mount, state, controls, renderer, render, unbindContext, three);
}

/** Apply model-set metadata when the request is still current. */
function applyModelInfo(
  alive: boolean,
  next: { hasEmbeddedTextures: boolean; models: string[] },
  setInfo: (info: { hasEmbeddedTextures: boolean; models: string[] }) => void,
  setUseEmbedded: (embedded: boolean) => void,
  setNsbtx: (ref: ResourceRef | null) => void,
): void {
  if (!alive) return;
  setInfo(next);
  setUseEmbedded(next.hasEmbeddedTextures);
  setNsbtx(null);
}

/** Record a model-info failure when the request is still current. */
function failModelInfo(alive: boolean, err: unknown, setError: (error: string | null) => void): void {
  if (!alive) return;
  setError((err as Error).message);
}

/** Mark the viewport busy once the export has actually started. */
function markModelBusy(alive: boolean, setBusy: (busy: boolean) => void, setError: (error: string | null) => void): void {
  if (!alive) return;
  setBusy(true);
  setError(null);
}

/** Clear mixer state before a newly parsed scene replaces the old one. */
function resetMixer(state: Three): void {
  state.mixer?.stopAllAction();
  state.mixer = null;
  state.actions = [];
}

/** Remove every child of the model root. */
function clearGroup(root: THREE.Group): void {
  while (root.children.length) root.remove(root.children[0]);
}

/** Replace the ground grid and honour the current toggle. */
function swapGrid(state: Three, model: THREE.Object3D, showGrid: boolean): void {
  if (state.grid) disposeGrid(state);
  state.grid = buildGrid(model);
  state.grid.visible = showGrid;
  state.scene.add(state.grid);
}

/** Remember one named material so non-skeletal tracks can find it. */
function rememberMaterial(state: Three, material: THREE.Material): void {
  const basic = material as THREE.MeshBasicMaterial;
  if (!basic.name) return;
  const list = state.materialsByName.get(basic.name) ?? [];
  list.push(basic);
  state.materialsByName.set(basic.name, list);
}

/** Index one mesh, or ignore anything that is not a mesh. */
function collectMesh(state: Three, object: THREE.Object3D): void {
  if (!(object instanceof THREE.Mesh)) return;
  const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  state.meshes.push(mesh);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) rememberMaterial(state, material);
}

/** Reset track targets, then index the meshes of `model`. */
function indexMeshes(state: Three, model: THREE.Object3D): void {
  state.materialsByName = new Map();
  state.meshes = [];
  state.matColor = null;
  state.vis = null;
  state.texPat = null;
  state.visNodeByMaterial = new Map();
  state.trackTime = 0;
  model.traverse((object) => collectMesh(state, object));
}

/** Display name of a baked glTF clip. */
function clipName(clip: THREE.AnimationClip, index: number): string {
  return clip.name || `anim ${index}`;
}

/** Bind baked skeletal clips, or clear the clip list when the glTF has none. */
function bindAnimations(
  state: Three,
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
  setAnimNames: (names: string[]) => void,
  setAnimIndex: (index: number) => void,
): void {
  if (!gltf.animations.length) {
    setAnimNames([]);
    return;
  }
  state.mixer = new THREE.AnimationMixer(gltf.scene);
  state.actions = gltf.animations.map((clip) => state.mixer!.clipAction(clip));
  setAnimNames(gltf.animations.map((clip, index) => clipName(clip, index)));
  setAnimIndex(0);
}

interface GltfArgs {
  three: MutableRefObject<Three | null>;
  showGridRef: MutableRefObject<boolean>;
  setAnimNames: (names: string[]) => void;
  setAnimIndex: (index: number) => void;
  setLoadTick: SetNum;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  gltfStrRef: MutableRefObject<string | null>;
}

/** Install a parsed glTF: unlit materials, camera fit, grid, and clip list. */
function installParsedGltf(alive: boolean, args: GltfArgs, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): void {
  if (!alive || !args.three.current) return;
  const state = args.three.current;
  resetMixer(state);
  clearGroup(state.root);
  makeUnlit(gltf.scene);
  state.root.add(gltf.scene);
  fitCamera(gltf.scene, state.camera, state.controls);
  state.fit = () => {
    fitCamera(gltf.scene, state.camera, state.controls);
    state.render();
  };
  swapGrid(state, gltf.scene, args.showGridRef.current);
  indexMeshes(state, gltf.scene);
  bindAnimations(state, gltf, args.setAnimNames, args.setAnimIndex);
  state.render();
  args.setLoadTick((n) => n + 1);
  args.setBusy(false);
}

/** Surface a glTF parse failure. */
function failGltfParse(alive: boolean, args: GltfArgs, err: unknown): void {
  if (!alive) return;
  args.setError("glTF parse failed: " + describeError(err));
  args.setBusy(false);
}

/** Surface an export failure. `alive` is read when the rejection handler runs. */
function failGltfExport(alive: boolean, args: GltfArgs, err: unknown): void {
  if (!alive) return;
  args.setError((err as Error).message);
  args.setBusy(false);
}

/** Hand the exported glTF string to the loader. */
function acceptGltf(alive: () => boolean, args: GltfArgs, gltfStr: string): void {
  if (!alive() || !args.three.current) return;
  args.gltfStrRef.current = gltfStr;
  new GLTFLoader().parse(
    gltfStr,
    "",
    (gltf) => installParsedGltf(alive(), args, gltf),
    (err) => failGltfParse(alive(), args, err),
  );
}

interface LoadGltfArgs extends GltfArgs {
  info: { models: string[] } | null;
  client: { exportModelGltf: (handle: number, ref: ResourceRef, index: number, nsbtx: ResourceRef | null, nsbca: ResourceRef | null) => Promise<string> };
  romHandle: number;
  ref: ResourceRef;
  modelIndex: number;
  useEmbedded: boolean;
  nsbtx: ResourceRef | null;
  nsbca: ResourceRef | null;
}

/** Export the chosen model and load it. Returns the effect cleanup. */
function beginGltfLoad(args: LoadGltfArgs): () => void {
  if (!args.info || !args.three.current) return () => undefined;
  let alive = true;
  queueMicrotask(() => markModelBusy(alive, args.setBusy, args.setError));
  const nsbtx = args.useEmbedded ? null : args.nsbtx;
  args.client
    .exportModelGltf(args.romHandle, args.ref, args.modelIndex, nsbtx, args.nsbca)
    .then((gltfStr) => acceptGltf(() => alive, args, gltfStr))
    .catch((err: unknown) => failGltfExport(alive, args, err));
  return () => {
    alive = false;
  };
}

/** Play the selected clip and pause the others. */
function applyClip(action: THREE.AnimationAction, active: boolean, playing: boolean): void {
  if (!active) {
    action.stop();
    return;
  }
  action.reset();
  action.play();
  action.paused = !playing;
}

/** Switch the active skeletal clip without re-exporting. */
function activateClip(state: Three | null, animIndex: number, playing: boolean): void {
  if (!state || state.actions.length === 0) return;
  state.actions.forEach((action, index) => applyClip(action, index === animIndex, playing));
  state.mixer?.update(0);
  state.render();
}

/** Show or hide the ground grid and remember the choice for the next model load. */
function syncGrid(three: MutableRefObject<Three | null>, showGridRef: MutableRefObject<boolean>, showGrid: boolean): void {
  showGridRef.current = showGrid;
  const state = three.current;
  if (!state?.grid) return;
  state.grid.visible = showGrid;
  state.render();
}

/** Write a loaded track onto the live view and ask the painter to run. */
function storeTrack(
  alive: boolean,
  three: MutableRefObject<Three | null>,
  setTracksTick: SetNum,
  apply: (state: Three) => void,
): void {
  if (!alive || !three.current) return;
  apply(three.current);
  setTracksTick((n) => n + 1);
}

/** Clear a track slot and bump the apply effect. */
function clearTrack(assign: () => void, setTracksTick: SetNum): void {
  assign();
  queueMicrotask(() => setTracksTick((n) => n + 1));
}

interface MatColorArgs {
  three: MutableRefObject<Three | null>;
  nsbma: ResourceRef | null;
  client: { getMaterialColorAnim: (handle: number, ref: ResourceRef, index: number) => Promise<MaterialColorAnim> };
  romHandle: number;
  setTracksTick: SetNum;
}

/** Load or clear the NSBMA track. */
function beginMatColor(args: MatColorArgs): () => void {
  const state = args.three.current;
  if (!state) return () => undefined;
  if (!args.nsbma) {
    clearTrack(() => { state.matColor = null; }, args.setTracksTick);
    return () => undefined;
  }
  let alive = true;
  args.client
    .getMaterialColorAnim(args.romHandle, args.nsbma, 0)
    .then((data) => storeTrack(alive, args.three, args.setTracksTick, (state) => { state.matColor = data; }))
    .catch(() => undefined);
  return () => { alive = false; };
}

/** First node index for each material name. */
function rigMaterialMap(meshes: { material: string; node: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const mesh of meshes) rememberRigMesh(map, mesh);
  return map;
}

/** Record a material's node the first time it appears. */
function rememberRigMesh(map: Map<string, number>, mesh: { material: string; node: number }): void {
  if (!map.has(mesh.material)) map.set(mesh.material, mesh.node);
}

interface VisArgs {
  three: MutableRefObject<Three | null>;
  nsbva: ResourceRef | null;
  client: {
    getVisibilityAnim: (handle: number, ref: ResourceRef, index: number) => Promise<VisibilityAnim>;
    getModelRig: (handle: number, ref: ResourceRef, modelIndex: number) => Promise<{ meshes: { material: string; node: number }[] }>;
  };
  romHandle: number;
  modelRef: ResourceRef;
  modelIndex: number;
  setTracksTick: SetNum;
}

/** Load or clear the NSBVA track and the model rig. */
function beginVisibility(args: VisArgs): () => void {
  const state = args.three.current;
  if (!state) return () => undefined;
  if (!args.nsbva) {
    clearTrack(() => { state.vis = null; }, args.setTracksTick);
    return () => undefined;
  }
  let alive = true;
  Promise.all([
    args.client.getVisibilityAnim(args.romHandle, args.nsbva, 0),
    args.client.getModelRig(args.romHandle, args.modelRef, args.modelIndex),
  ])
    .then(([vis, rig]) => storeTrack(alive, args.three, args.setTracksTick, (state) => {
      state.vis = vis;
      state.visNodeByMaterial = rigMaterialMap(rig.meshes);
    }))
    .catch(() => undefined);
  return () => { alive = false; };
}

/** Configure one pattern texture the way the DS hardware samples it. */
async function configurePatternTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  const tex = await loader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false;
  return tex;
}

/** Decode every texture referenced by a pattern animation. */
async function loadPatternTextures(textures: Record<string, string>): Promise<Map<string, THREE.Texture>> {
  const cache = new Map<string, THREE.Texture>();
  const loader = new THREE.TextureLoader();
  for (const [name, url] of Object.entries(textures)) cache.set(name, await configurePatternTexture(loader, url));
  return cache;
}

/** Attach a decoded pattern track when the effect is still current. */
async function installTexPat(
  alive: () => boolean,
  three: MutableRefObject<Three | null>,
  data: TexturePatternAnim,
  setTracksTick: SetNum,
): Promise<void> {
  if (!alive() || !three.current) return;
  const texCache = await loadPatternTextures(data.textures);
  if (!alive() || !three.current) return;
  three.current.texPat = { anim: data, texCache };
  setTracksTick((n) => n + 1);
}

interface TexArgs {
  three: MutableRefObject<Three | null>;
  nsbtp: ResourceRef | null;
  useEmbedded: boolean;
  nsbtx: ResourceRef | null;
  client: {
    getTexturePatternAnim: (
      handle: number,
      nsbtp: ResourceRef,
      index: number,
      model: ResourceRef,
      nsbtx: ResourceRef | null,
    ) => Promise<TexturePatternAnim>;
  };
  romHandle: number;
  modelRef: ResourceRef;
  setTracksTick: SetNum;
}

/** Load or clear the NSBTP track. */
function beginTexPat(args: TexArgs): () => void {
  const state = args.three.current;
  if (!state) return () => undefined;
  if (!args.nsbtp) {
    clearTrack(() => { state.texPat = null; }, args.setTracksTick);
    return () => undefined;
  }
  let alive = true;
  const nsbtx = args.useEmbedded ? null : args.nsbtx;
  args.client
    .getTexturePatternAnim(args.romHandle, args.nsbtp, 0, args.modelRef, nsbtx)
    .then((data) => installTexPat(() => alive, args.three, data, args.setTracksTick))
    .catch(() => undefined);
  return () => { alive = false; };
}

/** Draw the current track frame. */
function paintTracks(three: MutableRefObject<Three | null>): void {
  const state = three.current;
  if (!state) return;
  applyTracks(state);
  state.render();
}

/** Advance one animation frame from the clock. */
function stepModel(state: Three): void {
  const dt = state.clock.getDelta();
  if (state.mixer) state.mixer.update(dt);
  state.trackTime += dt;
  applyTracks(state);
  state.render();
}

/** Start the playback interval, or do nothing when there is nothing to play. */
function beginPlayback(
  three: MutableRefObject<Three | null>,
  playing: boolean,
  busy: boolean,
  info: unknown,
  animNames: string[],
): () => void {
  const state = three.current;
  if (!canPlayModel(state, playing, busy, info, animNames) || !state) return () => undefined;
  state.clock.getDelta();
  const id = setInterval(() => stepModel(state), 1000 / 60);
  return () => clearInterval(id);
}

interface NsbcaNameArgs {
  items: ResourceItem[];
  names: Record<string, string[]>;
  client: { getAnimationSetInfo: (handle: number, ref: ResourceRef) => Promise<{ animations: { name: string }[] }> };
  romHandle: number;
  setNames: Dispatch<SetStateAction<Record<string, string[]>>>;
}

/** Fetch one NSBCA's clip names, skipping keys already cached. */
async function fetchOneNsbcaName(alive: () => boolean, args: NsbcaNameArgs, item: ResourceItem): Promise<void> {
  const key = refKey(item.ref);
  if (args.names[key]) return;
  try {
    const info = await args.client.getAnimationSetInfo(args.romHandle, item.ref);
    if (!alive()) return;
    args.setNames((current) => (current[key] ? current : { ...current, [key]: info.animations.map((clip) => clip.name) }));
  } catch {
    /* leave unnamed — pairing falls back to index proximity */
  }
}

/** Load clip names for every candidate NSBCA. */
async function fetchNsbcaNames(alive: () => boolean, args: NsbcaNameArgs): Promise<void> {
  for (const item of args.items) {
    if (!alive()) return;
    await fetchOneNsbcaName(alive, args, item);
  }
}

interface ObjImportArgs {
  ref: ResourceRef;
  importObj: (ref: ResourceRef, bytes: Uint8Array) => Promise<{ vertices: number; triangles: number; textured: boolean }>;
  importObjTextured: (ref: ResourceRef, payload: Uint8Array) => Promise<{ vertices: number; triangles: number; textured: boolean }>;
  setImporting: (importing: boolean) => void;
  setModelIndex: (index: number) => void;
  setError: (error: string | null) => void;
}

/** Import the textured payload when a texture file was selected. */
async function importTexturedObj(
  objBytes: Uint8Array,
  texFile: File,
  args: ObjImportArgs,
): Promise<{ vertices: number; triangles: number; textured: boolean }> {
  const texBytes = new Uint8Array(await texFile.arrayBuffer());
  return args.importObjTextured(args.ref, frameObjPayload(objBytes, texBytes));
}

/** Read the chosen files and import them over the open NSBMD. */
async function importObjBytes(objFile: File, texFile: File | undefined, args: ObjImportArgs): Promise<void> {
  const objBytes = new Uint8Array(await objFile.arrayBuffer());
  const result = texFile
    ? await importTexturedObj(objBytes, texFile, args)
    : await args.importObj(args.ref, objBytes);
  args.setModelIndex(0);
  args.setError(null);
  console.info(`OBJ import: ${result.vertices} verts, ${result.triangles} tris (textured=${result.textured}).`);
}

/** Import a Wavefront OBJ (and optional texture) chosen from the file input. */
async function importChosenObj(files: FileList, args: ObjImportArgs): Promise<void> {
  const list = Array.from(files);
  const objFile = pickObjFile(list);
  if (!objFile) {
    alert("Select an .obj file (optionally with a texture image).");
    return;
  }
  args.setImporting(true);
  try {
    await importObjBytes(objFile, pickTexFile(list), args);
  } catch (err) {
    alert("OBJ import failed: " + (err as Error).message);
  } finally {
    args.setImporting(false);
  }
}

/** Click a temporary anchor so the browser downloads `url`. */
function clickDownload(href: string, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Download the current framebuffer as PNG. */
function captureModelPng(three: MutableRefObject<Three | null>, selectionName: string): void {
  const state = three.current;
  if (!state) return;
  state.render();
  clickDownload(state.renderer.domElement.toDataURL("image/png"), `${fileStem(selectionName, "model")}.png`);
}

/** Download the last exported glTF document. */
function saveModelGltf(gltfStrRef: MutableRefObject<string | null>, selectionName: string): void {
  const text = gltfStrRef.current;
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: "model/gltf+json" }));
  clickDownload(url, `${fileStem(selectionName, "model")}.gltf`);
  URL.revokeObjectURL(url);
}

/** Re-centre the camera using the fit stored on the live scene. */
function resetModelView(three: MutableRefObject<Three | null>): void {
  three.current?.fit();
}

/** Open the hidden OBJ file input. */
function openObjPicker(input: MutableRefObject<HTMLInputElement | null>): void {
  input.current?.click();
}

/** Forward a chosen OBJ (and optional texture), then clear the input. */
function takeObjFiles(event: ChangeEvent<HTMLInputElement>, onFiles: (files: FileList) => void): void {
  const files = event.target.files;
  if (files && files.length) void onFiles(files);
  event.target.value = "";
}

/** State, effects, and handlers for `ModelViewer`. */
function useModelViewerState(mountRef: MutableRefObject<HTMLDivElement | null>) {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const narcs = useStore((s) => s.narcs);
  const romSiblings = useStore((s) => s.romSiblings);
  const editVersion = useStore((s) => s.editVersion);
  const selKey = refKey(selection.ref);
  const importObj = useStore((s) => s.importObj);
  const importObjTextured = useStore((s) => s.importObjTextured);
  const three = useRef<Three | null>(null);
  const gltfStrRef = useRef<string | null>(null);
  const showGridRef = useRef(true);
  const [importing, setImporting] = useState(false);
  const [info, setInfo] = useState<{ hasEmbeddedTextures: boolean; models: string[] } | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [useEmbedded, setUseEmbedded] = useState(true);
  const [nsbtx, setNsbtx] = useState<ResourceRef | null>(null);
  const [nsbca, setNsbca] = useState<ResourceRef | null>(null);
  const [nsbma, setNsbma] = useState<ResourceRef | null>(null);
  const [nsbva, setNsbva] = useState<ResourceRef | null>(null);
  const [nsbtp, setNsbtp] = useState<ResourceRef | null>(null);
  const [animNames, setAnimNames] = useState<string[]>([]);
  const [nsbcaNames, setNsbcaNames] = useState<Record<string, string[]>>({});
  const [tracksTick, setTracksTick] = useState(0);
  const [animIndex, setAnimIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(
    () => resourcesInContainer(selection.ref.container, narcs, romSiblings),
    [selection.ref.container, narcs, romSiblings],
  );
  const nsbtxItems = useMemo(() => formatsOf(items, "NSBTX"), [items]);
  const nsbcaItems = useMemo(() => formatsOf(items, "NSBCA"), [items]);
  const nsbmaItems = useMemo(() => formatsOf(items, "NSBMA"), [items]);
  const nsbvaItems = useMemo(() => formatsOf(items, "NSBVA"), [items]);
  const nsbtpItems = useMemo(() => formatsOf(items, "NSBTP"), [items]);

  useEffect(() => mountModelViewport(mountRef.current!, three), [mountRef]);

  useApplyOnChange(`${romHandle}:${selKey}:${editVersion}`, () => {
    setInfo(null);
    setError(null);
    setModelIndex(0);
  });

  useEffect(() => {
    let alive = true;
    const ref = { container: selection.ref.container, id: selection.ref.id };
    client
      .getModelSetInfo(romHandle, ref)
      .then((next) => applyModelInfo(alive, next, setInfo, setUseEmbedded, setNsbtx))
      .catch((err: unknown) => failModelInfo(alive, err, setError));
    return () => { alive = false; };
  }, [client, romHandle, selection.ref.container, selection.ref.id, editVersion]);

  useEffect(() => {
    let alive = true;
    void fetchNsbcaNames(() => alive, { items: nsbcaItems, names: nsbcaNames, client, romHandle, setNames: setNsbcaNames });
    return () => { alive = false; };
    // nsbcaNames is a cache read, not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, nsbcaItems]);

  const modelName = modelNameAt(info, modelIndex);
  const pairKey = nsbcaPairKey(selKey, modelIndex, modelName, nsbcaItems, nsbcaNames);
  useApplyOnChange(pairKey, () => {
    setNsbca(pairedNsbca(nsbcaItems, nsbcaNames, modelName, selection.ref.id));
  });
  useApplyOnChange(selKey, () => {
    setNsbma(null);
    setNsbva(null);
    setNsbtp(null);
  });

  const nsbtxDep = refDep(nsbtx);
  const nsbcaDep = refDep(nsbca);
  useEffect(() => beginGltfLoad({
    info, three, showGridRef, setAnimNames, setAnimIndex, setLoadTick, setBusy, setError, gltfStrRef,
    client, romHandle, ref: selection.ref, modelIndex, useEmbedded, nsbtx, nsbca,
  // selKey / refDep stand in for the ref objects, matching the previous dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [client, romHandle, selKey, modelIndex, useEmbedded, nsbtxDep, nsbcaDep, info, editVersion]);

  useEffect(() => {
    activateClip(three.current, animIndex, playing);
  }, [animIndex, playing, loadTick]);

  useEffect(() => {
    syncGrid(three, showGridRef, showGrid);
  }, [showGrid]);

  const nsbmaDep = refDep(nsbma);
  useEffect(
    () => beginMatColor({ three, nsbma, client, romHandle, setTracksTick }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, romHandle, nsbmaDep, loadTick],
  );

  const nsbvaDep = refDep(nsbva);
  useEffect(
    () => beginVisibility({ three, nsbva, client, romHandle, modelRef: selection.ref, modelIndex, setTracksTick }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, romHandle, selKey, modelIndex, nsbvaDep, loadTick],
  );

  const nsbtpDep = refDep(nsbtp);
  useEffect(
    () => beginTexPat({ three, nsbtp, useEmbedded, nsbtx, client, romHandle, modelRef: selection.ref, setTracksTick }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, romHandle, selKey, nsbtpDep, loadTick],
  );

  useEffect(() => {
    paintTracks(three);
  }, [tracksTick, loadTick, playing]);

  const animCount = animNames.length;
  useEffect(
    () => beginPlayback(three, playing, busy, info, animNames),
    // Length, not the array identity: renaming clips must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing, busy, info, animCount, loadTick, tracksTick],
  );

  const objArgs: ObjImportArgs = { ref: selection.ref, importObj, importObjTextured, setImporting, setModelIndex, setError };
  return {
    info,
    modelIndex,
    setModelIndex,
    useEmbedded,
    nsbtx,
    nsbtxItems,
    setUseEmbedded,
    setNsbtx,
    nsbca,
    nsbcaItems,
    nsbcaNames,
    setNsbca,
    nsbma,
    nsbmaItems,
    setNsbma,
    nsbva,
    nsbvaItems,
    setNsbva,
    nsbtp,
    nsbtpItems,
    setNsbtp,
    animNames,
    animIndex,
    setAnimIndex,
    playing,
    setPlaying,
    showGrid,
    setShowGrid,
    onFit: () => resetModelView(three),
    error,
    busy,
    loadTick,
    importing,
    onCapture: () => captureModelPng(three, selection.name),
    onSaveGltf: () => saveModelGltf(gltfStrRef, selection.name),
    onObjChosen: (files: FileList) => {
      void importChosenObj(files, objArgs);
    },
  };
}

export default function ModelViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLInputElement>(null);
  const vm = useModelViewerState(mountRef);
  const exportsOn = showModelExports(vm.loadTick, vm.error);
  return (
    <div className="model">
      <ModelToolbar {...vm} />
      <div className="viewport" ref={mountRef}>
        <ViewportStatus error={vm.error} busy={vm.busy} />
      </div>
      <div className="sprite-meta">
        <span>Drag to orbit · scroll to zoom · right-drag to pan</span>
        {exportsOn && (
          <ModelExportButtons
            importing={vm.importing}
            onCapture={vm.onCapture}
            onSave={vm.onSaveGltf}
            onImport={() => openObjPicker(objRef)}
          />
        )}
        {exportsOn && (
          <input
            ref={objRef}
            type="file"
            accept=".obj,text/plain,image/*"
            multiple
            hidden
            onChange={(event) => takeObjFiles(event, vm.onObjChosen)}
          />
        )}
      </div>
    </div>
  );
}
