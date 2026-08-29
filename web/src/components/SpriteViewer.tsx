import { useEffect, useMemo, useState } from "react";
import { useStore, type ResourceItem } from "../state/store";
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

function Stepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
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

export function SpriteViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const narcs = useStore((s) => s.narcs);
  const romSiblings = useStore((s) => s.romSiblings);

  const fmt = selection.format;
  const container = selection.ref.container;
  const selKey = refKey(selection.ref);

  const items: ResourceItem[] = useMemo(() => {
    if (container >= 0) {
      const n = narcs[container];
      return n
        ? n.entries.map((e) => ({ ref: { container, id: e.index }, label: `#${e.index}`, format: e.format }))
        : [];
    }
    return romSiblings;
  }, [container, narcs, romSiblings]);

  const nclrs = useMemo(() => items.filter((i) => i.format === "NCLR"), [items]);
  const ncgrs = useMemo(() => items.filter((i) => i.format === "NCGR"), [items]);
  const ncers = useMemo(() => items.filter((i) => i.format === "NCER"), [items]);

  const [pair, setPair] = useState<{ ncgr?: ResourceRef; nclr?: ResourceRef; ncer?: ResourceRef }>({});
  const [transparent, setTransparent] = useState(true);
  const [tilesWidth, setTilesWidth] = useState(0);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [cellIndex, setCellIndex] = useState(0);
  const [cellCount, setCellCount] = useState(0);
  const [animIndex, setAnimIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [animFrames, setAnimFrames] = useState<number[]>([]);
  const [zoom, setZoom] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [subPalettes, setSubPalettes] = useState(1);

  const [image, setImage] = useState<DecodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // All resources of the selected file's own format, ordered by container index.
  const selfPeers = useMemo(
    () => items.filter((i) => i.format === fmt).slice().sort((a, b) => a.ref.id - b.ref.id),
    [items, fmt]
  );

  // Pick the best sibling of a given type to pair with the selection:
  //  - if the sibling list is parallel to the self list (e.g. sprite[k] ↔ palette[k]), match by
  //    ordinal position; otherwise fall back to the nearest by container index.
  const pickSibling = (cands: ResourceItem[]): ResourceRef | undefined => {
    if (cands.length === 0) return undefined;
    const sorted = cands.slice().sort((a, b) => a.ref.id - b.ref.id);
    const ord = selfPeers.findIndex((i) => i.ref.id === selection.ref.id);
    if (sorted.length === selfPeers.length && ord >= 0) return sorted[ord].ref;
    return sorted.reduce((best, c) =>
      Math.abs(c.ref.id - selection.ref.id) < Math.abs(best.ref.id - selection.ref.id) ? c : best
    ).ref;
  };

  // Auto-pair when the selection (or its container's contents) changes.
  useEffect(() => {
    setPair({ ncgr: pickSibling(ncgrs), nclr: pickSibling(nclrs), ncer: pickSibling(ncers) });
    setCellIndex(0);
    setAnimIndex(0);
    setFrameIndex(0);
    setPaletteIndex(0);
    setSubPalettes(1);
    setTilesWidth(0);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, items]);

  // NANR playback: advance the frame on a timer while playing.
  useEffect(() => {
    if (fmt !== "NANR" || !playing) return;
    const frames = animFrames[animIndex] ?? 0;
    if (frames <= 1) return;
    const id = setInterval(() => setFrameIndex((f) => (f + 1) % frames), 120);
    return () => clearInterval(id);
  }, [fmt, playing, animIndex, animFrames]);

  // Metadata (counts) for the stepper controls.
  useEffect(() => {
    let alive = true;
    if (fmt === "NCER") {
      client
        .decodeNcerMeta(romHandle, selection.ref)
        .then((m) => alive && setCellCount(m.cellCount))
        .catch(() => alive && setCellCount(0));
    } else if (fmt === "NANR") {
      client
        .decodeNanrMeta(romHandle, selection.ref)
        .then((m) => alive && setAnimFrames(m.animations.map((a) => a.frames)))
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
    ncgr: pair.ncgr && refKey(pair.ncgr),
    nclr: pair.nclr && refKey(pair.nclr),
    ncer: pair.ncer && refKey(pair.ncer),
    transparent,
    tilesWidth,
    paletteIndex,
    cellIndex,
    animIndex,
    frameIndex,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        let img: DecodedImage;
        if (fmt === "NCGR") {
          if (!pair.nclr) throw new Error("No palette (NCLR) in this container — pick one to color the tiles.");
          img = await client.decodeNcgr(romHandle, selection.ref, pair.nclr, tilesWidth, transparent, paletteIndex);
        } else if (fmt === "NSCR") {
          if (!pair.ncgr || !pair.nclr) throw new Error("A screen needs an NCGR tileset and an NCLR palette.");
          img = await client.decodeNscr(romHandle, selection.ref, pair.ncgr, pair.nclr, transparent);
        } else if (fmt === "NCER") {
          if (!pair.ncgr || !pair.nclr) throw new Error("Cells need an NCGR tileset and an NCLR palette.");
          img = await client.decodeNcer(romHandle, selection.ref, pair.ncgr, pair.nclr, cellIndex, transparent);
        } else if (fmt === "NANR") {
          if (!pair.ncer || !pair.ncgr || !pair.nclr)
            throw new Error("An animation needs NCER + NCGR + NCLR.");
          img = await client.decodeNanr(
            romHandle, selection.ref, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, transparent
          );
        } else {
          throw new Error("Unsupported: " + fmt);
        }
        if (alive) {
          setImage(img);
          setSubPalettes(img.subPalettes ?? 1);
        }
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

  const maxFrame = animFrames[animIndex] != null ? animFrames[animIndex] - 1 : -1;

  const savePng = () => {
    if (!image) return;
    const base = (selection.name.split(/[/:]/).pop() || "image").replace(/[^\w.\-]+/g, "_");
    download(`${base}.png`, base64ToBytes(image.png.split(",")[1]), "image/png");
  };

  return (
    <div className="sprite">
      <div className="controls">
        {fmt !== "NCGR" && <RefSelect label="Tileset (NCGR)" items={ncgrs} value={pair.ncgr} onChange={(r) => setPair((p) => ({ ...p, ncgr: r }))} />}
        {fmt === "NANR" && <RefSelect label="Cells (NCER)" items={ncers} value={pair.ncer} onChange={(r) => setPair((p) => ({ ...p, ncer: r }))} />}
        <RefSelect label="Palette (NCLR)" items={nclrs} value={pair.nclr} onChange={(r) => setPair((p) => ({ ...p, nclr: r }))} />

        {fmt === "NCGR" && (
          <>
            <label className="ctrl">
              <span>Tile width</span>
              <input type="number" min={0} value={tilesWidth} onChange={(e) => setTilesWidth(Math.max(0, +e.target.value | 0))} />
            </label>
            <Stepper label="Palette" value={paletteIndex} max={subPalettes - 1} onChange={setPaletteIndex} />
          </>
        )}
        {fmt === "NCER" && <Stepper label="Cell" value={cellIndex} max={cellCount - 1} onChange={setCellIndex} />}
        {fmt === "NANR" && (
          <>
            <Stepper label="Animation" value={animIndex} max={animFrames.length - 1} onChange={(n) => { setAnimIndex(n); setFrameIndex(0); }} />
            <Stepper label="Frame" value={frameIndex} max={maxFrame} onChange={setFrameIndex} />
            <label className="ctrl">
              <span>Playback</span>
              <button
                className="play-btn"
                onClick={() => setPlaying((p) => !p)}
                disabled={(animFrames[animIndex] ?? 0) <= 1}
              >
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
          <img
            className="sprite-img"
            src={image.png}
            width={image.width * zoom}
            height={image.height * zoom}
            alt=""
          />
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
