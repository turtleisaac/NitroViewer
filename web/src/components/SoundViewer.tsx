import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type PropsWithChildren } from "react";
import { useStore } from "../state/store";
import { useApplyOnChange } from "./viewerShared";
import {
  activeTracksAt,
  drawNoteTrack,
  noteTrackHeight,
  tickFromCanvasX,
  NOTE_GUTTER,
  NOTE_LANE_HEIGHT,
} from "../sound/noteTrack";
import type {
  SdatInfo,
  SdatNamed,
  SequenceNotes,
  StreamPreview,
  WaveInfo,
  WavePreview,
} from "../transport";
import { Icon } from "./icons";
import { type EngineHandle } from "../sound/engine/host";
import { LiveEngineSlot } from "../sound/engine/liveEngineSlot";
import {
  bankExtra,
  canPlaySequence,
  computeTrackMask,
  ensureSequenceWav,
  errorMessage,
  estimateTiming,
  exportBank,
  exportSequenceMidi,
  exportSequenceWav,
  exportStreamPreview,
  exportWaveFile,
  goLive,
  importWaveFile,
  isDemandingSequence,
  loadArchive,
  loadSequence,
  loadSoundDocument,
  loadStream,
  loadWave,
  statusPlaceholder,
  playbackClock,
  playSequence,
  playPreview,
  previewBytes,
  rollTime,
  sdatOpening,
  sdatTabLabel,
  seekWave,
  sequenceTitle,
  seqLoop,
  showSequencePane,
  showStreamPane,
  showWavePane,
  soundIsPlaying,
  stopLiveEngine,
  toggleTrack,
  trackAudible,
  visibleSequences,
  waveCountExtra,
  waveList,
  type LoopPts,
  type SeqWav,
  type SoundCtx,
  type SoundTab,
} from "./soundViewerLogic";

export function wavToBuffer(ctx: AudioContext, wav: Uint8Array): AudioBuffer {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const channels = dv.getUint16(22, true);
  const rate = dv.getUint32(24, true);
  let p = 12;
  let dataOff = 44;
  let dataLen = wav.byteLength - 44;
  while (p + 8 <= wav.byteLength) {
    const id = String.fromCharCode(wav[p], wav[p + 1], wav[p + 2], wav[p + 3]);
    const size = dv.getUint32(p + 4, true);
    if (id === "data") {
      dataOff = p + 8;
      dataLen = size;
      break;
    }
    p += 8 + size + (size & 1);
  }
  const frames = Math.floor(dataLen / (2 * Math.max(1, channels)));
  const buf = ctx.createBuffer(channels, frames, rate);
  const dataDv = new DataView(wav.buffer, wav.byteOffset + dataOff, Math.min(dataLen, wav.byteLength - dataOff));
  for (let c = 0; c < channels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) ch[i] = dataDv.getInt16((i * channels + c) * 2, true) / 32768;
  }
  return buf;
}

/** Position in an AudioBufferSource that started at 0 and loops [start, end). */
function sourceTime(elapsed: number, loop: LoopPts | null): number {
  if (!loop || elapsed < loop.end) return elapsed;
  const span = loop.end - loop.start;
  if (span <= 0) return elapsed;
  return loop.start + ((elapsed - loop.end) % span);
}

/** Keep the screen awake while `active` (playback in progress); re-acquires after backgrounding. */
function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        /* denied, unsupported, or page hidden right now — playback still works without it */
      }
    };
    void acquire();

    // The OS releases the lock when the tab/screen backgrounds; reacquire once it's foregrounded again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !lockRef.current) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [active]);
}

function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const bufRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0);
  const loopRef = useRef<LoopPts | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const ctx = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
    }
    return ctxRef.current;
  };

  const stopSource = () => {
    const src = srcRef.current;
    srcRef.current = null;
    if (src) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        /* already stopped */
      }
    }
  };

  const stop = () => {
    stopSource();
    loopRef.current = null;
    bufRef.current = null;
    setPlaying(false);
    setCurrentTime(0);
  };

  const startAt = (offset: number) => {
    const c = ctx();
    const buf = bufRef.current;
    if (!buf) return;
    void c.resume();
    stopSource();
    const dur = buf.duration;
    const loop = loopRef.current;
    let o = Math.max(0, Math.min(offset, Math.max(0, dur - 1 / buf.sampleRate)));
    if (loop && o >= loop.end) o = loop.start + ((o - loop.start) % (loop.end - loop.start));
    const src = c.createBufferSource();
    src.buffer = buf;
    if (loop) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    src.connect(c.destination);
    src.onended = () => {
      if (srcRef.current !== src) return;
      srcRef.current = null;
      setPlaying(false);
    };
    startedAtRef.current = c.currentTime - o;
    srcRef.current = src;
    src.start(0, o);
    setPlaying(true);
    setCurrentTime(o);
  };

  const play = (wav: Uint8Array, loop?: LoopPts | null, offset = 0) => {
    const c = ctx();
    void c.resume();
    const buf = wavToBuffer(c, wav);
    bufRef.current = buf;
    const period = loop && loop.end - loop.start > 1 / buf.sampleRate ? loop : null;
    if (period) {
      const end = Math.min(period.end, buf.duration);
      const start = Math.max(0, Math.min(period.start, end - 1 / buf.sampleRate));
      loopRef.current = end > start + 1 / buf.sampleRate ? { start, end } : null;
    } else loopRef.current = null;
    startAt(offset);
  };

  const seek = (time: number, wav?: Uint8Array, loop?: LoopPts | null) => {
    const t = Math.max(0, time);
    setCurrentTime(t);
    if (bufRef.current) startAt(t);
    else if (wav) play(wav, loop, t);
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = ctxRef.current;
      const src = srcRef.current;
      if (c && src) setCurrentTime(sourceTime(c.currentTime - startedAtRef.current, loopRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWakeLock(playing);

  return { play, seek, stop, playing, currentTime, ctx };
}

function playheadTick(
  timeSec: number,
  notes: SequenceNotes,
  loop: LoopPts | null,
  wavSeconds: number
): number {
  if (timeSec <= 0) return 0;
  if (loop && notes.loopEnd > notes.loopStart && notes.loopStart >= 0 && loop.end > loop.start) {
    // Audio is intro+body, then a second body used as the seamless cycle (loop.start = first 0x94).
    if (loop.start > 0 && timeSec < loop.start) return (timeSec / loop.start) * notes.loopEnd;
    const u = (timeSec - loop.start) / (loop.end - loop.start);
    return notes.loopStart + u * (notes.loopEnd - notes.loopStart);
  }
  const dur = wavSeconds > 0 ? wavSeconds : timeSec;
  return dur > 0 ? (timeSec / dur) * notes.ticks : 0;
}

function tickToTime(tick: number, notes: SequenceNotes, loop: LoopPts | null, wavSeconds: number): number {
  const T = Math.max(0, tick);
  if (loop && notes.loopEnd > notes.loopStart && notes.loopStart >= 0 && loop.end > loop.start) {
    if (T <= notes.loopStart) return notes.loopEnd > 0 ? (T / notes.loopEnd) * loop.start : 0;
    const spanT = notes.loopEnd - notes.loopStart;
    const u = spanT > 0 ? (T - notes.loopStart) / spanT : 0;
    return Math.min(loop.start + u * (loop.end - loop.start), loop.end - 1e-4);
  }
  return notes.ticks > 0 ? (T / notes.ticks) * wavSeconds : 0;
}

function NoteRoll({
  notes,
  playTick,
  playing,
  muted,
  solo,
  onSeekTick,
  onMute,
  onSolo,
}: {
  notes: SequenceNotes;
  playTick: number;
  playing: boolean;
  muted: boolean[];
  solo: boolean[];
  onSeekTick?: (tick: number) => void;
  onMute?: (track: number) => void;
  onSolo?: (track: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [dragTick, setDragTick] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const height = noteTrackHeight(notes.trackCount);
  const head = dragTick ?? playTick;
  const live = playing || dragTick != null;
  const activeTracks = useMemo(
    () => (live ? activeTracksAt(notes.notes, notes.trackCount, head) : null),
    [notes, head, live]
  );
  const silent = useMemo(
    () => Array.from({ length: notes.trackCount }, (_, t) => !trackAudible(t, muted, solo)),
    [notes.trackCount, muted, solo]
  );
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNoteTrack(
      ctx,
      notes.notes,
      notes.ticks,
      notes.trackCount,
      head,
      width,
      notes.loopStart,
      notes.loopEnd,
      silent,
      live,
    );
  }, [notes, head, width, height, silent, live]);

  const tickAtEvent = (e: ReactPointerEvent) => {
    const c = canvasRef.current;
    if (!c) return 0;
    const r = c.getBoundingClientRect();
    return tickFromCanvasX(e.clientX - r.left, r.width, notes.ticks);
  };

  const onDown = (e: ReactPointerEvent) => {
    if (!onSeekTick) return;
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const t = tickAtEvent(e);
    setDragTick(t);
    onSeekTick(t);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current || !onSeekTick) return;
    const t = tickAtEvent(e);
    setDragTick(t);
    onSeekTick(t);
  };
  const onUp = () => {
    dragging.current = false;
    setDragTick(null);
  };

  const nTracks = Math.max(1, notes.trackCount);
  return (
    <div className="note-roll" ref={wrapRef}>
      <div className="note-gutter" style={{ width: NOTE_GUTTER }}>
        {Array.from({ length: nTracks }, (_, i) => (
          <div
            key={i}
            className={"note-lane-ctrl" + (activeTracks?.[i] ? " note-lane-ctrl--active" : "")}
            style={{ height: NOTE_LANE_HEIGHT }}
          >
            <button
              type="button"
              className={"trk-btn" + (muted[i] ? " trk-btn--mute" : "")}
              title={muted[i] ? "Unmute track" : "Mute track"}
              onClick={(e) => {
                e.stopPropagation();
                onMute?.(i);
              }}
            >
              M
            </button>
            <button
              type="button"
              className={"trk-btn" + (solo[i] ? " trk-btn--solo" : "")}
              title={solo[i] ? "Unsolo track" : "Solo / isolate track"}
              onClick={(e) => {
                e.stopPropagation();
                onSolo?.(i);
              }}
            >
              S
            </button>
            <span className="trk-num">{i}</span>
          </div>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  );
}

function WaveformScrub({
  png,
  currentTime,
  duration,
  onSeek,
}: {
  png: string;
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const timeAtEvent = (e: ReactPointerEvent) => {
    const el = wrapRef.current;
    if (!el || duration <= 0) return 0;
    const r = el.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return u * duration;
  };

  const onDown = (e: ReactPointerEvent) => {
    if (!onSeek) return;
    e.preventDefault();
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onSeek(timeAtEvent(e));
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current || !onSeek) return;
    onSeek(timeAtEvent(e));
  };
  const onUp = () => {
    dragging.current = false;
  };

  const pct = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

  return (
    <div
      className="wave-stage"
      ref={wrapRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <img className="wave-png" src={png} alt="" draggable={false} />
      <div className="playhead-line" style={{ left: `${pct}%` }} />
    </div>
  );
}

function NamedList({
  items,
  selected,
  onSelect,
  extra,
}: {
  items: (SdatNamed & { extra?: string })[];
  selected: number | null;
  onSelect: (index: number) => void;
  extra?: (it: SdatNamed) => string;
}) {
  return (
    <div className="sound-list">
      {items.map((it) => (
        <button
          key={it.index}
          className={"sound-row" + (selected === it.index ? " sound-row--on" : "")}
          onClick={() => onSelect(it.index)}
        >
          <span className="sound-idx">#{it.index}</span>
          <span className="sound-name">{it.name || "(unnamed)"}</span>
          {extra && <span className="sound-extra">{extra(it)}</span>}
        </button>
      ))}
      {items.length === 0 && <div className="placeholder">Nothing in this category.</div>}
    </div>
  );
}

/** Sample duration in seconds. */
function waveSeconds(sampleRate: number, samples: number): number {
  if (sampleRate <= 0) return 0;
  return samples / sampleRate;
}

export function WavePanel({
  waves,
  selected,
  preview,
  busy,
  currentTime,
  onSelect,
  onPlay,
  onExport,
  onImport,
  onSeek,
}: {
  waves: WaveInfo[];
  selected: number | null;
  preview: WavePreview | null;
  busy: boolean;
  currentTime: number;
  onSelect: (i: number) => void;
  onPlay: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onSeek: (time: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="sound-split">
      <div className="sound-list">
        {waves.map((w) => (
          <button
            key={w.index}
            className={"sound-row" + (selected === w.index ? " sound-row--on" : "")}
            onClick={() => onSelect(w.index)}
          >
            <span className="sound-idx">#{w.index}</span>
            <span className="sound-name">
              {w.type} · {w.sampleRate} Hz · {w.samples} samples
            </span>
            {w.loops && <span className="sound-extra">loop</span>}
          </button>
        ))}
      </div>
      <div className="sound-detail">
        {preview ? (
          <>
            <div className="controls">
              <button className="play-btn" onClick={onPlay} disabled={busy}>
                <Icon name="play" /> Play
              </button>
              <button className="btn btn--sm" onClick={onExport} disabled={busy}>
                Export WAV
              </button>
              <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                Import WAV…
              </button>
              <span className="dim">
                {preview.type} · {preview.sampleRate} Hz
                {preview.loops ? " · loops" : ""}
              </span>
            </div>
            <WaveformScrub
              png={preview.png}
              currentTime={currentTime}
              duration={waveSeconds(preview.sampleRate, preview.samples)}
              onSeek={onSeek}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".wav,audio/wav"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onImport(f);
              }}
            />
          </>
        ) : (
          <div className="placeholder">{busy ? "Loading…" : "Select a wave."}</div>
        )}
      </div>
    </div>
  );
}


const TABS: SoundTab[] = ["sequences", "waves", "streams", "banks"];

/** SDAT category chips. Hidden for a standalone file. */
export function SdatTabBar({ fmt, info, tab, setTab }: { fmt: string; info: SdatInfo | null; tab: SoundTab; setTab: (tab: SoundTab) => void }) {
  if (fmt !== "SDAT" || !info) return null;
  return (
    <div className="controls">
      {TABS.map((item) => (
        <button key={item} className={"chip" + (tab === item ? " chip--on" : "")} onClick={() => setTab(item)}>
          {sdatTabLabel(item, info)}
        </button>
      ))}
    </div>
  );
}

/** Play button face: rendering, starting, playing, or idle. */
export function PlayFace({ busy, isPlaying }: { busy: string | null; isPlaying: boolean }) {
  if (busy === "render") return <>Rendering…</>;
  if (busy === "engine") return <>Starting…</>;
  if (isPlaying) return <><Icon name="play" /> Playing</>;
  return <><Icon name="play" /> Play</>;
}

/** Sequence list for an SDAT. A standalone SSEQ has no list. */
function SequenceList({ fmt, filter, setFilter, seqs, seqIndex, onSelect }: {
  fmt: string;
  filter: string;
  setFilter: (value: string) => void;
  seqs: SdatNamed[];
  seqIndex: number | null;
  onSelect: (index: number) => void;
}) {
  if (fmt !== "SDAT") return null;
  return (
    <div className="sound-col">
      <input className="sound-filter" placeholder="Filter sequences…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <NamedList items={seqs} selected={seqIndex} onSelect={onSelect} extra={bankExtra} />
    </div>
  );
}

/** Transport buttons for the open sequence. */
export function SequenceControls(props: {
  notes: SequenceNotes;
  canPlay: boolean;
  busy: string | null;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onExportWav: () => void;
  onExportMidi: () => void;
}) {
  return (
    <div className="controls">
      {props.canPlay && (
        <button className="play-btn" disabled={props.busy != null || props.isPlaying} onClick={props.onPlay}>
          <PlayFace busy={props.busy} isPlaying={props.isPlaying} />
        </button>
      )}
      {props.isPlaying && (
        <button className="play-btn" onClick={props.onStop}>
          <Icon name="stop" /> Stop
        </button>
      )}
      {props.canPlay && (
        <button className="btn btn--sm" disabled={props.busy != null} onClick={props.onExportWav}>
          {props.busy === "render" ? "Rendering…" : "Export WAV"}
        </button>
      )}
      <button className="btn btn--sm" disabled={props.busy != null} onClick={props.onExportMidi}>
        Export MIDI
      </button>
      <span className="dim">{sequenceTitle(props.notes)}</span>
    </div>
  );
}

/** Note roll, or the empty-state line. */
function SequenceBody(props: {
  notes: SequenceNotes | null;
  busy: string | null;
  canPlay: boolean;
  isPlaying: boolean;
  playTick: number;
  muted: boolean[];
  solo: boolean[];
  onPlay: () => void;
  onStop: () => void;
  onExportWav: () => void;
  onExportMidi: () => void;
  onMute: (track: number) => void;
  onSolo: (track: number) => void;
  onSeek: ((tick: number) => void) | undefined;
}) {
  if (!props.notes) return <div className="placeholder">{statusPlaceholder(props.busy, "notes", "Reading sequence…", "Select a sequence.")}</div>;
  return (
    <>
      <SequenceControls
        notes={props.notes}
        canPlay={props.canPlay}
        busy={props.busy}
        isPlaying={props.isPlaying}
        onPlay={props.onPlay}
        onStop={props.onStop}
        onExportWav={props.onExportWav}
        onExportMidi={props.onExportMidi}
      />
      <NoteRoll
        notes={props.notes}
        playTick={props.playTick}
        playing={props.isPlaying}
        muted={props.muted}
        solo={props.solo}
        onMute={props.onMute}
        onSolo={props.onSolo}
        onSeekTick={props.onSeek}
      />
    </>
  );
}

/** Sequence browser. */
export function SequencePane(props: {
  fmt: string;
  tab: SoundTab;
  filter: string;
  setFilter: (value: string) => void;
  seqs: SdatNamed[];
  seqIndex: number | null;
  onSelect: (index: number) => void;
  notes: SequenceNotes | null;
  busy: string | null;
  canPlay: boolean;
  isPlaying: boolean;
  playTick: number;
  muted: boolean[];
  solo: boolean[];
  onPlay: () => void;
  onStop: () => void;
  onExportWav: () => void;
  onExportMidi: () => void;
  onMute: (track: number) => void;
  onSolo: (track: number) => void;
  onSeek: ((tick: number) => void) | undefined;
}) {
  if (!showSequencePane(props.fmt, props.tab)) return null;
  return (
    <div className="sound-split">
      <SequenceList fmt={props.fmt} filter={props.filter} setFilter={props.setFilter} seqs={props.seqs} seqIndex={props.seqIndex} onSelect={props.onSelect} />
      <div className="sound-detail">
        <SequenceBody {...props} />
      </div>
    </div>
  );
}

/** Wave archive list for an SDAT. */
export function ArchiveList({ fmt, info, arcIndex, onSelect }: { fmt: string; info: SdatInfo | null; arcIndex: number | null; onSelect: (index: number) => void }) {
  if (fmt !== "SDAT" || !info) return null;
  return (
    <div className="sound-col">
      <NamedList items={info.waveArchives} selected={arcIndex} onSelect={onSelect} extra={waveCountExtra} />
    </div>
  );
}

/** Wave archive browser plus the shared wave panel. */
export function WaveArchivePane(props: {
  fmt: string;
  tab: SoundTab;
  info: SdatInfo | null;
  arcIndex: number | null;
  onArchive: (index: number) => void;
  waves: WaveInfo[];
  waveIndex: number | null;
  preview: WavePreview | null;
  busy: boolean;
  currentTime: number;
  onSelect: (index: number) => void;
  onPlay: () => void;
  onSeek: (time: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  if (!showWavePane(props.fmt, props.tab)) return null;
  return (
    <div className="sound-split">
      <ArchiveList fmt={props.fmt} info={props.info} arcIndex={props.arcIndex} onSelect={props.onArchive} />
      <WavePanel
        waves={props.waves}
        selected={props.waveIndex}
        preview={props.preview}
        busy={props.busy}
        currentTime={props.currentTime}
        onSelect={props.onSelect}
        onPlay={props.onPlay}
        onSeek={props.onSeek}
        onExport={props.onExport}
        onImport={props.onImport}
      />
    </div>
  );
}

/** Stream list for an SDAT. */
export function StreamList({ fmt, info, streamIndex, onSelect }: { fmt: string; info: SdatInfo | null; streamIndex: number | null; onSelect: (index: number) => void }) {
  if (fmt !== "SDAT" || !info) return null;
  return <NamedList items={info.streams} selected={streamIndex} onSelect={onSelect} />;
}

/** One stream's controls, or the empty state. */
function StreamDetail(props: {
  preview: StreamPreview | null;
  busy: string | null;
  info: SdatInfo | null;
  streamIndex: number | null;
  currentTime: number;
  onPlay: () => void;
  onExport: () => void;
  onSeek: (time: number) => void;
}) {
  if (!props.preview) return <div className="placeholder">{statusPlaceholder(props.busy, "stream", "Decoding…", "Select a stream.")}</div>;
  return (
    <>
      <div className="controls">
        <button className="play-btn" onClick={props.onPlay}>
          <Icon name="play" /> Play
        </button>
        <button className="btn btn--sm" onClick={props.onExport}>
          Export WAV
        </button>
        <span className="dim">
          {props.preview.channels} ch · {props.preview.sampleRate} Hz · {props.preview.samples.toLocaleString()} samples
        </span>
      </div>
      <WaveformScrub
        png={props.preview.png}
        currentTime={props.currentTime}
        duration={waveSeconds(props.preview.sampleRate, props.preview.samples)}
        onSeek={props.onSeek}
      />
    </>
  );
}

/** Stream browser. */
export function StreamPane(props: {
  fmt: string;
  tab: SoundTab;
  info: SdatInfo | null;
  streamIndex: number | null;
  onSelect: (index: number) => void;
  preview: StreamPreview | null;
  busy: string | null;
  currentTime: number;
  onPlay: () => void;
  onExport: () => void;
  onSeek: (time: number) => void;
}) {
  if (!showStreamPane(props.fmt, props.tab)) return null;
  return (
    <div className="sound-split">
      <StreamList fmt={props.fmt} info={props.info} streamIndex={props.streamIndex} onSelect={props.onSelect} />
      <div className="sound-detail">
        <StreamDetail
          preview={props.preview}
          busy={props.busy}
          info={props.info}
          streamIndex={props.streamIndex}
          currentTime={props.currentTime}
          onPlay={props.onPlay}
          onExport={props.onExport}
          onSeek={props.onSeek}
        />
      </div>
    </div>
  );
}

/** Bank list. Choosing one downloads a SoundFont. */
export function BankPane({ fmt, tab, info, onSelect }: { fmt: string; tab: SoundTab; info: SdatInfo | null; onSelect: (index: number) => void }) {
  if (fmt !== "SDAT" || tab !== "banks" || !info) return null;
  return (
    <div className="sound-col">
      <NamedList items={info.banks} selected={null} onSelect={onSelect} extra={sf2Extra} />
      <p className="dim">Click a bank to download its SoundFont.</p>
    </div>
  );
}

/** Extra column on a bank row. */
function sf2Extra(): string {
  return "export .sf2";
}

/** Whole sound page once the document has opened. */
export function SoundBody(props: PropsWithChildren<{ err: string | undefined; opening: boolean }>) {
  if (props.err) return <div className="error">Could not open audio: {props.err}</div>;
  if (props.opening) return <div className="placeholder">Opening SDAT…</div>;
  return <div className="sound">{props.children}</div>;
}

/** Timing used when seeking, preferring a matching render over the tempo estimate. */
export function seekTiming(ctx: SoundCtx, notes: SequenceNotes): { loop: LoopPts | null; seconds: number } {
  const wavOk = ctx.seqWav != null && ctx.seqWav.index === ctx.seqIndex;
  if (!wavOk || !ctx.seqWav) {
    const estimated = estimateTiming(notes);
    return { loop: estimated.loop, seconds: estimated.seconds };
  }
  return { loop: seqLoop(ctx.seqWav), seconds: ctx.seqWav.seconds };
}

/** Seek the live engine, or the rendered buffer when the song is small enough to render. */
export async function seekLiveOrWav(tick: number, ctx: SoundCtx, notes: SequenceNotes): Promise<void> {
  const engine = ctx.engineSlotRef.current.engine;
  if (engine) {
    const timing = seekTiming(ctx, notes);
    const seconds = tickToTime(tick, notes, timing.loop, timing.seconds);
    engine.seek(seconds);
    ctx.setLiveSeconds(seconds);
    return;
  }
  if (isDemandingSequence(notes)) return;
  const wav = await ensureSequenceWav(ctx);
  const loop = seqLoop(wav);
  ctx.audio.seek(tickToTime(tick, notes, loop, wav.seconds), wav.bytes, loop);
}

/** True when a demanding sequence must go live before it can be seeked. */
function needsLiveSeek(notes: SequenceNotes, ctx: SoundCtx): boolean {
  return isDemandingSequence(notes) && !ctx.engineSlotRef.current.engine;
}

/** Drag the playhead. Demanding sequences never fall back to a full render. */
export async function seekSequenceTick(tick: number, ctx: SoundCtx): Promise<void> {
  const notes = ctx.notes;
  if (!notes) return;
  try {
    if (needsLiveSeek(notes, ctx)) {
      if (ctx.goingLiveRef.current) return;
      await goLive(computeTrackMask(notes.trackCount, ctx.muted, ctx.solo), ctx);
    }
    await seekLiveOrWav(tick, ctx, notes);
  } catch (err) {
    alert("Render failed: " + errorMessage(err));
  }
}

/** Note-roll playhead for the open sequence, or zero when none is open. */
function sequencePlayTick(notes: SequenceNotes | null, time: number, loop: LoopPts | null, seconds: number): number {
  if (!notes) return 0;
  return playheadTick(time, notes, loop, seconds);
}

/** State and handlers for `SoundViewer`. */
function useSoundSession() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const importWav = useStore((s) => s.importWav);
  const editVersion = useStore((s) => s.editVersion);
  const fmt = selection.format;
  const audio = useAudio();
  const [tab, setTab] = useState<SoundTab>("sequences");
  const [info, setInfo] = useState<SdatInfo | null>(null);
  const [err, setErr] = useState<string>();
  const [filter, setFilter] = useState("");
  const [seqIndex, setSeqIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState<SequenceNotes | null>(null);
  const [arcIndex, setArcIndex] = useState<number | null>(null);
  const [waves, setWaves] = useState<WaveInfo[] | null>(null);
  const [waveIndex, setWaveIndex] = useState<number | null>(null);
  const [wavePrev, setWavePrev] = useState<WavePreview | null>(null);
  const [streamIndex, setStreamIndex] = useState<number | null>(null);
  const [streamPrev, setStreamPrev] = useState<StreamPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean[]>([]);
  const [solo, setSolo] = useState<boolean[]>([]);
  const [seqWav, setSeqWav] = useState<SeqWav | null>(null);
  const [live, setLive] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const engineSlotRef = useRef(new LiveEngineSlot<EngineHandle>());
  const liveGenerationRef = useRef(0);
  const goingLiveRef = useRef(false);
  const pendingMaskRef = useRef<number | null>(null);
  const { container, id } = selection.ref;
  const ref = selection.ref;
  const stopLive = () => stopLiveEngine({ liveGenerationRef, pendingMaskRef, engineSlotRef, setLive, setLiveSeconds });

  useEffect(() => () => stopLive(), []);

  useApplyOnChange(`${container}:${id}:${fmt}`, () => {
    setTab("sequences");
    setSeqIndex(null);
    setNotes(null);
    setArcIndex(null);
    setWaves(null);
    setWaveIndex(null);
    setWavePrev(null);
    setStreamIndex(null);
    setStreamPrev(null);
    setSeqWav(null);
    setFilter("");
  });

  useEffect(() => {
    audio.stop();
    stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, id, fmt]);

  useApplyOnChange(editVersion, () => setSeqWav(null));
  useApplyOnChange(notes, () => {
    setMuted([]);
    setSolo([]);
  });

  useEffect(() => {
    audio.stop();
    stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useApplyOnChange(`${romHandle}:${container}:${id}:${fmt}:${editVersion}`, () => setErr(undefined));

  useEffect(() => {
    let alive = true;
    loadSoundDocument(fmt, () => alive, { client, romHandle, ref }, {
      info: setInfo,
      notes: setNotes,
      seqIndex: setSeqIndex,
      waves: setWaves,
      wavePrev: setWavePrev,
      waveIndex: setWaveIndex,
      stream: setStreamPrev,
      err: setErr,
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, container, id, fmt, editVersion]);

  const waveBytes = useMemo(() => previewBytes(wavePrev), [wavePrev]);
  const streamBytes = useMemo(() => previewBytes(streamPrev), [streamPrev]);
  const seqs = useMemo(() => visibleSequences(info, filter), [info, filter]);
  const clock = playbackClock({ seqWav, seqIndex, live, notes });
  const canPlay = canPlaySequence(fmt, seqIndex);
  const isPlaying = soundIsPlaying(live, audio.playing);
  const playTick = sequencePlayTick(notes, rollTime(live, liveSeconds, clock.loop, audio.currentTime, sourceTime), clock.loop, clock.seconds);

  const ctx = (): SoundCtx => ({
    fmt, seqIndex, notes, seqWav, romHandle, ref, client, audio, muted, solo,
    selectionName: selection.name, setBusy, setErr, setNotes, setSeqIndex, setSeqWav,
    setLive, setLiveSeconds, engineSlotRef, liveGenerationRef, goingLiveRef, pendingMaskRef,
    stopLive, arcIndex, waveIndex, setArcIndex, setWaveIndex, setWavePrev, setWaves,
    setStreamIndex, setStreamPrev, importWav, info,
  });

  return {
    err, opening: sdatOpening(fmt, info), fmt, info, tab, setTab, filter, setFilter, seqs, seqIndex,
    notes, busy, canPlay, isPlaying, playTick, muted, solo,
    onSelectSeq: (index: number) => { void loadSequence(index, ctx()); },
    onPlay: () => { void playSequence(ctx()); },
    onStop: () => { stopLive(); audio.stop(); },
    onExportWav: () => { void exportSequenceWav(ctx()); },
    onExportMidi: () => { void exportSequenceMidi(ctx()); },
    onMute: (track: number) => toggleTrack("mute", track, ctx(), setMuted, setSolo),
    onSolo: (track: number) => toggleTrack("solo", track, ctx(), setMuted, setSolo),
    onSeekTick: (tick: number) => { void seekSequenceTick(tick, ctx()); },
    arcIndex,
    onArchive: (index: number) => { void loadArchive(index, ctx()); },
    waves: waveList(waves),
    waveIndex,
    wavePrev,
    onWave: (index: number) => { void loadWave(index, ctx()); },
    onPlayWave: () => playPreview(wavePrev, audio),
    onSeekWave: (time: number) => seekWave(time, waveBytes, audio),
    onExportWave: () => exportWaveFile(wavePrev, info, arcIndex, waveIndex),
    onImportWave: (file: File) => { void importWaveFile(file, ctx()); },
    currentTime: audio.currentTime,
    streamIndex,
    streamPrev,
    onStream: (index: number) => { void loadStream(index, ctx()); },
    onPlayStream: () => playPreview(streamPrev, audio),
    onExportStream: () => exportStreamPreview(streamPrev, info, streamIndex),
    onSeekStream: (time: number) => seekWave(time, streamBytes, audio),
    onBank: (index: number) => exportBank(index, ctx()),
  };
}

export function SoundViewer() {
  const vm = useSoundSession();
  return (
    <SoundBody err={vm.err} opening={vm.opening}>
      <SdatTabBar fmt={vm.fmt} info={vm.info} tab={vm.tab} setTab={vm.setTab} />
      <SequencePane
        fmt={vm.fmt}
        tab={vm.tab}
        filter={vm.filter}
        setFilter={vm.setFilter}
        seqs={vm.seqs}
        seqIndex={vm.seqIndex}
        onSelect={vm.onSelectSeq}
        notes={vm.notes}
        busy={vm.busy}
        canPlay={vm.canPlay}
        isPlaying={vm.isPlaying}
        playTick={vm.playTick}
        muted={vm.muted}
        solo={vm.solo}
        onPlay={vm.onPlay}
        onStop={vm.onStop}
        onExportWav={vm.onExportWav}
        onExportMidi={vm.onExportMidi}
        onMute={vm.onMute}
        onSolo={vm.onSolo}
        onSeek={vm.canPlay ? vm.onSeekTick : undefined}
      />
      <WaveArchivePane
        fmt={vm.fmt}
        tab={vm.tab}
        info={vm.info}
        arcIndex={vm.arcIndex}
        onArchive={vm.onArchive}
        waves={vm.waves}
        waveIndex={vm.waveIndex}
        preview={vm.wavePrev}
        busy={vm.busy != null}
        currentTime={vm.currentTime}
        onSelect={vm.onWave}
        onPlay={vm.onPlayWave}
        onSeek={vm.onSeekWave}
        onExport={vm.onExportWave}
        onImport={vm.onImportWave}
      />
      <StreamPane
        fmt={vm.fmt}
        tab={vm.tab}
        info={vm.info}
        streamIndex={vm.streamIndex}
        onSelect={vm.onStream}
        preview={vm.streamPrev}
        busy={vm.busy}
        currentTime={vm.currentTime}
        onPlay={vm.onPlayStream}
        onExport={vm.onExportStream}
        onSeek={vm.onSeekStream}
      />
      <BankPane fmt={vm.fmt} tab={vm.tab} info={vm.info} onSelect={vm.onBank} />
    </SoundBody>
  );
}
