import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../state/store";
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
import { base64ToBytes, download } from "../util";
import { createEngine, type EngineHandle } from "../sound/engine/host";

type Tab = "sequences" | "waves" | "streams" | "banks";

type LoopPts = { start: number; end: number };

/** When any track is soloed, only soloed tracks are audible; otherwise every non-muted track is.
 *  Shared by the live engine's track mask and the note-roll's mute/solo dimming so the two can't
 *  drift out of sync with each other. */
function trackAudible(t: number, muted: boolean[], solo: boolean[]): boolean {
  return solo.some(Boolean) ? !!solo[t] : !muted[t];
}

function computeTrackMask(trackCount: number, muted: boolean[], solo: boolean[]): number {
  let mask = 0;
  for (let t = 0; t < trackCount; t++) if (trackAudible(t, muted, solo)) mask |= 1 << t;
  return mask;
}

// Rendering a whole demanding sequence to WAV (the default playback path) pushes a large base64
// blob through the CheerpJ bridge and expands it into an equally large AudioBuffer — fine on
// desktop, but tight enough on iOS Safari's much smaller per-tab memory ceiling to crash the page
// (reported against SEQ_PL_BA_GIRA: 3552 notes, an 11-track boss theme, ~218s/19MB rendered WAV).
// Two known-good sequences (873 and 1193 notes) never had this problem; the threshold sits with
// margin on both sides of that gap. Above it, Play routes straight to the live engine — which was
// built for exactly this (constant memory regardless of song length) — instead of the rendered-WAV
// path, not just as a mute/solo escape hatch.
const DEMANDING_NOTE_COUNT = 2000;

function isDemandingSequence(notes: SequenceNotes): boolean {
  return notes.notes.length > DEMANDING_NOTE_COUNT;
}

// Fallback duration when a demanding sequence goes live without the WAV render (see goLive): the
// engine's driver runs at 192 Hz and advances one tick every time its tempoStack — accumulated at
// `tempo` per driver-frame — clears a 240 threshold (stepper.ts runDriverFrame), so ticks/sec =
// tempo * 192 / 240 = tempo * 0.8, i.e. seconds = ticks * 1.25 / tempo. Only used to keep the
// note-roll's playhead scrolling at roughly the right pace; loop timing still needs the real WAV.
function estimateSeconds(notes: SequenceNotes): number {
  return notes.tempo > 0 ? (notes.ticks * 1.25) / notes.tempo : 0;
}

function wavToBuffer(ctx: AudioContext, wav: Uint8Array): AudioBuffer {
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

function WavePanel({
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
                ▶ Play
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
              duration={preview.sampleRate > 0 ? preview.samples / preview.sampleRate : 0}
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

export function SoundViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const importWav = useStore((s) => s.importWav);
  const editVersion = useStore((s) => s.editVersion);
  const fmt = selection.format;
  const audio = useAudio();

  const [tab, setTab] = useState<Tab>("sequences");
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
  const [seqWav, setSeqWav] = useState<{
    index: number;
    bytes: Uint8Array;
    seconds: number;
    loopStartSec: number;
    loopEndSec: number;
  } | null>(null);
  const waveBytes = useMemo(
    () => (wavePrev ? base64ToBytes(wavePrev.wavBase64) : null),
    [wavePrev]
  );
  const streamBytes = useMemo(
    () => (streamPrev ? base64ToBytes(streamPrev.wavBase64) : null),
    [streamPrev]
  );

  // Live (AudioWorklet) engine: default playback stays on the rendered-WAV path above; the first
  // mute/solo click spins this up, seeded to the current position. Tracked via refs, not state:
  // every consumer that acts on the engine (seek/setTrackMask/disconnect) needs the CURRENT handle
  // from effects and async callbacks where state would risk a stale closure — `live` (state) exists
  // only to trigger a re-render when engine presence changes. `liveGeneration` is bumped by every
  // teardown path (stop, sequence switch, tab switch, resource switch, unmount) so an in-flight
  // goLive() can tell it was cancelled after its awaits resolve and discard the engine it just
  // built instead of attaching a now-stale one; `goingLive` blocks goLive() from being re-entered
  // while already in flight (its own awaits are the only gap where that's possible) — a mask that
  // arrives during that gap is captured in `pendingMask` instead of being dropped, and applied the
  // moment the in-flight engine attaches, so the engine never starts audible with a stale mute/solo
  // mask that no longer matches what the UI is showing.
  const [live, setLive] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const engineRef = useRef<EngineHandle | null>(null);
  const liveGenerationRef = useRef(0);
  const goingLiveRef = useRef(false);
  const pendingMaskRef = useRef<number | null>(null);

  const stopLive = () => {
    liveGenerationRef.current++;
    pendingMaskRef.current = null;
    const e = engineRef.current;
    if (!e) return;
    e.node.disconnect();
    engineRef.current = null;
    setLive(false);
    setLiveSeconds(0);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stopLive(), []); // tear down on unmount too, not just on the lifecycle events below

  const { container, id } = selection.ref;
  const ref = selection.ref;

  useEffect(() => {
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
    audio.stop();
    stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, id, fmt]);

  useEffect(() => {
    setSeqWav(null);
  }, [editVersion]);

  useEffect(() => {
    setMuted([]);
    setSolo([]);
  }, [notes]);

  useEffect(() => {
    audio.stop();
    stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    let alive = true;
    setErr(undefined);
    if (fmt === "SDAT") {
      client
        .getSdatInfo(romHandle, ref)
        .then((d) => alive && setInfo(d))
        .catch((e) => alive && setErr((e as Error).message));
    } else if (fmt === "SSEQ") {
      client
        .getSequenceNotes(romHandle, ref, 0)
        .then((d) => {
          if (!alive) return;
          setNotes(d);
          setSeqIndex(0);
        })
        .catch((e) => alive && setErr((e as Error).message));
    } else if (fmt === "SWAR") {
      client
        .getWaveArchiveInfo(romHandle, ref, 0)
        .then((d) => alive && setWaves(d.waves))
        .catch((e) => alive && setErr((e as Error).message));
    } else if (fmt === "SWAV") {
      client
        .getWavePreview(romHandle, ref, 0, 0)
        .then((d) => {
          if (!alive) return;
          setWavePrev(d);
          setWaves([
            {
              index: 0,
              sampleRate: d.sampleRate,
              samples: d.samples,
              type: d.type,
              loops: d.loops,
            },
          ]);
          setWaveIndex(0);
        })
        .catch((e) => alive && setErr((e as Error).message));
    } else if (fmt === "STRM") {
      client
        .getStreamPreview(romHandle, ref, 0)
        .then((d) => alive && setStreamPrev(d))
        .catch((e) => alive && setErr((e as Error).message));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, romHandle, container, id, fmt, editVersion]);

  const seqs = useMemo(() => {
    if (!info) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return info.sequences;
    return info.sequences.filter((s) => (s.name || "").toLowerCase().includes(q) || String(s.index).includes(q));
  }, [info, filter]);

  const loadSequence = async (index: number) => {
    setSeqIndex(index);
    setSeqWav(null);
    setBusy("notes");
    audio.stop();
    stopLive();
    try {
      setNotes(await client.getSequenceNotes(romHandle, ref, index));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const seqFileName = () =>
    (notes?.name || selection.name || "sequence").replace(/[^\w.\-]+/g, "_");

  const ensureSequenceWav = async () => {
    if (fmt !== "SDAT" || seqIndex == null) throw new Error("sequence playback needs an SDAT");
    if (seqWav && seqWav.index === seqIndex) return seqWav;
    const r = await client.renderSequenceWav(romHandle, ref, seqIndex, 0);
    const cached = {
      index: seqIndex,
      bytes: base64ToBytes(r.base64),
      seconds: r.seconds,
      loopStartSec: r.loopStartSec,
      loopEndSec: r.loopEndSec,
    };
    setSeqWav(cached);
    return cached;
  };

  const seqLoop = (w: { loopStartSec: number; loopEndSec: number }): LoopPts | null =>
    w.loopEndSec > w.loopStartSec + 0.02 ? { start: Math.max(0, w.loopStartSec), end: w.loopEndSec } : null;

  const playSequence = async () => {
    if (fmt !== "SDAT" || seqIndex == null || !notes) return;
    if (isDemandingSequence(notes)) {
      // Skip the rendered-WAV path entirely for a sequence big enough to risk it — straight to the
      // live engine, same as a mute/solo click, just triggered by Play instead.
      await goLive(computeTrackMask(notes.trackCount, muted, solo));
      return;
    }
    setBusy("render");
    try {
      const w = await ensureSequenceWav();
      audio.play(w.bytes, seqLoop(w));
    } catch (e) {
      alert("Render failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Switch from the default rendered-WAV playback to the live AudioWorklet engine, seeded to the
   * current position, so mute/solo actually change what's audible instead of only the note-roll
   * highlight. Only reachable via the first mute/solo click (see toggleTrack below); once live,
   * further mute/solo changes are just a message to the running engine, no reseed.
   */
  const goLive = async (mask: number) => {
    if (fmt !== "SDAT" || seqIndex == null || engineRef.current || !notes) return;
    if (goingLiveRef.current) {
      // A goLive() is already in flight from an earlier click; record this newer mask rather than
      // dropping it, so the engine attaches with the user's latest intent, not a stale one.
      pendingMaskRef.current = mask;
      return;
    }
    goingLiveRef.current = true;
    const myGeneration = liveGenerationRef.current;
    const seedSeconds = audio.currentTime;
    setBusy("engine");
    try {
      // ensureSequenceWav supplies the loop-in-seconds timing the note-roll's playhead needs to
      // wrap correctly across repeat loop cycles in live mode — worth having when it's free (cached
      // from a previous Play) or cheap (a small sequence). But for a demanding sequence going live
      // specifically to AVOID that render's memory cost, triggering it here just to draw a nicer
      // playhead would defeat the entire point — skip it and let the playhead fall back to a rough
      // tempo-based estimate (estimateSeconds) instead of an exact one.
      const alreadyCached = seqWav != null && seqWav.index === seqIndex;
      const wantWavTiming = alreadyCached || !isDemandingSequence(notes);
      const engineData = wantWavTiming
        ? (await Promise.all([ensureSequenceWav(), client.getSequenceEngineData(romHandle, ref, seqIndex)]))[1]
        : await client.getSequenceEngineData(romHandle, ref, seqIndex);
      const ctx = audio.ctx();
      const e = await createEngine(ctx, engineData, { seedSeconds, trackMask: mask });
      if (liveGenerationRef.current !== myGeneration) {
        // Stopped, switched sequences, or unmounted while we were setting up — discard rather
        // than attach a live engine nobody asked for anymore.
        e.node.disconnect();
        return;
      }
      e.node.connect(ctx.destination);
      audio.stop();
      e.onPosition((s) => setLiveSeconds(s));
      setLiveSeconds(seedSeconds);
      engineRef.current = e;
      setLive(true);
      // A newer mute/solo click arrived while we were setting up (captured above instead of
      // dropped) — apply the user's latest intent now instead of leaving the engine on the mask
      // from whichever click happened to be first.
      if (pendingMaskRef.current != null) {
        e.setTrackMask(pendingMaskRef.current);
        pendingMaskRef.current = null;
      }
    } catch (e) {
      alert("Live engine failed to start: " + (e as Error).message);
    } finally {
      goingLiveRef.current = false;
      setBusy(null);
      // A mask arrived (and was queued into pendingMaskRef) while this call was in flight, but
      // this call ended up discarding its engine (stopped/switched away mid-setup) or erroring out
      // before it could apply that mask itself — nothing else will ever consume it otherwise
      // (pendingMaskRef is only read from inside an in-flight goLive()), so retry with it now.
      const stillPending = pendingMaskRef.current;
      if (stillPending != null && !engineRef.current) {
        pendingMaskRef.current = null;
        void goLive(stillPending);
      }
    }
  };

  const stopPlayback = () => {
    stopLive();
    audio.stop();
  };

  const toggleTrack = (kind: "mute" | "solo", t: number) => {
    if (!notes) return;
    const flags = kind === "mute" ? muted : solo;
    const next = Array.from({ length: notes.trackCount }, (_, i) => flags[i] ?? false);
    next[t] = !next[t];
    const nextMuted = kind === "mute" ? next : muted;
    const nextSolo = kind === "solo" ? next : solo;
    if (kind === "mute") setMuted(next);
    else setSolo(next);
    const mask = computeTrackMask(notes.trackCount, nextMuted, nextSolo);
    if (engineRef.current) engineRef.current.setTrackMask(mask);
    else void goLive(mask);
  };

  const exportWav = async () => {
    if (fmt !== "SDAT" || seqIndex == null) return;
    setBusy("render");
    try {
      download(`${seqFileName()}.wav`, (await ensureSequenceWav()).bytes, "audio/wav");
    } catch (e) {
      alert("WAV export failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportMidi = async () => {
    if (seqIndex == null && fmt !== "SSEQ") return;
    setBusy("midi");
    try {
      const r = await client.exportSequenceMidi(romHandle, ref, seqIndex ?? 0);
      download(`${seqFileName()}.mid`, base64ToBytes(r.base64), "audio/midi");
    } catch (e) {
      alert("MIDI export failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadArchive = async (index: number) => {
    setArcIndex(index);
    setWaveIndex(null);
    setWavePrev(null);
    setBusy("waves");
    try {
      setWaves((await client.getWaveArchiveInfo(romHandle, ref, index)).waves);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadWave = async (index: number) => {
    setWaveIndex(index);
    setBusy("wave");
    audio.stop();
    try {
      setWavePrev(await client.getWavePreview(romHandle, ref, arcIndex ?? 0, index));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadStream = async (index: number) => {
    setStreamIndex(index);
    setBusy("stream");
    audio.stop();
    try {
      setStreamPrev(await client.getStreamPreview(romHandle, ref, index));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onImportWav = async (file: File) => {
    if (waveIndex == null) return;
    setBusy("import");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importWav(ref, arcIndex ?? 0, waveIndex, bytes);
      setWavePrev(await client.getWavePreview(romHandle, ref, arcIndex ?? 0, waveIndex));
      if (fmt === "SDAT" || fmt === "SWAR") {
        setWaves((await client.getWaveArchiveInfo(romHandle, ref, arcIndex ?? 0)).waves);
      }
    } catch (e) {
      alert("WAV import failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (err) return <div className="error">Could not open audio: {err}</div>;
  if (fmt === "SDAT" && !info) return <div className="placeholder">Opening SDAT…</div>;

  const canPlaySeq = fmt === "SDAT" && seqIndex != null;
  const isPlaying = live || audio.playing;

  return (
    <div className="sound">
      {fmt === "SDAT" && info && (
        <div className="controls">
          {(["sequences", "waves", "streams", "banks"] as Tab[]).map((t) => (
            <button key={t} className={"chip" + (tab === t ? " chip--on" : "")} onClick={() => setTab(t)}>
              {t === "sequences"
                ? `Sequences (${info.sequences.length})`
                : t === "waves"
                  ? `Waves (${info.waveArchives.length})`
                  : t === "streams"
                    ? `Streams (${info.streams.length})`
                    : `Banks (${info.banks.length})`}
            </button>
          ))}
        </div>
      )}

      {((fmt === "SDAT" && tab === "sequences") || fmt === "SSEQ") && (
        <div className="sound-split">
          {fmt === "SDAT" && (
            <div className="sound-col">
              <input
                className="sound-filter"
                placeholder="Filter sequences…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <NamedList
                items={seqs}
                selected={seqIndex}
                onSelect={(i) => void loadSequence(i)}
                extra={(it) => "bank " + (it as { bankId?: number }).bankId}
              />
            </div>
          )}
          <div className="sound-detail">
            {notes ? (
              <>
                <div className="controls">
                  {canPlaySeq && (
                    <button className="play-btn" disabled={busy != null || isPlaying} onClick={() => void playSequence()}>
                      {busy === "render"
                        ? "Rendering…"
                        : busy === "engine"
                          ? "Starting…"
                          : isPlaying
                            ? "▶ Playing"
                            : "▶ Play"}
                    </button>
                  )}
                  {isPlaying && (
                    <button className="play-btn" onClick={stopPlayback}>
                      ⏹ Stop
                    </button>
                  )}
                  {canPlaySeq && (
                    <button className="btn btn--sm" disabled={busy != null} onClick={() => void exportWav()}>
                      {busy === "render" ? "Rendering…" : "Export WAV"}
                    </button>
                  )}
                  <button className="btn btn--sm" disabled={busy != null} onClick={() => void exportMidi()}>
                    Export MIDI
                  </button>
                  <span className="dim">
                    {notes.name || "SSEQ"} · {notes.notes.length} notes · {notes.tempo} BPM · {notes.trackCount} tracks
                    {canPlaySeq
                      ? live
                        ? " · live mixing engine"
                        : isDemandingSequence(notes)
                          ? " · large sequence; play uses the live mixing engine"
                          : " · first play synthesizes the whole song; mute/solo switches to live mixing"
                      : " · open the parent SDAT to play"}
                  </span>
                </div>
                <NoteRoll
                  notes={notes}
                  playTick={playheadTick(
                    live ? sourceTime(liveSeconds, seqWav ? seqLoop(seqWav) : null) : audio.currentTime,
                    notes,
                    seqWav ? seqLoop(seqWav) : null,
                    seqWav?.seconds ?? (live ? estimateSeconds(notes) : 0)
                  )}
                  playing={isPlaying}
                  muted={muted}
                  solo={solo}
                  onMute={(t) => toggleTrack("mute", t)}
                  onSolo={(t) => toggleTrack("solo", t)}
                  onSeekTick={
                    canPlaySeq
                      ? (tick) => {
                          void (async () => {
                            try {
                              const w = await ensureSequenceWav();
                              const loop = seqLoop(w);
                              const seconds = tickToTime(tick, notes, loop, w.seconds);
                              if (engineRef.current) {
                                engineRef.current.seek(seconds);
                                setLiveSeconds(seconds);
                              } else {
                                audio.seek(seconds, w.bytes, loop);
                              }
                            } catch (e) {
                              alert("Render failed: " + (e as Error).message);
                            }
                          })();
                        }
                      : undefined
                  }
                />
              </>
            ) : (
              <div className="placeholder">{busy === "notes" ? "Reading sequence…" : "Select a sequence."}</div>
            )}
          </div>
        </div>
      )}

      {((fmt === "SDAT" && tab === "waves") || fmt === "SWAR" || fmt === "SWAV") && (
        <div className="sound-split">
          {fmt === "SDAT" && info && (
            <div className="sound-col">
              <NamedList
                items={info.waveArchives}
                selected={arcIndex}
                onSelect={(i) => void loadArchive(i)}
                extra={(it) => String((it as { waveCount?: number }).waveCount ?? "") + " waves"}
              />
            </div>
          )}
          <WavePanel
            waves={waves ?? []}
            selected={waveIndex}
            preview={wavePrev}
            busy={busy != null}
            currentTime={audio.currentTime}
            onSelect={(i) => void loadWave(i)}
            onPlay={() => wavePrev && audio.play(base64ToBytes(wavePrev.wavBase64))}
            onSeek={(t) => {
              if (!waveBytes) return;
              audio.seek(t, waveBytes);
            }}
            onExport={() =>
              wavePrev &&
              download(
                `${(info?.waveArchives.find((a) => a.index === (arcIndex ?? 0))?.name || "wave")}_${waveIndex}.wav`.replace(
                  /[^\w.\-]+/g,
                  "_"
                ),
                base64ToBytes(wavePrev.wavBase64),
                "audio/wav"
              )
            }
            onImport={(f) => void onImportWav(f)}
          />
        </div>
      )}

      {((fmt === "SDAT" && tab === "streams") || fmt === "STRM") && (
        <div className="sound-split">
          {fmt === "SDAT" && info && (
            <NamedList items={info.streams} selected={streamIndex} onSelect={(i) => void loadStream(i)} />
          )}
          <div className="sound-detail">
            {streamPrev ? (
              <>
                <div className="controls">
                  <button className="play-btn" onClick={() => audio.play(base64ToBytes(streamPrev.wavBase64))}>
                    ▶ Play
                  </button>
                  <button
                    className="btn btn--sm"
                    onClick={() =>
                      download(
                        `${(info?.streams.find((s) => s.index === streamIndex)?.name || "stream").replace(/[^\w.\-]+/g, "_")}.wav`,
                        base64ToBytes(streamPrev.wavBase64),
                        "audio/wav"
                      )
                    }
                  >
                    Export WAV
                  </button>
                  <span className="dim">
                    {streamPrev.channels} ch · {streamPrev.sampleRate} Hz · {streamPrev.samples.toLocaleString()} samples
                  </span>
                </div>
                <WaveformScrub
                  png={streamPrev.png}
                  currentTime={audio.currentTime}
                  duration={streamPrev.sampleRate > 0 ? streamPrev.samples / streamPrev.sampleRate : 0}
                  onSeek={(t) => streamBytes && audio.seek(t, streamBytes)}
                />
              </>
            ) : (
              <div className="placeholder">{busy === "stream" ? "Decoding…" : "Select a stream."}</div>
            )}
          </div>
        </div>
      )}

      {fmt === "SDAT" && tab === "banks" && info && (
        <div className="sound-col">
          <NamedList
            items={info.banks}
            selected={null}
            onSelect={(i) => {
              setBusy("sf2");
              client
                .exportBankSf2(romHandle, ref, i)
                .then((r) => {
                  const name = info.banks.find((b) => b.index === i)?.name || `bank${i}`;
                  download(`${name.replace(/[^\w.\-]+/g, "_")}.sf2`, base64ToBytes(r.base64));
                })
                .catch((e) => alert("SoundFont export failed: " + (e as Error).message))
                .finally(() => setBusy(null));
            }}
            extra={() => "export .sf2"}
          />
          <p className="dim">Click a bank to download its SoundFont.</p>
        </div>
      )}
    </div>
  );
}
