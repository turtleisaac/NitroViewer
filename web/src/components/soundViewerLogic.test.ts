// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { describe, expect, it, vi } from "vitest";
import type { SdatInfo, SequenceNotes } from "../transport";
import {
  bankExtra,
  canPlaySequence,
  computeTrackMask,
  ensureSequenceWav,
  estimateSeconds,
  estimateTiming,
  exportSequenceMidi,
  exportBank,
  exportSequenceWav,
  goLive,
  importWaveFile,
  loadWave,
  isDemandingSequence,
  liveBlocked,
  loadSoundDocument,
  demandingSequence,
  nextTrackFlags,
  playbackClock,
  playSequence,
  previewBytes,
  sdatOpening,
  sdatTabLabel,
  seqFileName,
  seqLoop,
  sequenceMatches,
  showSequencePane,
  showStreamPane,
  showWavePane,
  soundIsPlaying,
  stopLiveEngine,
  streamFileBase,
  toggleTrack,
  trackAudible,
  visibleSequences,
  waveCountExtra,
  waveDownloadName,
  waveList,
  wantWavTiming,
  type SoundCtx,
} from "./soundViewerLogic";

vi.mock("../sound/engine/host", () => ({
  createEngine: vi.fn(async () => ({
    node: { connect() { return undefined; }, disconnect() { return undefined; } },
    setTrackMask: vi.fn(),
    seek: vi.fn(),
    onPosition: () => () => undefined,
    onEnded: () => () => undefined,
  })),
}));

const notes = (over: Partial<SequenceNotes> = {}): SequenceNotes => ({
  ticks: 100,
  tempo: 100,
  trackCount: 2,
  loopStart: 0,
  loopEnd: 40,
  bankId: 1,
  name: "town",
  notes: [],
  ...over,
});

const info: SdatInfo = {
  sequences: [{ index: 1, name: "Town", bankId: 2 }, { index: 3, name: null, bankId: 0 }],
  banks: [{ index: 4, name: "piano" }, { index: 5, name: null }],
  waveArchives: [{ index: 0, name: "drums", waveCount: 2 }],
  streams: [{ index: 6, name: "rain" }],
  sequenceArchives: [],
};

function ctx(over: Partial<SoundCtx> = {}): SoundCtx {
  const engine = {
    node: { connect() { return undefined; }, disconnect() { return undefined; } },
    setTrackMask: vi.fn(),
    seek: vi.fn(),
    onPosition: () => () => undefined,
    onEnded: () => () => undefined,
  };
  const slot = { engine: null as typeof engine | null, clear: vi.fn(), set: vi.fn() };
  void engine;
  return {
    fmt: "SDAT",
    seqIndex: 1,
    notes: notes(),
    seqWav: null,
    romHandle: 1,
    ref: { container: -1, id: 2 },
    client: {
      renderSequenceWav: vi.fn(async () => ({ base64: "QQ==", seconds: 3, loopStartSec: 0, loopEndSec: 2 })),
      getSequenceEngineData: vi.fn(async () => ({ bankId: 0, eventData: "", instruments: [], waveArchives: [] })),
      getSequenceNotes: vi.fn(async () => notes()),
      exportSequenceMidi: vi.fn(async () => ({ base64: "QQ==" })),
      getWaveArchiveInfo: vi.fn(async () => ({ waves: [] })),
      getWavePreview: vi.fn(async () => ({ sampleRate: 8000, samples: 8, loops: false, type: "pcm8", png: "", wavBase64: "QQ==" })),
      getStreamPreview: vi.fn(async () => ({ sampleRate: 8000, channels: 1, samples: 8, png: "", wavBase64: "QQ==" })),
      getSdatInfo: vi.fn(async () => info),
      exportBankSf2: vi.fn(async () => ({ base64: "QQ==" })),
    },
    audio: {
      play: vi.fn(),
      seek: vi.fn(),
      stop: vi.fn(),
      playing: false,
      currentTime: 1,
      ctx: () => ({ destination: {} }) as AudioContext,
    },
    muted: [false, true],
    solo: [false, false],
    selectionName: "song",
    setBusy: vi.fn(),
    setErr: vi.fn(),
    setNotes: vi.fn(),
    setSeqIndex: vi.fn(),
    setSeqWav: vi.fn(),
    setLive: vi.fn(),
    setLiveSeconds: vi.fn(),
    engineSlotRef: { current: slot as unknown as SoundCtx["engineSlotRef"]["current"] },
    liveGenerationRef: { current: 0 },
    goingLiveRef: { current: false },
    pendingMaskRef: { current: null },
    stopLive: vi.fn(),
    arcIndex: 0,
    waveIndex: 1,
    setArcIndex: vi.fn(),
    setWaveIndex: vi.fn(),
    setWavePrev: vi.fn(),
    setWaves: vi.fn(),
    setStreamIndex: vi.fn(),
    setStreamPrev: vi.fn(),
    importWav: vi.fn(async () => undefined),
    info,
    ...over,
  };
}

describe("sound viewer logic", () => {
  it("estimates timing, demand, and playback clocks", () => {
    expect(estimateTiming(notes({ tempo: 0 })).seconds).toBe(0);
    expect(estimateSeconds(notes())).toBeGreaterThan(0);
    expect(estimateTiming(notes({ loopStart: -1 })).loop).toBeNull();
    expect(isDemandingSequence(notes())).toBe(false);
    expect(isDemandingSequence(notes({ ticks: 100, tempo: 1, loopStart: -1, notes: new Array(1600).fill(notes().notes[0] ?? { track: 0, tick: 0, duration: 1, key: 1, velocity: 1, program: 0 }) }))).toBe(true);
    expect(demandingSequence(null)).toBe(false);
    expect(seqLoop({ loopStartSec: 0, loopEndSec: 0 })).toBeNull();
    expect(seqLoop({ loopStartSec: 0, loopEndSec: 1 })?.end).toBe(1);
    expect(canPlaySequence("SSEQ", 1)).toBe(false);
    expect(canPlaySequence("SDAT", null)).toBe(false);
    expect(soundIsPlaying(false, true)).toBe(true);
    const quiet = playbackClock({ seqWav: null, seqIndex: 1, live: false, notes: notes() });
    expect(quiet.seconds).toBe(0);
    const live = playbackClock({ seqWav: null, seqIndex: 1, live: true, notes: notes() });
    expect(live.seconds).toBeGreaterThan(0);
    const cached = playbackClock({
      seqWav: { index: 1, bytes: new Uint8Array(), seconds: 4, loopStartSec: 0, loopEndSec: 2 },
      seqIndex: 1,
      live: false,
      notes: notes(),
    });
    expect(cached.seconds).toBe(4);
    expect(wantWavTiming({ index: 1, bytes: new Uint8Array(), seconds: 4, loopStartSec: 0, loopEndSec: 2 }, 1, notes())).toBe(true);
    expect(wantWavTiming(null, 1, notes({ notes: [], ticks: 10, tempo: 100, loopStart: -1 }))).toBe(true);
    expect(trackAudible(1, [false, true], [false, false])).toBe(false);
    expect(trackAudible(0, [false, true], [true, false])).toBe(true);
    expect(computeTrackMask(2, [false, true], [false, false])).toBe(1);
  });

  it("filters sequences and names downloads", () => {
    expect(visibleSequences(null, "")).toEqual([]);
    expect(visibleSequences(info, "  ")).toHaveLength(2);
    expect(visibleSequences(info, "town")).toHaveLength(1);
    expect(sequenceMatches(info.sequences[1], "3")).toBe(true);
    expect(seqFileName(null, "")).toBe("sequence");
    expect(seqFileName({ name: "a b" }, "song")).toBe("a_b");
    expect(sdatTabLabel("sequences", info)).toContain("Sequences");
    expect(sdatTabLabel("waves", info)).toContain("Waves");
    expect(sdatTabLabel("streams", info)).toContain("Streams");
    expect(sdatTabLabel("banks", info)).toContain("Banks");
    expect(showSequencePane("SSEQ", "waves")).toBe(true);
    expect(showWavePane("SWAV", "sequences")).toBe(true);
    expect(showWavePane("STRM", "waves")).toBe(false);
    expect(showStreamPane("STRM", "banks")).toBe(true);
    expect(sdatOpening("SDAT", null)).toBe(true);
    expect(sdatOpening("SSEQ", null)).toBe(false);
    expect(bankExtra(info.sequences[0])).toContain("bank");
    expect(waveCountExtra(info.waveArchives[0])).toContain("waves");
    expect(waveDownloadName(info, null, 1)).toContain("drums_1");
    expect(waveDownloadName(null, 0, 1)).toContain("wave_1");
    expect(streamFileBase(info, 6)).toBe("rain");
    expect(streamFileBase(null, 1)).toBe("stream");
    expect(previewBytes(null)).toBeNull();
    expect(waveList(null)).toEqual([]);
    expect(demandingSequence(null)).toBe(false);
    const flags = nextTrackFlags("solo", 0, [false], [false], 1);
    expect(flags.solo[0]).toBe(true);
    expect(nextTrackFlags("mute", 0, [true], [false], 1).muted[0]).toBe(false);
  });

  it("loads each sound format and ignores a cancelled request", async () => {
    const set = {
      info: vi.fn(),
      notes: vi.fn(),
      seqIndex: vi.fn(),
      waves: vi.fn(),
      wavePrev: vi.fn(),
      waveIndex: vi.fn(),
      stream: vi.fn(),
      err: vi.fn(),
    };
    const base = ctx();
    loadSoundDocument("SDAT", () => true, base, set);
    loadSoundDocument("SSEQ", () => true, base, set);
    loadSoundDocument("SWAR", () => true, base, set);
    loadSoundDocument("SWAV", () => true, base, set);
    loadSoundDocument("STRM", () => true, base, set);
    loadSoundDocument("OTHER", () => true, base, set);
    await Promise.resolve();
    await Promise.resolve();
    expect(set.info).toHaveBeenCalled();
    expect(set.notes).toHaveBeenCalled();
    expect(set.waves).toHaveBeenCalled();
    expect(set.stream).toHaveBeenCalled();
    const failing = ctx();
    failing.client.getSdatInfo = vi.fn(async () => { throw new Error("nope"); });
    loadSoundDocument("SDAT", () => false, failing, set);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("plays, seeks the live engine, and exports", async () => {
    const alerted = vi.fn();
    window.alert = alerted;
    const blocked = ctx({ fmt: "SSEQ", seqIndex: null, notes: null });
    expect(liveBlocked(blocked)).toBe(true);
    await goLive(1, blocked);
    const held = ctx();
    held.goingLiveRef.current = true;
    await goLive(7, held);
    expect(held.pendingMaskRef.current).toBe(7);
    const played = ctx();
    await playSequence(played);
    expect(played.audio.play).toHaveBeenCalled();
    const live = ctx({ notes: notes({ notes: new Array(1600).fill({ track: 0, tick: 0, duration: 1, key: 1, velocity: 1, program: 0 }) }) });
    await playSequence(live);
    expect(live.setLive).toHaveBeenCalledWith(true);
    const cached = ctx({ seqWav: { index: 1, bytes: new Uint8Array([1]), seconds: 2, loopStartSec: 0, loopEndSec: 1 } });
    await ensureSequenceWav(cached);
    expect(cached.client.renderSequenceWav).not.toHaveBeenCalled();
    await exportSequenceWav(ctx());
    window.confirm = () => false;
    await exportSequenceWav(ctx({ notes: notes({ notes: new Array(1600).fill({ track: 0, tick: 0, duration: 1, key: 1, velocity: 1, program: 0 }) }) }));
    await exportSequenceMidi(ctx({ seqIndex: null, fmt: "SSEQ" }));
    await exportSequenceMidi(ctx({ seqIndex: null, fmt: "SWAV" }));
    const toggled = ctx();
    toggleTrack("mute", 0, toggled, vi.fn(), vi.fn());
    expect(toggled.setBusy).toHaveBeenCalledWith("engine");
    const slot = toggled.engineSlotRef.current as unknown as { engine: { setTrackMask: ReturnType<typeof vi.fn> } | null };
    slot.engine = { setTrackMask: vi.fn() };
    toggleTrack("solo", 1, toggled, vi.fn(), vi.fn());
    expect(slot.engine.setTrackMask).toHaveBeenCalled();
    stopLiveEngine(ctx());
    const running = ctx();
    (running.engineSlotRef.current as unknown as { engine: { node: { disconnect: () => void } } | null }).engine = {
      node: { disconnect: vi.fn() },
    };
    stopLiveEngine(running);
    await loadWave(2, ctx());
    exportBank(4, ctx());
    await Promise.resolve();
  });

  it("imports a wave and reports render failures", async () => {
    const alerted = vi.fn();
    window.alert = alerted;
    const missing = ctx({ waveIndex: null });
    await importWaveFile(new File([new Uint8Array([1])], "a.wav"), missing);
    const imported = ctx({ fmt: "SWAV" });
    await importWaveFile(new File([new Uint8Array([1])], "a.wav"), imported);
    expect(imported.setWaves).not.toHaveBeenCalled();
    const sdat = ctx();
    await importWaveFile(new File([new Uint8Array([1])], "a.wav"), sdat);
    expect(sdat.setWaves).toHaveBeenCalled();
    const broken = ctx();
    broken.client.renderSequenceWav = vi.fn(async () => { throw new Error("render"); });
    await playSequence(broken);
    expect(alerted).toHaveBeenCalled();
    await exportSequenceWav(broken);
    broken.client.exportSequenceMidi = vi.fn(async () => { throw new Error("midi"); });
    await exportSequenceMidi(broken);
    broken.importWav = vi.fn(async () => { throw new Error("wav"); });
    await importWaveFile(new File([new Uint8Array([1])], "a.wav"), broken);
  });
});
