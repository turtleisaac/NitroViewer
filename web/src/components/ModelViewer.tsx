import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useStore } from "../state/store";
import { refKey, type ResourceRef } from "../transport";

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

  const [info, setInfo] = useState<{ hasEmbeddedTextures: boolean; models: string[] } | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [useEmbedded, setUseEmbedded] = useState(true);
  const [nsbtx, setNsbtx] = useState<ResourceRef | null>(null);
  const [nsbca, setNsbca] = useState<ResourceRef | null>(null);
  const [animNames, setAnimNames] = useState<string[]>([]);
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

  // Initialise the three.js scene once. Render ON DEMAND (interaction / resize / load / anim frame),
  // never a perpetual RAF loop — that starves CheerpJ's cooperative Java execution and hangs exports.
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight || 400);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / (mount.clientHeight || 400), 0.01, 1000);
    camera.position.set(0, 0, 3);
    const controls = new OrbitControls(camera, renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(1, 2, 3);
    scene.add(keyLight);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-2, -1, -2);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);

    const state: Three = {
      renderer, scene, camera, controls, root, render,
      clock: new THREE.Clock(), mixer: null, actions: [], ro: null as unknown as ResizeObserver,
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

  // Default to a static model on selection — a mispaired NSBCA looks broken, so animation is opt-in
  // via the picker (which model↔animation pairing to use is content-specific and unreliable to guess).
  useEffect(() => {
    setNsbca(null);
  }, [selKey]);

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
            t.root.add(gltf.scene);
            fitCamera(gltf.scene, t.camera, t.controls);
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

  // Drive the animation with a RAF loop ONLY while actively playing and not exporting.
  useEffect(() => {
    const t = three.current;
    if (!t || !t.mixer || !playing || busy || !info || animNames.length === 0) return;
    let raf = 0;
    t.clock.getDelta(); // reset delta so the first frame doesn't jump
    const loop = () => {
      raf = requestAnimationFrame(loop);
      t.mixer!.update(t.clock.getDelta());
      t.render();
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [playing, busy, info, animNames.length, loadTick]);

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
        {animNames.length > 0 && (
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
      <div className="sprite-meta">Drag to orbit · scroll to zoom · right-drag to pan</div>
    </div>
  );
}
