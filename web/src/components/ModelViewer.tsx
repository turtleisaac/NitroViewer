import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useStore } from "../state/store";
import { pickNearestAfter } from "../state/pairing";
import {
  refKey,
  type MaterialColorAnim,
  type ResourceRef,
  type TexturePatternAnim,
  type VisibilityAnim,
} from "../transport";

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

// DS models are unlit — the texture + vertex colours are the final look. glTF exports them as PBR,
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
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    }
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

export default function ModelViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const narcs = useStore((s) => s.narcs);
  const romSiblings = useStore((s) => s.romSiblings);
  const selKey = refKey(selection.ref);

  const mountRef = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const gltfStrRef = useRef<string | null>(null);

  const [info, setInfo] = useState<{ hasEmbeddedTextures: boolean; models: string[] } | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [useEmbedded, setUseEmbedded] = useState(true);
  const [nsbtx, setNsbtx] = useState<ResourceRef | null>(null);
  const [nsbca, setNsbca] = useState<ResourceRef | null>(null);
  const [nsbma, setNsbma] = useState<ResourceRef | null>(null);
  const [nsbva, setNsbva] = useState<ResourceRef | null>(null);
  const [nsbtp, setNsbtp] = useState<ResourceRef | null>(null);
  const [animNames, setAnimNames] = useState<string[]>([]);
  const [tracksTick, setTracksTick] = useState(0); // bumped when track data (re)loads
  const [animIndex, setAnimIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const siblingsOfFormat = (fmt: string) => {
    const container = selection.ref.container;
    const items =
      container >= 0
        ? (narcs[container]?.entries ?? []).map((e) => ({ ref: { container, id: e.index }, format: e.format, label: `#${e.index}` }))
        : romSiblings;
    return items.filter((i) => i.format === fmt);
  };
  const nsbtxItems = useMemo(() => siblingsOfFormat("NSBTX"), [selection.ref.container, narcs, romSiblings]);
  const nsbcaItems = useMemo(() => siblingsOfFormat("NSBCA"), [selection.ref.container, narcs, romSiblings]);
  const nsbmaItems = useMemo(() => siblingsOfFormat("NSBMA"), [selection.ref.container, narcs, romSiblings]);
  const nsbvaItems = useMemo(() => siblingsOfFormat("NSBVA"), [selection.ref.container, narcs, romSiblings]);
  const nsbtpItems = useMemo(() => siblingsOfFormat("NSBTP"), [selection.ref.container, narcs, romSiblings]);

  // Initialise the three.js scene once. Render ON DEMAND (interaction / resize / load / anim frame),
  // never a perpetual RAF loop — that starves CheerpJ's cooperative Java execution and hangs exports.
  useEffect(() => {
    const mount = mountRef.current!;
    // preserveDrawingBuffer lets "Save PNG" read the canvas back after an on-demand render (WebGL
    // otherwise clears the buffer once the frame is composited).
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight || 400);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / (mount.clientHeight || 400), 0.01, 1000);
    camera.position.set(0, 0, 3);
    const controls = new OrbitControls(camera, renderer.domElement);

    // No lights needed — models render unlit (see makeUnlit).
    const root = new THREE.Group();
    scene.add(root);

    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);

    const state: Three = {
      renderer, scene, camera, controls, root, render,
      clock: new THREE.Clock(), mixer: null, actions: [], ro: null as unknown as ResizeObserver,
      trackTime: 0, materialsByName: new Map(), meshes: [],
      matColor: null, vis: null, visNodeByMaterial: new Map(), texPat: null,
    };

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w && h) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
      }
    });
    ro.observe(mount);
    state.ro = ro;
    three.current = state;
    render();

    return () => {
      ro.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // Load the model set's metadata whenever the selected NSBMD changes.
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    setModelIndex(0);
    client
      .getModelSetInfo(romHandle, selection.ref)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        setUseEmbedded(i.hasEmbeddedTextures);
        setNsbtx(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, selKey]);

  // Auto-pair the nearest animation set (first NSBCA at/after the model's index) so models play by
  // default; the picker lets the user correct it or choose None (static).
  useEffect(() => {
    setNsbca(pickNearestAfter(nsbcaItems, selection.ref.id) ?? null);
    setNsbma(null);
    setNsbva(null);
    setNsbtp(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, nsbcaItems]);

  // Export the chosen model (+ optional NSBCA) to glTF and load it into the scene.
  useEffect(() => {
    if (!info || !three.current) return;
    let alive = true;
    setBusy(true);
    setError(null);
    client
      .exportModelGltf(romHandle, selection.ref, modelIndex, useEmbedded ? null : nsbtx, nsbca)
      .then((gltfStr) => {
        if (!alive || !three.current) return;
        gltfStrRef.current = gltfStr;
        new GLTFLoader().parse(
          gltfStr,
          "",
          (gltf) => {
            if (!alive || !three.current) return;
            const t = three.current;
            t.mixer?.stopAllAction();
            t.mixer = null;
            t.actions = [];
            while (t.root.children.length) t.root.remove(t.root.children[0]);
            makeUnlit(gltf.scene);
            t.root.add(gltf.scene);
            fitCamera(gltf.scene, t.camera, t.controls);

            // Index meshes + materials (by DS material name) so the non-skeletal tracks can target them.
            t.materialsByName = new Map();
            t.meshes = [];
            t.matColor = null;
            t.vis = null;
            t.texPat = null;
            t.visNodeByMaterial = new Map();
            t.trackTime = 0;
            gltf.scene.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                t.meshes.push(o);
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const mat of mats) {
                  const name = (mat as THREE.MeshBasicMaterial).name;
                  if (!name) continue;
                  const arr = t.materialsByName.get(name) ?? [];
                  arr.push(mat as THREE.MeshBasicMaterial);
                  t.materialsByName.set(name, arr);
                }
              }
            });

            if (gltf.animations.length) {
              t.mixer = new THREE.AnimationMixer(gltf.scene);
              t.actions = gltf.animations.map((clip) => t.mixer!.clipAction(clip));
              setAnimNames(gltf.animations.map((a, i) => a.name || `anim ${i}`));
              setAnimIndex(0);
            } else {
              setAnimNames([]);
            }
            t.render();
            setLoadTick((n) => n + 1);
            setBusy(false);
          },
          (err) => {
            if (alive) {
              setError("glTF parse failed: " + String((err as { message?: string })?.message ?? err));
              setBusy(false);
            }
          }
        );
      })
      .catch((e) => {
        if (alive) {
          setError((e as Error).message);
          setBusy(false);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, selKey, modelIndex, useEmbedded, nsbtx ? refKey(nsbtx) : "", nsbca ? refKey(nsbca) : "", info]);

  // Activate the selected animation clip (a JS-side switch among the baked clips — no re-export).
  useEffect(() => {
    const t = three.current;
    if (!t || t.actions.length === 0) return;
    t.actions.forEach((a, i) => {
      if (i === animIndex) {
        a.reset();
        a.play();
        a.paused = !playing;
      } else {
        a.stop();
      }
    });
    t.mixer?.update(0);
    t.render();
  }, [animIndex, playing, loadTick]);

  // Load NSBMA (material colour) track data.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (!nsbma) { t.matColor = null; setTracksTick((n) => n + 1); return; }
    let alive = true;
    client
      .getMaterialColorAnim(romHandle, nsbma, 0)
      .then((d) => { if (alive && three.current) { three.current.matColor = d; setTracksTick((n) => n + 1); } })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, nsbma ? refKey(nsbma) : "", loadTick]);

  // Load NSBVA (visibility) track data + the model rig (material → node).
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (!nsbva) { t.vis = null; setTracksTick((n) => n + 1); return; }
    let alive = true;
    Promise.all([
      client.getVisibilityAnim(romHandle, nsbva, 0),
      client.getModelRig(romHandle, selection.ref, modelIndex),
    ])
      .then(([v, rig]) => {
        if (!alive || !three.current) return;
        const map = new Map<string, number>();
        for (const m of rig.meshes) if (!map.has(m.material)) map.set(m.material, m.node);
        three.current.vis = v;
        three.current.visNodeByMaterial = map;
        setTracksTick((n) => n + 1);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, selKey, modelIndex, nsbva ? refKey(nsbva) : "", loadTick]);

  // Load NSBTP (texture pattern) track data + decode its textures to THREE.Textures.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (!nsbtp) { t.texPat = null; setTracksTick((n) => n + 1); return; }
    let alive = true;
    client
      .getTexturePatternAnim(romHandle, nsbtp, 0, selection.ref, useEmbedded ? null : nsbtx)
      .then(async (d) => {
        if (!alive || !three.current) return;
        const texCache = new Map<string, THREE.Texture>();
        const loader = new THREE.TextureLoader();
        for (const [name, url] of Object.entries(d.textures)) {
          const tex = await loader.loadAsync(url);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.flipY = false;
          texCache.set(name, tex);
        }
        if (!alive || !three.current) return;
        three.current.texPat = { anim: d, texCache };
        setTracksTick((n) => n + 1);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, selKey, nsbtp ? refKey(nsbtp) : "", loadTick]);

  // Apply the current frame of the loaded tracks whenever they change or playback is paused.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    applyTracks(t);
    t.render();
  }, [tracksTick, loadTick, playing]);

  // Drive the animation with a RAF loop ONLY while actively playing and not exporting.
  useEffect(() => {
    const t = three.current;
    const hasAnim = !!(animNames.length > 0 || t?.matColor || t?.vis || t?.texPat);
    if (!t || !playing || busy || !info || !hasAnim) return;
    let raf = 0;
    t.clock.getDelta(); // reset delta so the first frame doesn't jump
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = t.clock.getDelta();
      if (t.mixer) t.mixer.update(dt);
      t.trackTime += dt;
      applyTracks(t);
      t.render();
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [playing, busy, info, animNames.length, loadTick, tracksTick]);

  const capturePng = () => {
    const t = three.current;
    if (!t) return;
    t.render(); // draw the current frame, then read it back synchronously (buffer still intact)
    const url = t.renderer.domElement.toDataURL("image/png");
    const base = (selection.name.split(/[/:]/).pop() || "model").replace(/[^\w.\-]+/g, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const saveGltf = () => {
    if (!gltfStrRef.current) return;
    const base = (selection.name.split(/[/:]/).pop() || "model").replace(/[^\w.\-]+/g, "_");
    const blob = new Blob([gltfStrRef.current], { type: "model/gltf+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.gltf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="model">
      <div className="controls">
        {info && info.models.length > 1 && (
          <label className="ctrl">
            <span>Model</span>
            <select value={modelIndex} onChange={(e) => setModelIndex(+e.target.value)}>
              {info.models.map((n, i) => (
                <option key={i} value={i}>{n || `model ${i}`}</option>
              ))}
            </select>
          </label>
        )}
        <label className="ctrl">
          <span>Textures</span>
          <select
            value={useEmbedded ? "embedded" : nsbtx ? refKey(nsbtx) : ""}
            onChange={(e) => {
              if (e.target.value === "embedded") { setUseEmbedded(true); setNsbtx(null); }
              else {
                const it = nsbtxItems.find((i) => refKey(i.ref) === e.target.value);
                if (it) { setUseEmbedded(false); setNsbtx(it.ref); }
              }
            }}
          >
            {info?.hasEmbeddedTextures && <option value="embedded">Embedded</option>}
            {nsbtxItems.map((i) => (
              <option key={refKey(i.ref)} value={refKey(i.ref)}>NSBTX {i.label}</option>
            ))}
            {!info?.hasEmbeddedTextures && nsbtxItems.length === 0 && <option value="">(no textures)</option>}
          </select>
        </label>
        {nsbcaItems.length > 0 && (
          <label className="ctrl">
            <span>Animation set</span>
            <select
              value={nsbca ? refKey(nsbca) : ""}
              onChange={(e) => {
                if (e.target.value === "") setNsbca(null);
                else {
                  const it = nsbcaItems.find((i) => refKey(i.ref) === e.target.value);
                  if (it) setNsbca(it.ref);
                }
              }}
            >
              <option value="">None (static)</option>
              {nsbcaItems.map((i) => (
                <option key={refKey(i.ref)} value={refKey(i.ref)}>NSBCA {i.label}</option>
              ))}
            </select>
          </label>
        )}
        {nsbmaItems.length > 0 && (
          <label className="ctrl">
            <span>Material colour</span>
            <select value={nsbma ? refKey(nsbma) : ""} onChange={(e) => setNsbma(nsbmaItems.find((i) => refKey(i.ref) === e.target.value)?.ref ?? null)}>
              <option value="">None</option>
              {nsbmaItems.map((i) => <option key={refKey(i.ref)} value={refKey(i.ref)}>NSBMA {i.label}</option>)}
            </select>
          </label>
        )}
        {nsbvaItems.length > 0 && (
          <label className="ctrl">
            <span>Visibility</span>
            <select value={nsbva ? refKey(nsbva) : ""} onChange={(e) => setNsbva(nsbvaItems.find((i) => refKey(i.ref) === e.target.value)?.ref ?? null)}>
              <option value="">None</option>
              {nsbvaItems.map((i) => <option key={refKey(i.ref)} value={refKey(i.ref)}>NSBVA {i.label}</option>)}
            </select>
          </label>
        )}
        {nsbtpItems.length > 0 && (
          <label className="ctrl">
            <span>Texture pattern</span>
            <select value={nsbtp ? refKey(nsbtp) : ""} onChange={(e) => setNsbtp(nsbtpItems.find((i) => refKey(i.ref) === e.target.value)?.ref ?? null)}>
              <option value="">None</option>
              {nsbtpItems.map((i) => <option key={refKey(i.ref)} value={refKey(i.ref)}>NSBTP {i.label}</option>)}
            </select>
          </label>
        )}
        {animNames.length > 1 && (
          <label className="ctrl">
            <span>Clip</span>
            <select value={animIndex} onChange={(e) => setAnimIndex(+e.target.value)}>
              {animNames.map((n, i) => (
                <option key={i} value={i}>{n}</option>
              ))}
            </select>
          </label>
        )}
        {(animNames.length > 0 || nsbma || nsbva || nsbtp) && (
          <label className="ctrl">
            <span>Playback</span>
            <button className="play-btn" onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
          </label>
        )}
      </div>

      <div className="viewport" ref={mountRef}>
        {error && <div className="viewport-msg error">{error}</div>}
        {busy && !error && <div className="viewport-msg">Building 3D…</div>}
      </div>
      <div className="sprite-meta">
        <span>Drag to orbit · scroll to zoom · right-drag to pan</span>
        {loadTick > 0 && !error && (
          <>
            <button className="link-btn" onClick={capturePng}>Capture PNG ↓</button>
            <button className="link-btn" onClick={saveGltf}>Save glTF ↓</button>
          </>
        )}
      </div>
    </div>
  );
}
