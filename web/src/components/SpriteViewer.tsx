import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type ResourceItem } from "../state/store";
import { pickSibling } from "../state/pairing";
import { resolveNarcInfo, resolveRenderHints, resolveSpriteUnit } from "../state/grouping";
import { refKey, type DecodedImage, type ResourceRef } from "../transport";
import { base64ToBytes, download } from "../util";
import { SpriteEditor } from "./SpriteEditor";

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
  const setPairingOverride = useStore((s) => s.setPairingOverride);
  const importPng = useStore((s) => s.importPng);
  const importScreenPng = useStore((s) => s.importScreenPng);
  const importCellPng = useStore((s) => s.importCellPng);
  const importNanrPng = useStore((s) => s.importNanrPng);
  const editVersion = useStore((s) => s.editVersion); // bumped on import → triggers an in-place re-decode

  const fmt = selection.format;
  const container = selection.ref.container;
  const selKey = refKey(selection.ref);

  // Game-DB (§8) resolution for this NARC: a badge + render hints, manifest-first. `narcs` is a dep so
  // the path resolves once the container's NARC is open.
  const gdb = useMemo(() => {
    const st = useStore.getState();
    const narcPath = st.narcPathOf(container);
    const gameCode = st.romInfo?.gameCode;
    return {
      narcPath,
      gameCode,
      info: resolveNarcInfo(gameCode, narcPath),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, narcs]);

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
  const [scanFrontToBack, setScanFrontToBack] = useState(true); // scanned-NCGR direction (D/P = false)
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

  // PNG-import state (NCGR sprite or NSCR background): a pending match-vs-rebuild choice when the image
  // doesn't fit the current palette. `kind` routes the apply to the sprite vs. tilemap importer.
  const pngRef = useRef<HTMLInputElement>(null);
  const [impBusy, setImpBusy] = useState(false);
  const [dedupFlips, setDedupFlips] = useState(true);
  const [pending, setPending] = useState<
    { bytes: Uint8Array; unmatched: number; w: number; h: number; kind: "ncgr" | "screen" | "cell" | "nanr" } | null
  >(null);
  const [editing, setEditing] = useState(false);

  // All resources of the selected file's own format, ordered by container index.
  const selfPeers = useMemo(
    () => items.filter((i) => i.format === fmt).slice().sort((a, b) => a.ref.id - b.ref.id),
    [items, fmt]
  );

  // Auto-pair when the selection (or its container's contents) changes — but honour any manual
  // pairing the user previously chose for this resource (read without subscribing to avoid re-runs).
  useEffect(() => {
    const pick = (cands: ResourceItem[]) => pickSibling(cands, selfPeers, selection.ref.id);
    const saved = useStore.getState().pairingOverrides[selKey] ?? {};
    // Manifest-first (§8): a declared grouping resolves the exact sibling unit; else the heuristic.
    const entryLikes = items.map((i) => ({ index: i.ref.id, format: i.format }));
    const unit = resolveSpriteUnit(gdb.gameCode, gdb.narcPath, container, entryLikes, selection.ref.id);
    setPair({
      ncgr: saved.ncgr ?? unit?.ncgr ?? pick(ncgrs),
      nclr: saved.nclr ?? unit?.nclr ?? pick(nclrs),
      ncer: saved.ncer ?? unit?.ncer ?? pick(ncers),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, items]);

  // Reset the view controls only when a DIFFERENT file is selected — not when the current file's bytes
  // are edited in place (an import bumps editVersion but keeps selKey), so the tile width / palette /
  // zoom the user dialed in survive the edit.
  useEffect(() => {
    // Seed the view controls from the game-DB render hints when the NARC is listed (manifest-first),
    // else the neutral defaults. tileWidth is declared in pixels; the control works in 8px tiles.
    const st = useStore.getState();
    const hints = resolveRenderHints(st.romInfo?.gameCode, st.narcPathOf(container), selection.ref.id);
    setCellIndex(0);
    setAnimIndex(0);
    setFrameIndex(0);
    setPaletteIndex(hints?.paletteIndex ?? 0);
    setSubPalettes(1);
    setTilesWidth(hints?.tileWidth ? Math.max(1, Math.round(hints.tileWidth / 8)) : 0);
    setTransparent(hints?.transparent ?? true);
    setScanFrontToBack(hints?.scanDirection !== "back-to-front"); // D/P battle sprites scan back-to-front
    setPlaying(false);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // NANR playback: advance the frame on a timer while playing.
  useEffect(() => {
    if (fmt !== "NANR" || !playing) return;
    const frames = animFrames[animIndex] ?? 0;
    if (frames <= 1) return;
    const id = setInterval(() => setFrameIndex((f) => (f + 1) % frames), 240);
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
        .then((m) => {
          if (!alive) return;
          const frames = m.animations.map((a) => a.frames);
          setAnimFrames(frames);
          // Clip 0 is often a single static frame; jump to the first animation that actually moves
          // (>1 frame) and auto-play it, so a NANR looks alive on open instead of frozen.
          const firstMulti = frames.findIndex((f) => f > 1);
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
    ncgr: pair.ncgr && refKey(pair.ncgr),
    nclr: pair.nclr && refKey(pair.nclr),
    ncer: pair.ncer && refKey(pair.ncer),
    transparent,
    tilesWidth,
    scanFrontToBack,
    paletteIndex,
    cellIndex,
    animIndex,
    frameIndex,
    editVersion, // re-decode after an in-place import (bytes changed, no remount)
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
          img = await client.decodeNcgr(romHandle, selection.ref, pair.nclr, tilesWidth, transparent, paletteIndex, scanFrontToBack);
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

  // Import an image over this NCGR. Dry-run first: if every pixel fits the current palette, apply the
  // match immediately; otherwise surface the match-vs-rebuild choice with the unmatched-pixel count.
  const onPngChosen = async (file: File) => {
    if (!pair.nclr) {
      alert("Pick a palette (NCLR) first — the import needs one to match colors against.");
      return;
    }
    setImpBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dry = await importPng(selection.ref, pair.nclr, paletteIndex, tilesWidth, false, true, bytes);
      if (dry.unmatched === 0) {
        await importPng(selection.ref, pair.nclr, paletteIndex, tilesWidth, false, false, bytes);
      } else {
        setPending({ bytes, unmatched: dry.unmatched, w: dry.width, h: dry.height, kind: "ncgr" });
      }
    } catch (e) {
      alert("PNG import failed: " + (e as Error).message);
    } finally {
      setImpBusy(false);
    }
  };

  // Import a background image over this NSCR — decomposes it into the paired NCGR tileset + this tilemap
  // (and the NCLR when rebuilding). Dry-run first: if every color fits, apply the match; else prompt.
  const onScreenPngChosen = async (file: File) => {
    if (!pair.ncgr || !pair.nclr) {
      alert("A screen import needs both a tileset (NCGR) and a palette (NCLR) — pick them first.");
      return;
    }
    setImpBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dry = await importScreenPng(selection.ref, pair.ncgr, pair.nclr, dedupFlips, false, true, bytes);
      if (!dry.ok) throw new Error("import failed");
      if (dry.unmatched === 0) {
        await importScreenPng(selection.ref, pair.ncgr, pair.nclr, dedupFlips, false, false, bytes);
      } else {
        setPending({ bytes, unmatched: dry.unmatched, w: 0, h: 0, kind: "screen" });
      }
    } catch (e) {
      alert("Background import failed: " + (e as Error).message);
    } finally {
      setImpBusy(false);
    }
  };

  // Import an image over the composed NCER cell → decomposes into the NCGR tiles. Dry-run to match first;
  // if it fits, apply, else prompt match-vs-rebuild (rebuild synthesises a new NCLR from the image).
  const onCellPngChosen = async (file: File) => {
    if (!pair.ncgr || !pair.nclr) {
      alert("A cell import needs a tileset (NCGR) and a palette (NCLR) — pick them first.");
      return;
    }
    setImpBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dry = await importCellPng(selection.ref, pair.ncgr, pair.nclr, cellIndex, false, true, bytes);
      if (!dry.ok) throw new Error("import failed");
      if (dry.unmatched === 0) await importCellPng(selection.ref, pair.ncgr, pair.nclr, cellIndex, false, false, bytes);
      else setPending({ bytes, unmatched: dry.unmatched, w: 0, h: 0, kind: "cell" });
    } catch (e) {
      alert("Cell import failed: " + (e as Error).message);
    } finally {
      setImpBusy(false);
    }
  };

  // Import an image over the NANR frame's underlying cell (edits the animation's artwork).
  const onNanrPngChosen = async (file: File) => {
    if (!pair.ncer || !pair.ncgr || !pair.nclr) {
      alert("An animation import needs NCER + NCGR + NCLR — pick them first.");
      return;
    }
    setImpBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dry = await importNanrPng(selection.ref, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, false, true, bytes);
      if (!dry.ok) throw new Error("import failed");
      if (dry.unmatched === 0) await importNanrPng(selection.ref, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, false, false, bytes);
      else setPending({ bytes, unmatched: dry.unmatched, w: 0, h: 0, kind: "nanr" });
    } catch (e) {
      alert("Animation cell import failed: " + (e as Error).message);
    } finally {
      setImpBusy(false);
    }
  };

  const applyPending = async (rebuild: boolean) => {
    if (!pending) return;
    setImpBusy(true);
    try {
      if (pending.kind === "screen") {
        if (!pair.ncgr || !pair.nclr) return;
        await importScreenPng(selection.ref, pair.ncgr, pair.nclr, dedupFlips, rebuild, false, pending.bytes);
      } else if (pending.kind === "cell") {
        if (!pair.ncgr || !pair.nclr) return;
        await importCellPng(selection.ref, pair.ncgr, pair.nclr, cellIndex, rebuild, false, pending.bytes);
      } else if (pending.kind === "nanr") {
        if (!pair.ncer || !pair.ncgr || !pair.nclr) return;
        await importNanrPng(selection.ref, pair.ncer, pair.ncgr, pair.nclr, animIndex, frameIndex, rebuild, false, pending.bytes);
      } else {
        if (!pair.nclr) return;
        await importPng(selection.ref, pair.nclr, paletteIndex, tilesWidth, rebuild, false, pending.bytes);
      }
      setPending(null); // (the viewer also remounts on editVersion bump)
    } catch (e) {
      alert("Import failed: " + (e as Error).message);
    } finally {
      setImpBusy(false);
    }
  };

  return (
    <div className="sprite">
      {gdb.info && (
        <div className="gamedb-badge" title="Grouping and render hints came from the game DB, not a heuristic">
          <span className="gamedb-dot">◆</span> Game DB · {gdb.info.title}
          {gdb.info.role ? ` · ${gdb.info.role.replace(/-/g, " ")}` : ""}
        </div>
      )}
      <div className="controls">
        {fmt !== "NCGR" && <RefSelect label="Tileset (NCGR)" items={ncgrs} value={pair.ncgr} onChange={(r) => { setPair((p) => ({ ...p, ncgr: r })); setPairingOverride(selKey, { ncgr: r }); }} />}
        {fmt === "NANR" && <RefSelect label="Cells (NCER)" items={ncers} value={pair.ncer} onChange={(r) => { setPair((p) => ({ ...p, ncer: r })); setPairingOverride(selKey, { ncer: r }); }} />}
        <RefSelect label="Palette (NCLR)" items={nclrs} value={pair.nclr} onChange={(r) => { if (editing) return; setPair((p) => ({ ...p, nclr: r })); setPairingOverride(selKey, { nclr: r }); }} />

        {fmt === "NCGR" && (
          <>
            <label className="ctrl">
              <span>Width (px)</span>
              {/* Users think in pixels; the NCGR geometry is in 8px tiles, so accept pixels (step 8) and
                  convert. 0 = auto (read the width from the NCGR header). */}
              <input
                type="number"
                min={0}
                step={8}
                placeholder="auto"
                disabled={editing}
                title="Sprite width in pixels (multiples of 8). Leave 0 for auto."
                value={tilesWidth ? tilesWidth * 8 : 0}
                onChange={(e) => setTilesWidth(Math.max(0, Math.round((+e.target.value | 0) / 8)))}
              />
            </label>
            <Stepper label="Palette" value={paletteIndex} max={subPalettes - 1} onChange={editing ? () => undefined : setPaletteIndex} />
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

        {fmt === "NSCR" && (
          <label className="ctrl ctrl--inline">
            <input type="checkbox" checked={dedupFlips} onChange={(e) => setDedupFlips(e.target.checked)} />
            <span>Share flipped tiles</span>
          </label>
        )}

        {fmt === "NCGR" && (
          <label className="ctrl">
            <span>Sprite</span>
            <button
              className="play-btn"
              disabled={editing || !pair.nclr}
              title={pair.nclr ? "Open the built-in pixel editor" : "Pick a palette first"}
              onClick={() => setEditing(true)}
            >
              Edit sprite…
            </button>
          </label>
        )}

        {(fmt === "NCGR" || fmt === "NSCR" || fmt === "NCER" || fmt === "NANR") && (
          <label className="ctrl">
            <span>Edit</span>
            <button
              className="play-btn"
              disabled={
                editing ||
                impBusy ||
                (fmt === "NCGR" ? !pair.nclr : fmt === "NANR" ? !pair.ncer || !pair.ncgr || !pair.nclr : !pair.ncgr || !pair.nclr)
              }
              title={
                fmt === "NCGR"
                  ? pair.nclr ? "Replace this sprite's pixels from an image file" : "Pick a palette first"
                  : fmt === "NSCR"
                    ? pair.ncgr && pair.nclr ? "Import a background image into this tilemap (rebuilds the tileset)" : "Pick a tileset + palette first"
                    : fmt === "NCER"
                      ? pair.ncgr && pair.nclr ? "Replace this cell's pixels (writes back to the NCGR)" : "Pick a tileset + palette first"
                      : pair.ncer && pair.ncgr && pair.nclr ? "Replace the current frame's cell artwork (writes back to the NCGR)" : "Pick NCER + NCGR + NCLR first"
              }
              onClick={() => pngRef.current?.click()}
            >
              {impBusy ? "…" : "Import PNG…"}
            </button>
            <input
              ref={pngRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (fmt === "NSCR") void onScreenPngChosen(f);
                else if (fmt === "NCER") void onCellPngChosen(f);
                else if (fmt === "NANR") void onNanrPngChosen(f);
                else void onPngChosen(f);
              }}
            />
          </label>
        )}
      </div>

      {fmt === "NCGR" && editing && pair.nclr ? (
        <SpriteEditor
          ncgr={selection.ref}
          nclr={pair.nclr}
          tilesWidth={tilesWidth}
          paletteIndex={paletteIndex}
          scanFrontToBack={scanFrontToBack}
          transparent={transparent}
          initialZoom={zoom}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {pending && (
        <div className="import-choice">
          <span>
            {pending.unmatched.toLocaleString()}
            {pending.kind === "ncgr"
              ? ` of ${(pending.w * pending.h).toLocaleString()} pixels don't match the current palette.`
              : " pixels don't match the current palette."}
          </span>
          <button className="btn btn--sm" disabled={impBusy} onClick={() => void applyPending(false)}>
            Match to palette
          </button>
          <button className="btn btn--sm" disabled={impBusy} onClick={() => void applyPending(true)}>
            Rebuild palette
          </button>
          <button className="link-btn" disabled={impBusy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}

      {!(fmt === "NCGR" && editing) && (
        <>
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
          {image?.scanned && (fmt === "NCER" || fmt === "NANR") && (
            <div className="import-choice">
              <span>
                This tileset is a scanned (bitmap) NCGR — its pixels are the full sprite, so it's shown
                directly (cells/frames can't be composed over a bitmap).
              </span>
            </div>
          )}
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
        </>
      )}
    </div>
  );
}
