import { useEffect, useMemo, useState } from "react";
import { useStore, type ResourceItem } from "../state/store";
import { pickSibling } from "../state/pairing";
import { refKey, type DecodedImage, type ResourceRef } from "../transport";
import { base64ToBytes, download } from "../util";

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

  const items: ResourceItem[] = useMemo(() => {
    if (container >= 0) {
      const n = narcs[container];
      return n ? n.entries.map((e) => ({ ref: { container, id: e.index }, label: `#${e.index}`, format: e.format })) : [];
    }
    return romSiblings;
  }, [container, narcs, romSiblings]);

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
  useEffect(() => {
    const saved = useStore.getState().pairingOverrides[selKey] ?? {};
    let nmcr: ResourceRef | undefined;
    let ncerPeerId = selection.ref.id;
    let ncerPeerList = selfPeers;
    if (fmt === "NMAR") {
      nmcr = saved.nmcr ?? pickSibling(nmcrs, selfPeers, selection.ref.id);
      const nmcrPeers = items.filter((i) => i.format === "NMCR").slice().sort((a, b) => a.ref.id - b.ref.id);
      ncerPeerId = nmcr ? nmcr.id : selection.ref.id;
      ncerPeerList = nmcrPeers;
    }
    const ncer = saved.ncer ?? pickSibling(ncers, ncerPeerList, ncerPeerId);
    const ncerPeers = items.filter((i) => i.format === "NCER").slice().sort((a, b) => a.ref.id - b.ref.id);
    const ncgrPeerId = ncer ? ncer.id : ncerPeerId;
    const ncgr = saved.ncgr ?? pickSibling(ncgrs, ncerPeers, ncgrPeerId);
    const nclr = saved.nclr ?? pickSibling(nclrs, ncerPeers, ncgrPeerId);
    setPair({ nmcr, ncer, ncgr, nclr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, items]);

  useEffect(() => {
    setMultiCellIndex(0);
    setAnimIndex(0);
    setFrameIndex(0);
    setPlaying(false);
  }, [selKey]);

  useEffect(() => {
    if (fmt !== "NMAR" || !playing) return;
    const frames = animFrames[animIndex]?.frames ?? 0;
    if (frames <= 1) return;
    const id = setInterval(() => setFrameIndex((f) => (f + 1) % frames), 240);
    return () => clearInterval(id);
  }, [fmt, playing, animIndex, animFrames]);

  useEffect(() => {
    let alive = true;
    if (fmt === "NMCR") {
      client
        .decodeNmcrMeta(romHandle, selection.ref)
        .then((m) => alive && setMultiCellCount(m.multiCellCount))
        .catch(() => alive && setMultiCellCount(0));
    } else if (fmt === "NMAR") {
      client
        .decodeNmarMeta(romHandle, selection.ref)
        .then((m) => {
          if (!alive) return;
          setAnimFrames(m.animations);
          const firstMulti = m.animations.findIndex((a) => a.frames > 1);
          if (firstMulti > 0) {
            setAnimIndex(firstMulti);
            setFrameIndex(0);
          }
          setPlaying(firstMulti >= 0);
        })
        .catch(() => alive && setAnimFrames([]));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, fmt]);

  const depKey = JSON.stringify({
    selKey,
    fmt,
    nmcr: pair.nmcr && refKey(pair.nmcr),
    ncer: pair.ncer && refKey(pair.ncer),
    ncgr: pair.ncgr && refKey(pair.ncgr),
    nclr: pair.nclr && refKey(pair.nclr),
    transparent,
    multiCellIndex,
    animIndex,
    frameIndex,
    editVersion,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        let img: DecodedImage;
        if (fmt === "NMCR") {
          if (!pair.ncer || !pair.ncgr || !pair.nclr) throw new Error("A multi-cell needs NCER + NCGR + NCLR.");
          img = await client.decodeNmcr(romHandle, selection.ref, pair.ncer, pair.ncgr, pair.nclr, multiCellIndex, transparent);
        } else if (fmt === "NMAR") {
          if (!pair.nmcr || !pair.ncer || !pair.ncgr || !pair.nclr)
            throw new Error("An NMAR animation needs NMCR + NCER + NCGR + NCLR.");
          img = await client.decodeNmar(
            romHandle, selection.ref, pair.nmcr, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, transparent
          );
        } else {
          throw new Error("Unsupported: " + fmt);
        }
        if (alive) setImage(img);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setImage(null);
        }
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const maxFrame = animFrames[animIndex] ? animFrames[animIndex].frames - 1 : -1;

  const savePng = () => {
    if (!image) return;
    const base = (selection.name.split(/[/:]/).pop() || "image").replace(/[^\w.\-]+/g, "_");
    download(`${base}.png`, base64ToBytes(image.png.split(",")[1]), "image/png");
  };

  return (
    <div className="sprite">
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
              <button className="play-btn" onClick={() => setPlaying((p) => !p)} disabled={(animFrames[animIndex]?.frames ?? 0) <= 1}>
                {playing ? "⏸ Pause" : "▶ Play"}
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
          <button className="link-btn" onClick={savePng}>
            Save PNG ↓
          </button>
        </div>
      )}
    </div>
  );
}
