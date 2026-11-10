import { refKey, type ResourceRef } from "../transport";
import type { ResourceItem } from "../state/store";
import {
  applyTextureChoice,
  findRef,
  modelOptionLabel,
  nsbcaLabel,
  showPlayback,
  textureValue,
} from "./modelViewerLogic";
import { PlayPauseLabel } from "./playPauseLabel";

/** Error or progress text drawn over the model viewport. */
export function ViewportStatus({ error, busy }: { error: string | null; busy: boolean }) {
  if (error) return <div className="viewport-msg error">{error}</div>;
  if (busy) return <div className="viewport-msg">Building 3D…</div>;
  return null;
}

/** Capture, glTF download, and OBJ import actions. */
export function ModelExportButtons({
  importing,
  onCapture,
  onSave,
  onImport,
}: {
  importing: boolean;
  onCapture: () => void;
  onSave: () => void;
  onImport: () => void;
}) {
  return (
    <>
      <button className="link-btn" onClick={onCapture}>Capture PNG</button>
      <button className="link-btn" onClick={onSave}>Save glTF</button>
      <button
        className="link-btn"
        disabled={importing}
        title="Replace this model with a Wavefront OBJ (select the .obj, and optionally a texture image)"
        onClick={onImport}
      >
        {importing ? "Importing…" : "Import OBJ"}
      </button>
    </>
  );
}

/** True after a model has loaded and the viewport is not showing an error. */
export function showModelExports(loadTick: number, error: string | null): boolean {
  if (loadTick <= 0) return false;
  return !error;
}

export function ModelToolbar(props: {
  info: { hasEmbeddedTextures: boolean; models: string[] } | null;
  modelIndex: number;
  setModelIndex: (index: number) => void;
  useEmbedded: boolean;
  nsbtx: ResourceRef | null;
  nsbtxItems: ResourceItem[];
  setUseEmbedded: (embedded: boolean) => void;
  setNsbtx: (ref: ResourceRef | null) => void;
  nsbca: ResourceRef | null;
  nsbcaItems: ResourceItem[];
  nsbcaNames: Record<string, string[]>;
  setNsbca: (ref: ResourceRef | null) => void;
  nsbma: ResourceRef | null;
  nsbmaItems: ResourceItem[];
  setNsbma: (ref: ResourceRef | null) => void;
  nsbva: ResourceRef | null;
  nsbvaItems: ResourceItem[];
  setNsbva: (ref: ResourceRef | null) => void;
  nsbtp: ResourceRef | null;
  nsbtpItems: ResourceItem[];
  setNsbtp: (ref: ResourceRef | null) => void;
  animNames: string[];
  animIndex: number;
  setAnimIndex: (index: number) => void;
  playing: boolean;
  setPlaying: (fn: (playing: boolean) => boolean) => void;
  showGrid: boolean;
  setShowGrid: (fn: (grid: boolean) => boolean) => void;
  onFit: () => void;
}) {
  const {
    info, modelIndex, setModelIndex, useEmbedded, nsbtx, nsbtxItems, setUseEmbedded, setNsbtx,
    nsbca, nsbcaItems, nsbcaNames, setNsbca, nsbma, nsbmaItems, setNsbma, nsbva, nsbvaItems, setNsbva,
    nsbtp, nsbtpItems, setNsbtp, animNames, animIndex, setAnimIndex, playing, setPlaying, showGrid, setShowGrid, onFit,
  } = props;
  return (
    <div className="controls">
      {info && info.models.length > 1 && (
        <label className="ctrl">
          <span>Model</span>
          <select value={modelIndex} onChange={(e) => setModelIndex(+e.target.value)}>
            {info.models.map((name, i) => (
              <option key={i} value={i}>{modelOptionLabel(name, i)}</option>
            ))}
          </select>
        </label>
      )}
      <TextureSelect
        info={info}
        useEmbedded={useEmbedded}
        nsbtx={nsbtx}
        items={nsbtxItems}
        setUseEmbedded={setUseEmbedded}
        setNsbtx={setNsbtx}
      />
      {nsbcaItems.length > 0 && (
        <AnimSetSelect nsbca={nsbca} items={nsbcaItems} names={nsbcaNames} setNsbca={setNsbca} />
      )}
      {nsbmaItems.length > 0 && (
        <TrackSelect label="Material color" prefix="NSBMA" value={nsbma} items={nsbmaItems} onChange={setNsbma} />
      )}
      {nsbvaItems.length > 0 && (
        <TrackSelect label="Visibility" prefix="NSBVA" value={nsbva} items={nsbvaItems} onChange={setNsbva} />
      )}
      {nsbtpItems.length > 0 && (
        <TrackSelect label="Texture pattern" prefix="NSBTP" value={nsbtp} items={nsbtpItems} onChange={setNsbtp} />
      )}
      <ClipControls
        animNames={animNames}
        animIndex={animIndex}
        setAnimIndex={setAnimIndex}
        nsbma={nsbma}
        nsbva={nsbva}
        nsbtp={nsbtp}
        playing={playing}
        setPlaying={setPlaying}
      />
      <label className="ctrl">
        <span>View</span>
        <span className="view-btns">
          <button
            className={"chip" + (showGrid ? " chip--on" : "")}
            title="Toggle the ground grid"
            onClick={() => setShowGrid((g) => !g)}
          >
            Grid
          </button>
          <button className="chip" title="Re-centre the camera on the model" onClick={onFit}>
            Reset view
          </button>
        </span>
      </label>
    </div>
  );
}

function ClipControls(props: {
  animNames: string[];
  animIndex: number;
  setAnimIndex: (index: number) => void;
  nsbma: ResourceRef | null;
  nsbva: ResourceRef | null;
  nsbtp: ResourceRef | null;
  playing: boolean;
  setPlaying: (fn: (playing: boolean) => boolean) => void;
}) {
  const { animNames, animIndex, setAnimIndex, nsbma, nsbva, nsbtp, playing, setPlaying } = props;
  return (
    <>
      {animNames.length > 1 && (
        <label className="ctrl">
          <span>Clip</span>
          <select value={animIndex} onChange={(e) => setAnimIndex(+e.target.value)}>
            {animNames.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
        </label>
      )}
      {showPlayback(animNames, nsbma, nsbva, nsbtp) && (
        <label className="ctrl">
          <span>Playback</span>
          <button className="play-btn" onClick={() => setPlaying((p) => !p)}>
            <PlayPauseLabel playing={playing} />
          </button>
        </label>
      )}
    </>
  );
}

function TextureSelect(props: {
  info: { hasEmbeddedTextures: boolean } | null;
  useEmbedded: boolean;
  nsbtx: ResourceRef | null;
  items: ResourceItem[];
  setUseEmbedded: (embedded: boolean) => void;
  setNsbtx: (ref: ResourceRef | null) => void;
}) {
  const { info, useEmbedded, nsbtx, items, setUseEmbedded, setNsbtx } = props;
  const none = !info?.hasEmbeddedTextures && items.length === 0;
  return (
    <label className="ctrl">
      <span>Textures</span>
      <select value={textureValue(useEmbedded, nsbtx)} onChange={(e) => applyTextureChoice(e.target.value, items, setUseEmbedded, setNsbtx)}>
        {info?.hasEmbeddedTextures && <option value="embedded">Embedded</option>}
        {items.map((item) => (
          <option key={refKey(item.ref)} value={refKey(item.ref)}>NSBTX {item.label}</option>
        ))}
        {none && <option value="">(no textures)</option>}
      </select>
    </label>
  );
}

function AnimSetSelect(props: {
  nsbca: ResourceRef | null;
  items: ResourceItem[];
  names: Record<string, string[]>;
  setNsbca: (ref: ResourceRef | null) => void;
}) {
  const { nsbca, items, names, setNsbca } = props;
  return (
    <label className="ctrl">
      <span>Animation set</span>
      <select
        value={nsbca ? refKey(nsbca) : ""}
        onChange={(e) => setNsbca(e.target.value === "" ? null : findRef(items, e.target.value))}
      >
        <option value="">None (static)</option>
        {items.map((item) => (
          <option key={refKey(item.ref)} value={refKey(item.ref)}>{nsbcaLabel(item, names)}</option>
        ))}
      </select>
    </label>
  );
}

function TrackSelect(props: {
  label: string;
  prefix: string;
  value: ResourceRef | null;
  items: ResourceItem[];
  onChange: (ref: ResourceRef | null) => void;
}) {
  const { label, prefix, value, items, onChange } = props;
  return (
    <label className="ctrl">
      <span>{label}</span>
      <select value={value ? refKey(value) : ""} onChange={(e) => onChange(findRef(items, e.target.value))}>
        <option value="">None</option>
        {items.map((item) => (
          <option key={refKey(item.ref)} value={refKey(item.ref)}>{prefix} {item.label}</option>
        ))}
      </select>
    </label>
  );
}

