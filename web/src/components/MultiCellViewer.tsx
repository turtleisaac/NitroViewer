import { useEffect, useMemo, useState } from "react";
import { useStore, type ResourceItem } from "../state/store";
import { useChangedKey } from "../useChangedKey";
import { refKey, type DecodedImage, type ResourceRef } from "../transport";
import { Icon } from "./icons";
import { loadMultiImage, loadMultiMeta, saveMultiPng, startFrameLoop } from "./multiCellLoad";
import { canPlayFrames, maxFrameOf, pairMultiCell } from "./multiCellPair";

function RefSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ResourceItem[];
  value: ResourceRef | undefined;
  onChange: (r: ResourceRef) => void;
}) {
  return (
    <label className="ctrl">
      <span>{label}</span>
      <select
        value={value ? refKey(value) : ""}
        onChange={(e) => {
          const it = items.find((i) => refKey(i.ref) === e.target.value);
          if (it) onChange(it.ref);
        }}
      >
        {items.length === 0 ? (
          <option value="">(none in container)</option>
        ) : (
          items.map((i) => (
            <option key={refKey(i.ref)} value={refKey(i.ref)}>
              {i.label} · {i.format}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="ctrl">
      <span>{label}</span>
      <div className="stepper">
        <button disabled={value <= 0} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span>
          {value}
          {max >= 0 ? ` / ${max}` : ""}
        </span>
        <button disabled={max >= 0 && value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </label>
  );
}

/** NMCR/NMAR: multi-cell placements composed through a companion NCER/NCGR/NCLR chain (NMAR adds an
 *  NMCR level on top). Structurally the same "pick siblings, allow manual override" flow as SpriteViewer's
 *  NCER/NANR handling, just one indirection deeper. */
export function MultiCellViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const narcs = useStore((s) => s.narcs);
  const romSiblings = useStore((s) => s.romSiblings);
  const setPairingOverride = useStore((s) => s.setPairingOverride);
  const editVersion = useStore((s) => s.editVersion);

  const fmt = selection.format; // "NMCR" | "NMAR"
  const container = selection.ref.container;
  const selKey = refKey(selection.ref);

  const items: ResourceItem[] = useMemo(
    () => siblingItems(container, narcs, romSiblings),
    [container, narcs, romSiblings]
  );

  const nclrs = useMemo(() => items.filter((i) => i.format === "NCLR"), [items]);
  const ncgrs = useMemo(() => items.filter((i) => i.format === "NCGR"), [items]);
  const ncers = useMemo(() => items.filter((i) => i.format === "NCER"), [items]);
  const nmcrs = useMemo(() => items.filter((i) => i.format === "NMCR"), [items]);

  const [pair, setPair] = useState<{ nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef }>({});
  const [transparent, setTransparent] = useState(true);
  const [zoom, setZoom] = useState(2);
  const [multiCellIndex, setMultiCellIndex] = useState(0);
  const [multiCellCount, setMultiCellCount] = useState(0);
  const [animIndex, setAnimIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [animFrames, setAnimFrames] = useState<{ name: string; frames: number }[]>([]);
  const [playing, setPlaying] = useState(false);

  const [image, setImage] = useState<DecodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selfPeers = useMemo(
    () => items.filter((i) => i.format === fmt).slice().sort((a, b) => a.ref.id - b.ref.id),
    [items, fmt]
  );

  // Cascading auto-pair: NMAR -> NMCR -> NCER -> NCGR/NCLR, each hop reusing the same proportional
  // sibling heuristic SpriteViewer uses for NCER/NANR. Honours any manual override the user already made.
  const itemsKey = items.map((i) => `${i.ref.container}:${i.ref.id}:${i.format}`).join("|");
  if (useChangedKey(`${selKey}:${itemsKey}`)) {
    const saved = useStore.getState().pairingOverrides[selKey] ?? {};
    setPair(pairMultiCell(fmt, selection.ref.id, items, { nmcrs, ncers, ncgrs, nclrs }, selfPeers, saved));
  }

  if (useChangedKey(selKey)) {
    setMultiCellIndex(0);
    setAnimIndex(0);
    setFrameIndex(0);
    setPlaying(false);
  }

  useEffect(() => {
    if (fmt !== "NMAR" || !playing) return;
    return startFrameLoop(animFrames[animIndex]?.frames ?? 0, setFrameIndex);
  }, [fmt, playing, animIndex, animFrames]);

  useEffect(() => {
    return loadMultiMeta(
      fmt, romHandle, selection.ref, client,
      setMultiCellCount, setAnimFrames, setAnimIndex, setFrameIndex, setPlaying
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, fmt]);

  const depKey = JSON.stringify({
    selKey,
    fmt,
    ...pairKeys(pair),
    transparent,
    multiCellIndex,
    animIndex,
    frameIndex,
    editVersion,
  });

  useEffect(() => {
    return loadMultiImage(
      fmt, romHandle, selection.ref, pair, multiCellIndex, animIndex, frameIndex, transparent,
      client, setBusy, setError, setImage
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const maxFrame = maxFrameOf(animFrames, animIndex);

  return (
    <div className="sprite">
      <MultiCellControls
        fmt={fmt}
        nmcrs={nmcrs}
        ncers={ncers}
        ncgrs={ncgrs}
        nclrs={nclrs}
        pair={pair}
        setPair={setPair}
        setPairingOverride={setPairingOverride}
        selKey={selKey}
        multiCellIndex={multiCellIndex}
        multiCellCount={multiCellCount}
        setMultiCellIndex={setMultiCellIndex}
        animIndex={animIndex}
        animFrames={animFrames}
        setAnimIndex={setAnimIndex}
        frameIndex={frameIndex}
        maxFrame={maxFrame}
        setFrameIndex={setFrameIndex}
        playing={playing}
        setPlaying={setPlaying}
        transparent={transparent}
        setTransparent={setTransparent}
        zoom={zoom}
        setZoom={setZoom}
      />
      <MultiCellStage
        error={error}
        image={image}
        busy={busy}
        zoom={zoom}
        name={selection.name}
      />
    </div>
  );
}

/** Files shown in the sibling dropdowns. A NARC lists its entries; a ROM lists the open folder. */
function siblingItems(
  container: number,
  narcs: Record<number, { entries: { index: number; format: string }[] } | undefined>,
  romSiblings: ResourceItem[]
): ResourceItem[] {
  if (container < 0) return romSiblings;
  const n = narcs[container];
  if (!n) return [];
  return n.entries.map((e) => ({ ref: { container, id: e.index }, label: `#${e.index}`, format: e.format }));
}

/** Stable keys for the four paired files, used to re-decode when a pairing changes. */
function pairKeys(pair: { nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef }) {
  return {
    nmcr: pair.nmcr && refKey(pair.nmcr),
    ncer: pair.ncer && refKey(pair.ncer),
    ncgr: pair.ncgr && refKey(pair.ncgr),
    nclr: pair.nclr && refKey(pair.nclr),
  };
}

function MultiCellControls(props: {
  fmt: string;
  nmcrs: ResourceItem[];
  ncers: ResourceItem[];
  ncgrs: ResourceItem[];
  nclrs: ResourceItem[];
  pair: { nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef };
  setPair: (fn: (p: { nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef }) => { nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef }) => void;
  setPairingOverride: (key: string, patch: { nmcr?: ResourceRef; ncer?: ResourceRef; ncgr?: ResourceRef; nclr?: ResourceRef }) => void;
  selKey: string;
  multiCellIndex: number;
  multiCellCount: number;
  setMultiCellIndex: (n: number) => void;
  animIndex: number;
  animFrames: { name: string; frames: number }[];
  setAnimIndex: (n: number) => void;
  frameIndex: number;
  maxFrame: number;
  setFrameIndex: (n: number) => void;
  playing: boolean;
  setPlaying: (fn: (p: boolean) => boolean) => void;
  transparent: boolean;
  setTransparent: (v: boolean) => void;
  zoom: number;
  setZoom: (z: number) => void;
}) {
  const {
    fmt, nmcrs, ncers, ncgrs, nclrs, pair, setPair, setPairingOverride, selKey,
    multiCellIndex, multiCellCount, setMultiCellIndex, animIndex, animFrames, setAnimIndex,
    frameIndex, maxFrame, setFrameIndex, playing, setPlaying, transparent, setTransparent, zoom, setZoom,
  } = props;
  return (
      <div className="controls">
        {fmt === "NMAR" && (
          <RefSelect
            label="Multi-cell (NMCR)"
            items={nmcrs}
            value={pair.nmcr}
            onChange={(r) => { setPair((p) => ({ ...p, nmcr: r })); setPairingOverride(selKey, { nmcr: r }); }}
          />
        )}
        <RefSelect label="Cells (NCER)" items={ncers} value={pair.ncer} onChange={(r) => { setPair((p) => ({ ...p, ncer: r })); setPairingOverride(selKey, { ncer: r }); }} />
        <RefSelect label="Tileset (NCGR)" items={ncgrs} value={pair.ncgr} onChange={(r) => { setPair((p) => ({ ...p, ncgr: r })); setPairingOverride(selKey, { ncgr: r }); }} />
        <RefSelect label="Palette (NCLR)" items={nclrs} value={pair.nclr} onChange={(r) => { setPair((p) => ({ ...p, nclr: r })); setPairingOverride(selKey, { nclr: r }); }} />

        {fmt === "NMCR" && <Stepper label="Multi-cell" value={multiCellIndex} max={multiCellCount - 1} onChange={setMultiCellIndex} />}
        {fmt === "NMAR" && (
          <>
            <Stepper label="Animation" value={animIndex} max={animFrames.length - 1} onChange={(n) => { setAnimIndex(n); setFrameIndex(0); }} />
            <Stepper label="Frame" value={frameIndex} max={maxFrame} onChange={setFrameIndex} />
            <label className="ctrl">
              <span>Playback</span>
              <button className="play-btn" onClick={() => setPlaying((p) => !p)} disabled={!canPlayFrames(animFrames[animIndex]?.frames)}>
                {playing ? <><Icon name="pause" /> Pause</> : <><Icon name="play" /> Play</>}
              </button>
            </label>
          </>
        )}

        <label className="ctrl ctrl--inline">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          <span>Transparency</span>
        </label>
        <label className="ctrl">
          <span>Zoom</span>
          <select value={zoom} onChange={(e) => setZoom(+e.target.value)}>
            {[1, 2, 3, 4, 6, 8].map((z) => (
              <option key={z} value={z}>{z}×</option>
            ))}
          </select>
        </label>
      </div>
  );
}

function MultiCellStage(props: {
  error: string | null;
  image: DecodedImage | null;
  busy: boolean;
  zoom: number;
  name: string;
}) {
  const { error, image, busy, zoom, name } = props;
  return (
    <>
      <div className="canvas-wrap">
        {error ? (
          <div className="error">{error}</div>
        ) : image ? (
          <img className="sprite-img" src={image.png} width={image.width * zoom} height={image.height * zoom} alt="" />
        ) : (
          <div className="placeholder">{busy ? "Decoding…" : "…"}</div>
        )}
      </div>
      {image && !error && (
        <div className="sprite-meta">
          <span>
            {image.width}×{image.height}px{busy ? " · decoding…" : ""}
          </span>
          <button className="link-btn" onClick={() => saveMultiPng(name, image)}>
            Save PNG
          </button>
        </div>
      )}
    </>
  );
}
