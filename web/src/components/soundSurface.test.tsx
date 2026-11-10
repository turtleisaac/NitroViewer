// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the stubs only hand back a value */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SdatInfo, SequenceNotes } from "../transport";
import { useStore } from "../state/store";
import type { SoundCtx } from "./soundViewerLogic";
import {
  ArchiveList,
  BankPane,
  PlayFace,
  SdatTabBar,
  seekLiveOrWav,
  seekSequenceTick,
  seekTiming,
  SequenceControls,
  SoundBody,
  SoundViewer,
  StreamList,
  wavToBuffer,
} from "./SoundViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const info: SdatInfo = {
  sequences: [{ index: 1, name: "Town", bankId: 2 }],
  banks: [{ index: 4, name: "piano" }],
  waveArchives: [{ index: 0, name: "drums", waveCount: 2 }],
  streams: [{ index: 6, name: "rain" }],
  sequenceArchives: [],
};

const notes: SequenceNotes = {
  ticks: 20, tempo: 120, trackCount: 1, loopStart: -1, loopEnd: 0, bankId: 0, name: "Town", notes: [],
};

function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(node); });
  return { host, root };
}

function le(bytes: number, value: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  if (bytes === 2) view.setUint16(0, value, true);
  else view.setUint32(0, value, true);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function text(value: string): Uint8Array {
  return Uint8Array.from(value, (ch) => ch.charCodeAt(0));
}

describe("sound surfaces", () => {
  const roots: Root[] = [];
  it("renders each sound pane and play face", () => {
    const on = vi.fn();
    const pieces = [
      createElement(SoundBody, { err: "nope", opening: false }),
      createElement(SoundBody, { err: undefined, opening: true }),
      createElement(SoundBody, { err: undefined, opening: false }, "ok"),
      createElement(SdatTabBar, { fmt: "SSEQ", info: null, tab: "sequences", setTab: on }),
      createElement(SdatTabBar, { fmt: "SDAT", info, tab: "waves", setTab: on }),
      createElement(PlayFace, { busy: "render", isPlaying: false }),
      createElement(PlayFace, { busy: "engine", isPlaying: false }),
      createElement(PlayFace, { busy: null, isPlaying: true }),
      createElement(PlayFace, { busy: null, isPlaying: false }),
      createElement(SequenceControls, {
        notes, canPlay: true, busy: "render", isPlaying: true,
        onPlay: on, onStop: on, onExportWav: on, onExportMidi: on,
      }),
      createElement(SequenceControls, {
        notes, canPlay: false, busy: null, isPlaying: false,
        onPlay: on, onStop: on, onExportWav: on, onExportMidi: on,
      }),
      createElement(ArchiveList, { fmt: "SDAT", info, arcIndex: 0, onSelect: on }),
      createElement(ArchiveList, { fmt: "SWAV", info: null, arcIndex: null, onSelect: on }),
      createElement(StreamList, { fmt: "SDAT", info, streamIndex: 6, onSelect: on }),
      createElement(StreamList, { fmt: "STRM", info: null, streamIndex: null, onSelect: on }),
      createElement(BankPane, { fmt: "SDAT", tab: "banks", info, onSelect: on }),
      createElement(BankPane, { fmt: "SDAT", tab: "sequences", info, onSelect: on }),
    ];
    for (const piece of pieces) {
      const view = mount(piece);
      roots.push(view.root);
    }
    const tabs = document.body.textContent ?? "";
    expect(tabs).toContain("Could not open audio");
    expect(tabs).toContain("Opening SDAT");
    expect(tabs).toContain("Rendering");
    expect(tabs).toContain("Starting");
    act(() => { for (const root of roots) root.unmount(); });
  });

  it("seeks through the rendered buffer and the live engine", async () => {
    const alerted = vi.fn();
    window.alert = alerted;
    const engine = { seek: vi.fn(), node: { disconnect() { return undefined; }, connect() { return undefined; } }, setTrackMask: vi.fn(), onPosition: () => () => undefined, onEnded: () => () => undefined };
    const ctx = {
      fmt: "SDAT",
      seqIndex: 1,
      notes,
      seqWav: null,
      romHandle: 1,
      ref: { container: -1, id: 1 },
      client: { renderSequenceWav: vi.fn(async () => ({ base64: "QQ==", seconds: 2, loopStartSec: 0, loopEndSec: 1 })) },
      audio: { play: vi.fn(), seek: vi.fn(), stop: vi.fn(), playing: false, currentTime: 0, ctx: () => ({ destination: {} }) },
      muted: [],
      solo: [],
      selectionName: "song",
      setBusy: vi.fn(),
      setErr: vi.fn(),
      setNotes: vi.fn(),
      setSeqIndex: vi.fn(),
      setSeqWav: vi.fn(),
      setLive: vi.fn(),
      setLiveSeconds: vi.fn(),
      engineSlotRef: { current: { engine: null, clear() { return undefined; }, set() { return undefined; } } },
      liveGenerationRef: { current: 0 },
      goingLiveRef: { current: false },
      pendingMaskRef: { current: null },
      stopLive: vi.fn(),
      arcIndex: 0,
      waveIndex: 0,
      setArcIndex: vi.fn(),
      setWaveIndex: vi.fn(),
      setWavePrev: vi.fn(),
      setWaves: vi.fn(),
      setStreamIndex: vi.fn(),
      setStreamPrev: vi.fn(),
      importWav: vi.fn(),
      info: null,
    } as unknown as SoundCtx;
    expect(seekTiming(ctx, notes).seconds).toBeGreaterThan(0);
    ctx.seqWav = { index: 1, bytes: new Uint8Array([1]), seconds: 3, loopStartSec: 0, loopEndSec: 2 };
    expect(seekTiming(ctx, notes).seconds).toBe(3);
    await seekLiveOrWav(4, ctx, notes);
    expect(ctx.audio.seek).toHaveBeenCalled();
    (ctx.engineSlotRef.current as unknown as { engine: typeof engine | null }).engine = engine;
    await seekLiveOrWav(4, ctx, notes);
    expect(engine.seek).toHaveBeenCalled();
    ctx.notes = null;
    await seekSequenceTick(1, ctx);
    ctx.notes = notes;
    ctx.seqWav = null;
    (ctx.engineSlotRef.current as unknown as { engine: typeof engine | null }).engine = null;
    ctx.client.renderSequenceWav = vi.fn(async () => { throw new Error("no"); });
    await seekSequenceTick(1, ctx);
    expect(alerted).toHaveBeenCalled();
  });

  it("decodes a wav that has a chunk before the samples", () => {
    const samples = new Uint8Array(4);
    new DataView(samples.buffer).setInt16(2, 16384, true);
    const fmt = join([text("fmt "), le(4, 16), le(2, 1), le(2, 1), le(4, 8000), le(4, 16000), le(2, 2), le(2, 16)]);
    const junk = join([text("JUNK"), le(4, 1), new Uint8Array([0, 0])]);
    const data = join([text("data"), le(4, samples.length), samples]);
    const body = join([text("WAVE"), fmt, junk, data]);
    const wav = join([text("RIFF"), le(4, body.length), body]);
    const ctx = {
      createBuffer: (channels: number, frames: number, rate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(frames));
        return {
          duration: frames / rate,
          sampleRate: rate,
          getChannelData: (channel: number) => data[channel],
        };
      },
    } as unknown as AudioContext;
    const buf = wavToBuffer(ctx, wav);
    expect(buf.sampleRate).toBe(8000);
    expect(buf.getChannelData(0)[1]).toBeCloseTo(0.5);
  });

  it("opens an SDAT and lists its sequences", async () => {
    class FakeAudio {
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createBuffer(_c: number, frames: number, rate: number) {
        return { duration: frames / rate, sampleRate: rate, getChannelData: () => new Float32Array(frames) };
      }
      createBufferSource() {
        return { buffer: null, connect() { return undefined; }, start() { return undefined; }, stop() { return undefined; }, disconnect() { return undefined; }, loop: false, onended: null };
      }
    }
    vi.stubGlobal("AudioContext", FakeAudio);
    useStore.setState({
      romHandle: 1,
      selection: { ref: { container: -1, id: 1 }, name: "sound.sdat", format: "SDAT", compressed: false, size: 4 },
      client: {
        ...useStore.getState().client,
        getSdatInfo: async () => info,
      },
    });
    const view = mount(createElement(SoundViewer));
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(view.host.textContent).toContain("Sequences");
    act(() => view.root.unmount());
  });
});
