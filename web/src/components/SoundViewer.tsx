import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { drawNoteTrack, noteTrackHeight } from "../sound/noteTrack";
import type {
  SdatInfo,
  SdatNamed,
  SequenceNotes,
  StreamPreview,
  WaveInfo,
  WavePreview,
} from "../transport";
import { base64ToBytes, download } from "../util";

type Tab = "sequences" | "waves" | "streams" | "banks";

function useAudio() {
  const urlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const stop = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(false);
    setProgress(0);
  };

  const play = (wav: Uint8Array) => {
    stop();
    const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener("ended", () => {
      setPlaying(false);
      setProgress(1);
    });
    void a.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    );
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && a.duration > 0) setProgress(a.currentTime / a.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { play, stop, playing, progress };
}

function NoteRoll({ notes, progress }: { notes: SequenceNotes; progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const height = noteTrackHeight(notes.trackCount);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const playTick = progress > 0 ? progress * notes.ticks : null;
    drawNoteTrack(ctx, notes.notes, notes.ticks, notes.trackCount, playTick, width);
  }, [notes, progress, width, height]);

  return (
    <div className="note-roll" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ width, height }} />
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
  onSelect,
  onPlay,
  onImport,
}: {
  waves: WaveInfo[];
  selected: number | null;
  preview: WavePreview | null;
  busy: boolean;
  onSelect: (i: number) => void;
  onPlay: () => void;
  onImport: (file: File) => void;
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
              <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                Import WAV…
              </button>
              <span className="dim">
                {preview.type} · {preview.sampleRate} Hz
                {preview.loops ? " · loops" : ""}
              </span>
            </div>
            <img className="wave-png" src={preview.png} alt="" />
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
    setFilter("");
    audio.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, id, fmt]);

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
    setBusy("notes");
    audio.stop();
    try {
      setNotes(await client.getSequenceNotes(romHandle, ref, index));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const playSequence = async () => {
    if (fmt !== "SDAT" || seqIndex == null) return;
    setBusy("render");
    try {
      const r = await client.renderSequenceWav(romHandle, ref, seqIndex, 20);
      audio.play(base64ToBytes(r.base64));
    } catch (e) {
      alert("Render failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportMidi = async () => {
    if (seqIndex == null && fmt !== "SSEQ") return;
    setBusy("midi");
    try {
      const r = await client.exportSequenceMidi(romHandle, ref, seqIndex ?? 0);
      const name = (notes?.name || selection.name || "sequence").replace(/[^\w.\-]+/g, "_");
      download(`${name}.mid`, base64ToBytes(r.base64), "audio/midi");
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
        <div className={"sound-split" + (fmt === "SSEQ" ? " sound-split--solo" : "")}>
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
                    <button className="play-btn" disabled={busy != null} onClick={() => void playSequence()}>
                      {busy === "render" ? "Rendering…" : audio.playing ? "▶ Playing" : "▶ Play"}
                    </button>
                  )}
                  {audio.playing && (
                    <button className="play-btn" onClick={audio.stop}>
                      ⏹ Stop
                    </button>
                  )}
                  <button className="btn btn--sm" disabled={busy != null} onClick={() => void exportMidi()}>
                    Export MIDI
                  </button>
                  <span className="dim">
                    {notes.name || "SSEQ"} · {notes.notes.length} notes · {notes.tempo} BPM · {notes.trackCount} tracks
                    {canPlaySeq ? " · render may take a while in-browser" : " · open the parent SDAT to play"}
                  </span>
                </div>
                <NoteRoll notes={notes} progress={audio.playing || audio.progress > 0 ? audio.progress : 0} />
              </>
            ) : (
              <div className="placeholder">{busy === "notes" ? "Reading sequence…" : "Select a sequence."}</div>
            )}
          </div>
        </div>
      )}

      {((fmt === "SDAT" && tab === "waves") || fmt === "SWAR" || fmt === "SWAV") && (
        <div className={"sound-split" + (fmt === "SDAT" ? "" : " sound-split--solo")}>
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
            onSelect={(i) => void loadWave(i)}
            onPlay={() => wavePrev && audio.play(base64ToBytes(wavePrev.wavBase64))}
            onImport={(f) => void onImportWav(f)}
          />
        </div>
      )}

      {((fmt === "SDAT" && tab === "streams") || fmt === "STRM") && (
        <div className={"sound-split" + (fmt === "STRM" ? " sound-split--solo" : "")}>
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
                  <span className="dim">
                    {streamPrev.channels} ch · {streamPrev.sampleRate} Hz · {streamPrev.samples.toLocaleString()} samples
                  </span>
                </div>
                <img className="wave-png" src={streamPrev.png} alt="" />
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
