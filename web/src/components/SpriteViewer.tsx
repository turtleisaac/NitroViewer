import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { useStore, type ResourceItem } from "../state/store";
import { resolveNarcInfo } from "../state/grouping";
import { refKey, type DecodedImage, type ResourceRef } from "../transport";
import { base64ToBytes, download } from "../util";
import { SpriteEditor } from "./SpriteEditor";
import { PlayPauseLabel } from "./playPauseLabel";
import { fileStem, useApplyOnChange } from "./viewerShared";
import {
  readyTitle,
  finishPending,
  hideSpriteCanvas,
  importDisabled,
  importTitle,
  itemsKeyOf,
  maxFrameOf,
  nanrBlock,
  nanrPlaying,
  ncgrBlock,
  nextSpritePair,
  pairBlock,
  peersOf,
  pendingText,
  requireNanr,
  requireNclr,
  requireTiles,
  roleSuffix,
  runSpriteImport,
  showImporter,
  showSpriteEditor,
  spriteDepKey,
  spriteResources,
  spriteViewSeed,
  tilesFromPx,
  tilesPx,
  type PendingImport,
  type SpritePair,
} from "./spriteViewerLogic";

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


type SetNum = Dispatch<SetStateAction<number>>;

/** Game code and narc path from the store without subscribing. */
function readGameDb(container: number) {
  const st = useStore.getState();
  const narcPath = st.narcPathOf(container);
  const gameCode = st.romInfo?.gameCode;
  return { narcPath, gameCode, info: resolveNarcInfo(gameCode, narcPath) };
}

/** Saved pairing for this resource, or an empty override. */
function savedPair(key: string): SpritePair {
  return useStore.getState().pairingOverrides[key] ?? {};
}

/** Start the NANR timer, or do nothing when the clip cannot move. */
function beginNanrPlayback(fmt: string, playing: boolean, animFrames: number[], animIndex: number, setFrameIndex: SetNum): () => void {
  if (!nanrPlaying(fmt, playing, animFrames, animIndex)) return () => undefined;
  const frames = animFrames[animIndex] ?? 0;
  const id = setInterval(() => setFrameIndex((frame) => (frame + 1) % frames), 240);
  return () => clearInterval(id);
}

/** Store a cell count when the request is still current. */
function takeCellCount(alive: boolean, count: number, setCellCount: SetNum): void {
  if (!alive) return;
  setCellCount(count);
}

/** Store NANR clip lengths and auto-play the first clip that moves. */
export function applyNanrMeta(
  alive: boolean,
  meta: { animations: { frames: number }[] },
  setAnimFrames: (frames: number[]) => void,
  setAnimIndex: SetNum,
  setFrameIndex: SetNum,
  setPlaying: (playing: boolean) => void,
): void {
  if (!alive) return;
  const frames = meta.animations.map((anim) => anim.frames);
  setAnimFrames(frames);
  const firstMulti = frames.findIndex((count) => count > 1);
  if (firstMulti > 0) {
    setAnimIndex(firstMulti);
    setFrameIndex(0);
  }
  setPlaying(firstMulti >= 0);
}

/** Load NCER or NANR counts for the steppers. */
function loadSpriteMeta(
  fmt: string,
  alive: () => boolean,
  client: {
    decodeNcerMeta: (handle: number, ref: ResourceRef) => Promise<{ cellCount: number }>;
    decodeNanrMeta: (handle: number, ref: ResourceRef) => Promise<{ animations: { frames: number }[] }>;
  },
  romHandle: number,
  ref: ResourceRef,
  setCellCount: SetNum,
  setAnimFrames: (frames: number[]) => void,
  setAnimIndex: SetNum,
  setFrameIndex: SetNum,
  setPlaying: (playing: boolean) => void,
): void {
  if (fmt === "NCER") {
    client.decodeNcerMeta(romHandle, ref)
      .then((meta) => takeCellCount(alive(), meta.cellCount, setCellCount))
      .catch(() => takeCellCount(alive(), 0, setCellCount));
    return;
  }
  if (fmt === "NANR") {
    client.decodeNanrMeta(romHandle, ref)
      .then((meta) => applyNanrMeta(alive(), meta, setAnimFrames, setAnimIndex, setFrameIndex, setPlaying))
      .catch(() => { if (alive()) setAnimFrames([]); });
  }
}

/** Decode whichever format is selected. */
export function loadSelectionImage(args: {
  fmt: string;
  pair: SpritePair;
  client: {
    decodeNcgr: (handle: number, ref: ResourceRef, nclr: ResourceRef, tilesWidth: number, transparent: boolean, paletteIndex: number, scanFrontToBack: boolean) => Promise<DecodedImage>;
    decodeNscr: (handle: number, ref: ResourceRef, ncgr: ResourceRef, nclr: ResourceRef, transparent: boolean) => Promise<DecodedImage>;
    decodeNcer: (handle: number, ref: ResourceRef, ncgr: ResourceRef, nclr: ResourceRef, cellIndex: number, transparent: boolean) => Promise<DecodedImage>;
    decodeNanr: (handle: number, ref: ResourceRef, ncer: ResourceRef, ncgr: ResourceRef, nclr: ResourceRef, animIndex: number, frameIndex: number, transparent: boolean) => Promise<DecodedImage>;
  };
  romHandle: number;
  ref: ResourceRef;
  tilesWidth: number;
  transparent: boolean;
  paletteIndex: number;
  scanFrontToBack: boolean;
  cellIndex: number;
  animIndex: number;
  frameIndex: number;
}): Promise<DecodedImage> {
  if (args.fmt === "NCGR") {
    return args.client.decodeNcgr(args.romHandle, args.ref, requireNclr(args.pair.nclr), args.tilesWidth, args.transparent, args.paletteIndex, args.scanFrontToBack);
  }
  if (args.fmt === "NSCR") {
    const need = requireTiles(args.pair.ncgr, args.pair.nclr, "A screen needs an NCGR tileset and an NCLR palette.");
    return args.client.decodeNscr(args.romHandle, args.ref, need.ncgr, need.nclr, args.transparent);
  }
  if (args.fmt === "NCER") {
    const need = requireTiles(args.pair.ncgr, args.pair.nclr, "Cells need an NCGR tileset and an NCLR palette.");
    return args.client.decodeNcer(args.romHandle, args.ref, need.ncgr, need.nclr, args.cellIndex, args.transparent);
  }
  if (args.fmt === "NANR") {
    const need = requireNanr(args.pair.ncer, args.pair.ncgr, args.pair.nclr);
    return args.client.decodeNanr(args.romHandle, args.ref, need.ncer, need.ncgr, need.nclr, args.animIndex, args.frameIndex, args.transparent);
  }
  throw new Error("Unsupported: " + args.fmt);
}

/** Decode the current selection into the canvas state. */
export async function decodeInto(
  alive: () => boolean,
  decode: () => Promise<DecodedImage>,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  setImage: (image: DecodedImage | null) => void,
  setSubPalettes: SetNum,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    const image = await decode();
    if (!alive()) return;
    setImage(image);
    setSubPalettes(image.subPalettes ?? 1);
  } catch (err) {
    if (!alive()) return;
    setError((err as Error).message);
    setImage(null);
  } finally {
    if (alive()) setBusy(false);
  }
}

/** Route a chosen image to the importer for this format. */
export function acceptSpriteFile(
  event: ChangeEvent<HTMLInputElement>,
  fmt: string,
  handlers: { screen: (file: File) => void; cell: (file: File) => void; nanr: (file: File) => void; ncgr: (file: File) => void },
): void {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (fmt === "NSCR") handlers.screen(file);
  else if (fmt === "NCER") handlers.cell(file);
  else if (fmt === "NANR") handlers.nanr(file);
  else handlers.ncgr(file);
}

/** Ignore a stepper change. Used while the editor is open. */
function ignoreChange(): void {
  return undefined;
}

/** Bytes attached to a pending import, or an empty buffer when there is none. */
export function pendingBytes(pending: PendingImport | null): Uint8Array {
  return pending?.bytes ?? new Uint8Array();
}

/** Download the decoded PNG. */
export function saveSpritePng(image: DecodedImage | null, name: string): void {
  if (!image) return;
  download(`${fileStem(name, "image")}.png`, base64ToBytes(image.png.split(",")[1] ?? ""), "image/png");
}

/** Remember a manual pairing choice. */
function changePair(key: "ncgr" | "nclr" | "ncer", ref: ResourceRef, setPair: Dispatch<SetStateAction<SpritePair>>, setOverride: (key: string, partial: SpritePair) => void, selKey: string, editing: boolean): void {
  if (key === "nclr" && editing) return;
  setPair((pair) => ({ ...pair, [key]: ref }));
  setOverride(selKey, { [key]: ref });
}

function GameDbBadge({ info }: { info: { title: string; role?: string } | null }) {
  if (!info) return null;
  return (
    <div className="gamedb-badge" title="Grouping and render hints came from the game DB, not a heuristic">
      Game DB · {info.title}
      {roleSuffix(info.role)}
    </div>
  );
}

/** A sibling picker that hides itself when `show` is false. */
function OptionalRef({ show, label, items, value, onChange }: { show: boolean; label: string; items: ResourceItem[]; value: ResourceRef | undefined; onChange: (ref: ResourceRef) => void }) {
  if (!show) return null;
  return <RefSelect label={label} items={items} value={value} onChange={onChange} />;
}

function NcgrGeometry(props: {
  fmt: string;
  tilesWidth: number;
  editing: boolean;
  paletteIndex: number;
  subPalettes: number;
  setTilesWidth: SetNum;
  setPaletteIndex: SetNum;
}) {
  if (props.fmt !== "NCGR") return null;
  return (
    <>
      <label className="ctrl">
        <span>Width (px)</span>
        <input
          type="number"
          min={0}
          step={8}
          placeholder="auto"
          disabled={props.editing}
          title="Sprite width in pixels (multiples of 8). Leave 0 for auto."
          value={tilesPx(props.tilesWidth)}
          onChange={(event) => props.setTilesWidth(tilesFromPx(event.target.value))}
        />
      </label>
      <Stepper label="Palette" value={props.paletteIndex} max={props.subPalettes - 1} onChange={props.editing ? ignoreChange : props.setPaletteIndex} />
    </>
  );
}

function NanrControls(props: {
  fmt: string;
  animIndex: number;
  frameIndex: number;
  animFrames: number[];
  playing: boolean;
  setAnimIndex: SetNum;
  setFrameIndex: SetNum;
  setPlaying: Dispatch<SetStateAction<boolean>>;
}) {
  if (props.fmt !== "NANR") return null;
  return (
    <>
      <Stepper label="Animation" value={props.animIndex} max={props.animFrames.length - 1} onChange={(n) => { props.setAnimIndex(n); props.setFrameIndex(0); }} />
      <Stepper label="Frame" value={props.frameIndex} max={maxFrameOf(props.animFrames, props.animIndex)} onChange={props.setFrameIndex} />
      <label className="ctrl">
        <span>Playback</span>
        <button className="play-btn" onClick={() => props.setPlaying((value) => !value)} disabled={(props.animFrames[props.animIndex] ?? 0) <= 1}>
          <PlayPauseLabel playing={props.playing} />
        </button>
      </label>
    </>
  );
}

function ImportPngControl(props: {
  fmt: string;
  editing: boolean;
  impBusy: boolean;
  pair: SpritePair;
  onClick: () => void;
}) {
  if (!showImporter(props.fmt)) return null;
  return (
    <label className="ctrl">
      <span>Edit</span>
      <button className="play-btn" disabled={importDisabled(props.fmt, props.editing, props.impBusy, props.pair)} title={importTitle(props.fmt, props.pair)} onClick={props.onClick}>
        {props.impBusy ? "…" : "Import PNG…"}
      </button>
    </label>
  );
}

function PendingChoice(props: { pending: PendingImport | null; impBusy: boolean; onMatch: () => void; onRebuild: () => void; onCancel: () => void }) {
  if (!props.pending) return null;
  return (
    <div className="import-choice">
      <span>
        {props.pending.unmatched.toLocaleString()}
        {pendingText(props.pending)}
      </span>
      <button className="btn btn--sm" disabled={props.impBusy} onClick={props.onMatch}>Match to palette</button>
      <button className="btn btn--sm" disabled={props.impBusy} onClick={props.onRebuild}>Rebuild palette</button>
      <button className="link-btn" disabled={props.impBusy} onClick={props.onCancel}>Cancel</button>
    </div>
  );
}

function SpriteCanvas({ error, image, zoom, busy }: { error: string | null; image: DecodedImage | null; zoom: number; busy: boolean }) {
  if (error) return <div className="error">{error}</div>;
  if (image) return <img className="sprite-img" src={image.png} width={image.width * zoom} height={image.height * zoom} alt="" />;
  return <div className="placeholder">{busy ? "Decoding…" : "…"}</div>;
}

function ScannedNote({ image, fmt }: { image: DecodedImage | null; fmt: string }) {
  if (!image?.scanned || (fmt !== "NCER" && fmt !== "NANR")) return null;
  return (
    <div className="import-choice">
      <span>
        This tileset is a scanned (bitmap) NCGR — its pixels are the full sprite, so it&apos;s shown
        directly (cells/frames can&apos;t be composed over a bitmap).
      </span>
    </div>
  );
}

function SpriteMeta({ image, error, busy, onSave }: { image: DecodedImage | null; error: string | null; busy: boolean; onSave: () => void }) {
  if (!image || error) return null;
  return (
    <div className="sprite-meta">
      <span>{image.width}×{image.height}px{busy ? " · decoding…" : ""}</span>
      <button className="link-btn" onClick={onSave}>Save PNG</button>
    </div>
  );
}

/** State and handlers for `SpriteViewer`. */
function useSpriteSession() {
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
  const editVersion = useStore((s) => s.editVersion);
  const fmt = selection.format;
  const container = selection.ref.container;
  const selKey = refKey(selection.ref);
  // narcs is the signal that the container's path can resolve; the callback reads the store directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gdb = useMemo(() => readGameDb(container), [container, narcs]);
  const items = useMemo(() => spriteResources(container, narcs, romSiblings), [container, narcs, romSiblings]);
  const nclrs = useMemo(() => peersOf(items, "NCLR"), [items]);
  const ncgrs = useMemo(() => peersOf(items, "NCGR"), [items]);
  const ncers = useMemo(() => peersOf(items, "NCER"), [items]);
  const selfPeers = useMemo(() => peersOf(items, fmt), [items, fmt]);
  const [pair, setPair] = useState<SpritePair>({});
  const [transparent, setTransparent] = useState(true);
  const [tilesWidth, setTilesWidth] = useState(0);
  const [scanFrontToBack, setScanFrontToBack] = useState(true);
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
  const [impBusy, setImpBusy] = useState(false);
  const [dedupFlips, setDedupFlips] = useState(true);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [editing, setEditing] = useState(false);

  useApplyOnChange(`${selKey}:${itemsKeyOf(items)}`, () => {
    setPair(nextSpritePair({
      items,
      saved: savedPair(selKey),
      gameCode: gdb.gameCode,
      narcPath: gdb.narcPath,
      container,
      id: selection.ref.id,
      peers: selfPeers,
      ncgrs,
      nclrs,
      ncers,
    }));
  });

  useApplyOnChange(selKey, () => {
    const seed = spriteViewSeed(gdb.gameCode, gdb.narcPath, selection.ref.id);
    setCellIndex(0);
    setAnimIndex(0);
    setFrameIndex(0);
    setPaletteIndex(seed.paletteIndex);
    setSubPalettes(1);
    setTilesWidth(seed.tilesWidth);
    setTransparent(seed.transparent);
    setScanFrontToBack(seed.scanFrontToBack);
    setPlaying(false);
    setEditing(false);
  });

  useEffect(() => beginNanrPlayback(fmt, playing, animFrames, animIndex, setFrameIndex), [fmt, playing, animIndex, animFrames]);
  useEffect(() => {
    let alive = true;
    loadSpriteMeta(fmt, () => alive, client, romHandle, selection.ref, setCellCount, setAnimFrames, setAnimIndex, setFrameIndex, setPlaying);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, fmt]);

  const depKey = spriteDepKey({ selKey, fmt, pair, transparent, tilesWidth, scanFrontToBack, paletteIndex, cellIndex, animIndex, frameIndex, editVersion });
  useEffect(() => {
    let alive = true;
    void decodeInto(() => alive, () => loadSelectionImage({
      fmt, pair, client, romHandle, ref: selection.ref, tilesWidth, transparent, paletteIndex, scanFrontToBack, cellIndex, animIndex, frameIndex,
    }), setBusy, setError, setImage, setSubPalettes);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const onPng = (file: File) => {
    void runSpriteImport(file, {
      blocked: ncgrBlock(pair.nclr),
      requiresOk: false,
      kind: "ncgr",
      failPrefix: "PNG import failed: ",
      dry: (bytes) => importPng(selection.ref, requireNclr(pair.nclr), paletteIndex, tilesWidth, false, true, scanFrontToBack, bytes),
      apply: (bytes) => importPng(selection.ref, requireNclr(pair.nclr), paletteIndex, tilesWidth, false, false, scanFrontToBack, bytes),
    }, setImpBusy, setPending);
  };
  const onScreen = (file: File) => {
    void runSpriteImport(file, {
      blocked: pairBlock(pair.ncgr, pair.nclr, "A screen import needs both a tileset (NCGR) and a palette (NCLR) — pick them first."),
      requiresOk: true,
      kind: "screen",
      failPrefix: "Background import failed: ",
      dry: (bytes) => importScreenPng(selection.ref, requireTiles(pair.ncgr, pair.nclr, "missing").ncgr, requireTiles(pair.ncgr, pair.nclr, "missing").nclr, dedupFlips, false, true, bytes),
      apply: (bytes) => importScreenPng(selection.ref, requireTiles(pair.ncgr, pair.nclr, "missing").ncgr, requireTiles(pair.ncgr, pair.nclr, "missing").nclr, dedupFlips, false, false, bytes),
    }, setImpBusy, setPending);
  };

  const onCell = (file: File) => {
    void runSpriteImport(file, {
      blocked: pairBlock(pair.ncgr, pair.nclr, "A cell import needs a tileset (NCGR) and a palette (NCLR) — pick them first."),
      requiresOk: true,
      kind: "cell",
      failPrefix: "Cell import failed: ",
      dry: (bytes) => {
        const need = requireTiles(pair.ncgr, pair.nclr, "missing");
        return importCellPng(selection.ref, need.ncgr, need.nclr, cellIndex, false, true, bytes);
      },
      apply: (bytes) => {
        const need = requireTiles(pair.ncgr, pair.nclr, "missing");
        return importCellPng(selection.ref, need.ncgr, need.nclr, cellIndex, false, false, bytes);
      },
    }, setImpBusy, setPending);
  };
  const onNanr = (file: File) => {
    void runSpriteImport(file, {
      blocked: nanrBlock(pair.ncer, pair.ncgr, pair.nclr),
      requiresOk: true,
      kind: "nanr",
      failPrefix: "Animation cell import failed: ",
      dry: (bytes) => {
        const need = requireNanr(pair.ncer, pair.ncgr, pair.nclr);
        return importNanrPng(selection.ref, need.ncer, need.ncgr, need.nclr, animIndex, frameIndex, false, true, bytes);
      },
      apply: (bytes) => {
        const need = requireNanr(pair.ncer, pair.ncgr, pair.nclr);
        return importNanrPng(selection.ref, need.ncer, need.ncgr, need.nclr, animIndex, frameIndex, false, false, bytes);
      },
    }, setImpBusy, setPending);
  };
  const finish = (rebuild: boolean) => {
    const bytes = pendingBytes(pending);
    void finishPending(pending, pair, {
      screen: () => {
        const need = requireTiles(pair.ncgr, pair.nclr, "missing");
        return importScreenPng(selection.ref, need.ncgr, need.nclr, dedupFlips, rebuild, false, bytes);
      },
      cell: () => {
        const need = requireTiles(pair.ncgr, pair.nclr, "missing");
        return importCellPng(selection.ref, need.ncgr, need.nclr, cellIndex, rebuild, false, bytes);
      },
      nanr: () => {
        const need = requireNanr(pair.ncer, pair.ncgr, pair.nclr);
        return importNanrPng(selection.ref, need.ncer, need.ncgr, need.nclr, animIndex, frameIndex, rebuild, false, bytes);
      },
      ncgr: () => importPng(selection.ref, requireNclr(pair.nclr), paletteIndex, tilesWidth, rebuild, false, scanFrontToBack, bytes),
    }, setImpBusy, setPending);
  };

  return {
    fmt, gdb, ncgrs, nclrs, ncers, pair, setPair, setPairingOverride, selKey, editing, tilesWidth, setTilesWidth,
    paletteIndex, setPaletteIndex, subPalettes, cellIndex, setCellIndex, cellCount, animIndex, setAnimIndex,
    frameIndex, setFrameIndex, animFrames, playing, setPlaying, transparent, setTransparent, zoom, setZoom,
    dedupFlips, setDedupFlips, impBusy, pending, setPending, image, error, busy, selection, onPng, onScreen,
    onCell, onNanr, finish, scanFrontToBack, setEditing,
  };
}

/** Open the hidden PNG input. */
function openPngPicker(input: { current: HTMLInputElement | null }): void {
  input.current?.click();
}

export function SpriteViewer() {
  const pngRef = useRef<HTMLInputElement>(null);
  const vm = useSpriteSession();
  return (
    <div className="sprite">
      <GameDbBadge info={vm.gdb.info} />
      <div className="controls">
        <OptionalRef show={vm.fmt !== "NCGR"} label="Tileset (NCGR)" items={vm.ncgrs} value={vm.pair.ncgr} onChange={(ref) => changePair("ncgr", ref, vm.setPair, vm.setPairingOverride, vm.selKey, vm.editing)} />
        <OptionalRef show={vm.fmt === "NANR"} label="Cells (NCER)" items={vm.ncers} value={vm.pair.ncer} onChange={(ref) => changePair("ncer", ref, vm.setPair, vm.setPairingOverride, vm.selKey, vm.editing)} />
        <RefSelect label="Palette (NCLR)" items={vm.nclrs} value={vm.pair.nclr} onChange={(ref) => changePair("nclr", ref, vm.setPair, vm.setPairingOverride, vm.selKey, vm.editing)} />
        <NcgrGeometry fmt={vm.fmt} tilesWidth={vm.tilesWidth} editing={vm.editing} paletteIndex={vm.paletteIndex} subPalettes={vm.subPalettes} setTilesWidth={vm.setTilesWidth} setPaletteIndex={vm.setPaletteIndex} />
        {vm.fmt === "NCER" && <Stepper label="Cell" value={vm.cellIndex} max={vm.cellCount - 1} onChange={vm.setCellIndex} />}
        <NanrControls fmt={vm.fmt} animIndex={vm.animIndex} frameIndex={vm.frameIndex} animFrames={vm.animFrames} playing={vm.playing} setAnimIndex={vm.setAnimIndex} setFrameIndex={vm.setFrameIndex} setPlaying={vm.setPlaying} />
        <label className="ctrl ctrl--inline">
          <input type="checkbox" checked={vm.transparent} onChange={(event) => vm.setTransparent(event.target.checked)} />
          <span>Transparency</span>
        </label>
        <label className="ctrl">
          <span>Zoom</span>
          <select value={vm.zoom} onChange={(event) => vm.setZoom(+event.target.value)}>
            {[1, 2, 3, 4, 6, 8].map((z) => <option key={z} value={z}>{z}×</option>)}
          </select>
        </label>
        {vm.fmt === "NSCR" && (
          <label className="ctrl ctrl--inline">
            <input type="checkbox" checked={vm.dedupFlips} onChange={(event) => vm.setDedupFlips(event.target.checked)} />
            <span>Share flipped tiles</span>
          </label>
        )}
        {vm.fmt === "NCGR" && (
          <label className="ctrl">
            <span>Sprite</span>
            <button className="play-btn" disabled={vm.editing || !vm.pair.nclr} title={readyTitle(!!vm.pair.nclr, "Open the built-in pixel editor", "Pick a palette first")} onClick={() => vm.setEditing(true)}>
              Edit sprite…
            </button>
          </label>
        )}
        <ImportPngControl
          fmt={vm.fmt}
          editing={vm.editing}
          impBusy={vm.impBusy}
          pair={vm.pair}
          onClick={() => openPngPicker(pngRef)}
        />
        <input
          ref={pngRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => acceptSpriteFile(event, vm.fmt, { screen: vm.onScreen, cell: vm.onCell, nanr: vm.onNanr, ncgr: vm.onPng })}
        />
      </div>
      {showSpriteEditor(vm.fmt, vm.editing, vm.pair.nclr) && vm.pair.nclr ? (
        <SpriteEditor ncgr={vm.selection.ref} nclr={vm.pair.nclr} tilesWidth={vm.tilesWidth} paletteIndex={vm.paletteIndex} scanFrontToBack={vm.scanFrontToBack} transparent={vm.transparent} initialZoom={vm.zoom} onClose={() => vm.setEditing(false)} />
      ) : null}
      <PendingChoice pending={vm.pending} impBusy={vm.impBusy} onMatch={() => vm.finish(false)} onRebuild={() => vm.finish(true)} onCancel={() => vm.setPending(null)} />
      {!hideSpriteCanvas(vm.fmt, vm.editing) && (
        <>
          <div className="canvas-wrap">
            <SpriteCanvas error={vm.error} image={vm.image} zoom={vm.zoom} busy={vm.busy} />
          </div>
          <ScannedNote image={vm.image} fmt={vm.fmt} />
          <SpriteMeta image={vm.image} error={vm.error} busy={vm.busy} onSave={() => saveSpritePng(vm.image, vm.selection.name)} />
        </>
      )}
    </div>
  );
}
