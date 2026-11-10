import type { MutableRefObject } from "react";
import type { SdatInfo, SdatNamed, SdatSequence, SequenceEngineData, SequenceNotes, StreamPreview, WaveInfo, WavePreview } from "../transport";
import type { ResourceRef } from "../transport";
import { base64ToBytes, download } from "../util";
import { createEngine, type EngineHandle } from "../sound/engine/host";
import type { LiveEngineSlot } from "../sound/engine/liveEngineSlot";

export type SoundTab = "sequences" | "waves" | "streams" | "banks";
export type LoopPts = { start: number; end: number };

export interface SeqWav {
  index: number;
  bytes: Uint8Array;
  seconds: number;
  loopStartSec: number;
  loopEndSec: number;
}

/** When any track is soloed, only soloed tracks are audible; otherwise every non-muted track is. */
export function trackAudible(track: number, muted: boolean[], solo: boolean[]): boolean {
  return solo.some(Boolean) ? !!solo[track] : !muted[track];
}

/** Bitmask of tracks that should be heard, matching the note-roll mute/solo rules. */
export function computeTrackMask(trackCount: number, muted: boolean[], solo: boolean[]): number {
  let mask = 0;
  for (let track = 0; track < trackCount; track++) if (trackAudible(track, muted, solo)) mask |= 1 << track;
  return mask;
}

const DEMANDING_NOTE_COUNT = 1500;
const DEMANDING_SECONDS = 130;

/** Estimated playback timing from tick, tempo, and loop metadata. No render required. */
export function estimateTiming(notes: SequenceNotes): { loop: LoopPts | null; seconds: number } {
  if (notes.tempo <= 0) return { loop: null, seconds: 0 };
  const secPerTick = 1.25 / notes.tempo;
  if (notes.loopEnd > notes.loopStart && notes.loopStart >= 0) {
    const loopStartSec = notes.loopEnd * secPerTick;
    const bodySec = (notes.loopEnd - notes.loopStart) * secPerTick;
    return { loop: { start: loopStartSec, end: loopStartSec + bodySec }, seconds: loopStartSec + bodySec };
  }
  return { loop: null, seconds: notes.ticks * secPerTick };
}

/** Estimated duration in seconds. */
export function estimateSeconds(notes: SequenceNotes): number {
  return estimateTiming(notes).seconds;
}

/** True when rendering the whole sequence to WAV is likely to exhaust a phone tab. */
export function isDemandingSequence(notes: SequenceNotes): boolean {
  return notes.notes.length > DEMANDING_NOTE_COUNT || estimateSeconds(notes) > DEMANDING_SECONDS;
}

/** Loop points the rendered WAV actually repeats, or null when the loop is too short to hear. */
export function seqLoop(wav: { loopStartSec: number; loopEndSec: number }): LoopPts | null {
  if (wav.loopEndSec > wav.loopStartSec + 0.02) return { start: Math.max(0, wav.loopStartSec), end: wav.loopEndSec };
  return null;
}

/** True when the open notes are large enough to skip the rendered-WAV path. */
export function demandingSequence(notes: SequenceNotes | null): boolean {
  if (!notes) return false;
  return isDemandingSequence(notes);
}

/** Wave list shown in the panel. An unloaded archive is an empty list. */
export function waveList(waves: WaveInfo[] | null): WaveInfo[] {
  if (!waves) return [];
  return waves;
}

/** Download a stream preview when one is loaded. */
export function exportStreamPreview(preview: StreamPreview | null, info: SdatInfo | null, streamIndex: number | null): void {
  if (!preview) return;
  exportStreamFile(preview, info, streamIndex);
}

/** True when an SDAT sequence index is selected and can be played. */
export function canPlaySequence(fmt: string, seqIndex: number | null): boolean {
  return fmt === "SDAT" && seqIndex != null;
}

/** Live engine or the rendered buffer is currently sounding. */
export function soundIsPlaying(live: boolean, audioPlaying: boolean): boolean {
  return live || audioPlaying;
}

/** Playhead timing: the rendered WAV when it matches, otherwise the tempo estimate while live. */
export function playbackClock(args: {
  seqWav: SeqWav | null;
  seqIndex: number | null;
  live: boolean;
  notes: SequenceNotes | null;
}): { loop: LoopPts | null; seconds: number } {
  const wavReady = args.seqWav != null && args.seqWav.index === args.seqIndex;
  if (wavReady && args.seqWav) return { loop: seqLoop(args.seqWav), seconds: args.seqWav.seconds };
  if (args.live && args.notes) {
    const estimated = estimateTiming(args.notes);
    return { loop: estimated.loop, seconds: estimated.seconds };
  }
  return { loop: null, seconds: 0 };
}

/** Elapsed time fed to the note roll: live engine time, or the rendered buffer's clock. */
export function rollTime(live: boolean, liveSeconds: number, loop: LoopPts | null, audioTime: number, sourceTime: (elapsed: number, loop: LoopPts | null) => number): number {
  if (live) return sourceTime(liveSeconds, loop);
  return audioTime;
}

/** Sequence list after the filter box. */
export function visibleSequences(info: SdatInfo | null, filter: string): SdatSequence[] {
  if (!info) return [];
  const query = filter.trim().toLowerCase();
  if (!query) return info.sequences;
  return info.sequences.filter((seq) => sequenceMatches(seq, query));
}

/** Name or index contains the filter text. */
export function sequenceMatches(seq: { name: string | null; index: number }, query: string): boolean {
  return (seq.name || "").toLowerCase().includes(query) || String(seq.index).includes(query);
}

/** Download base name for a sequence. */
export function seqFileName(notes: { name: string | null } | null, selectionName: string): string {
  const raw = notes?.name || selectionName || "sequence";
  return raw.replace(/[^\w.-]+/g, "_");
}

/** Tab chip label including the count from the SDAT header. */
export function sdatTabLabel(tab: SoundTab, info: SdatInfo): string {
  if (tab === "sequences") return `Sequences (${info.sequences.length})`;
  if (tab === "waves") return `Waves (${info.waveArchives.length})`;
  if (tab === "streams") return `Streams (${info.streams.length})`;
  return `Banks (${info.banks.length})`;
}

/** One-line description of the open sequence. */
export function sequenceTitle(notes: SequenceNotes): string {
  return `${notes.name || "SSEQ"} · ${notes.notes.length} notes · ${notes.tempo} BPM · ${notes.trackCount} tracks`;
}

/** Placeholder that changes while `busy` equals `token`. */
export function statusPlaceholder(busy: string | null, token: string, loading: string, idle: string): string {
  if (busy === token) return loading;
  return idle;
}

/** True for the sequence pane of an SDAT or a standalone SSEQ. */
export function showSequencePane(fmt: string, tab: SoundTab): boolean {
  return (fmt === "SDAT" && tab === "sequences") || fmt === "SSEQ";
}

/** True for the wave pane of an SDAT, SWAR, or SWAV. */
export function showWavePane(fmt: string, tab: SoundTab): boolean {
  return (fmt === "SDAT" && tab === "waves") || fmt === "SWAR" || fmt === "SWAV";
}

/** True for the stream pane of an SDAT or a standalone STRM. */
export function showStreamPane(fmt: string, tab: SoundTab): boolean {
  return (fmt === "SDAT" && tab === "streams") || fmt === "STRM";
}

/** SDAT is selected but its header has not arrived. */
export function sdatOpening(fmt: string, info: SdatInfo | null): boolean {
  return fmt === "SDAT" && !info;
}

/** Extra column for a sequence row. */
export function bankExtra(item: SdatNamed): string {
  return "bank " + (item as { bankId?: number }).bankId;
}

/** Extra column for a wave-archive row. */
export function waveCountExtra(item: SdatNamed): string {
  return String((item as { waveCount?: number }).waveCount ?? "") + " waves";
}

/** File name for an exported wave. */
export function waveDownloadName(info: SdatInfo | null, arcIndex: number | null, waveIndex: number | null): string {
  const archive = info?.waveArchives.find((item) => item.index === (arcIndex ?? 0))?.name || "wave";
  return `${archive}_${waveIndex}.wav`.replace(/[^\w.-]+/g, "_");
}

/** File stem for an exported stream. */
export function streamFileBase(info: SdatInfo | null, streamIndex: number | null): string {
  const name = info?.streams.find((item) => item.index === streamIndex)?.name || "stream";
  return name.replace(/[^\w.-]+/g, "_");
}

/** Error text the viewers already surface via `(e as Error).message`. */
export function errorMessage(err: unknown): string {
  return (err as Error).message;
}

/** Decode a preview's WAV, or null when there is no preview. */
export function previewBytes(preview: { wavBase64: string } | null): Uint8Array | null {
  if (!preview) return null;
  return base64ToBytes(preview.wavBase64);
}

export interface AudioControls {
  play: (wav: Uint8Array, loop?: LoopPts | null, offset?: number) => void;
  seek: (time: number, wav?: Uint8Array, loop?: LoopPts | null) => void;
  stop: () => void;
  playing: boolean;
  currentTime: number;
  ctx: () => AudioContext;
}

interface WavClient {
  renderSequenceWav: (handle: number, ref: ResourceRef, index: number, program: number) => Promise<{ base64: string; seconds: number; loopStartSec: number; loopEndSec: number }>;
  getSequenceEngineData: (handle: number, ref: ResourceRef, index: number) => Promise<SequenceEngineData>;
  getSequenceNotes: (handle: number, ref: ResourceRef, index: number) => Promise<SequenceNotes>;
  exportSequenceMidi: (handle: number, ref: ResourceRef, index: number) => Promise<{ base64: string }>;
  getWaveArchiveInfo: (handle: number, ref: ResourceRef, index: number) => Promise<{ waves: WaveInfo[] }>;
  getWavePreview: (handle: number, ref: ResourceRef, arc: number, index: number) => Promise<WavePreview>;
  getStreamPreview: (handle: number, ref: ResourceRef, index: number) => Promise<StreamPreview>;
  getSdatInfo: (handle: number, ref: ResourceRef) => Promise<SdatInfo>;
  exportBankSf2: (handle: number, ref: ResourceRef, index: number) => Promise<{ base64: string }>;
}

export interface SoundCtx {
  fmt: string;
  seqIndex: number | null;
  notes: SequenceNotes | null;
  seqWav: SeqWav | null;
  romHandle: number;
  ref: ResourceRef;
  client: WavClient;
  audio: AudioControls;
  muted: boolean[];
  solo: boolean[];
  selectionName: string;
  setBusy: (busy: string | null) => void;
  setErr: (err: string | undefined) => void;
  setNotes: (notes: SequenceNotes | null) => void;
  setSeqIndex: (index: number | null) => void;
  setSeqWav: (wav: SeqWav | null) => void;
  setLive: (live: boolean) => void;
  setLiveSeconds: (seconds: number) => void;
  engineSlotRef: MutableRefObject<LiveEngineSlot<EngineHandle>>;
  liveGenerationRef: MutableRefObject<number>;
  goingLiveRef: MutableRefObject<boolean>;
  pendingMaskRef: MutableRefObject<number | null>;
  stopLive: () => void;
  arcIndex: number | null;
  waveIndex: number | null;
  setArcIndex: (index: number | null) => void;
  setWaveIndex: (index: number | null) => void;
  setWavePrev: (preview: WavePreview | null) => void;
  setWaves: (waves: WaveInfo[] | null) => void;
  setStreamIndex: (index: number | null) => void;
  setStreamPrev: (preview: StreamPreview | null) => void;
  importWav: (ref: ResourceRef, arc: number, wave: number, bytes: Uint8Array) => Promise<unknown>;
  info: SdatInfo | null;
}

/** Drop the live engine and forget any mask that was waiting for it. */
export function stopLiveEngine(ctx: Pick<SoundCtx, "liveGenerationRef" | "pendingMaskRef" | "engineSlotRef" | "setLive" | "setLiveSeconds">): void {
  ctx.liveGenerationRef.current += 1;
  ctx.pendingMaskRef.current = null;
  const engine = ctx.engineSlotRef.current.engine;
  ctx.engineSlotRef.current.clear();
  if (!engine) return;
  engine.node.disconnect();
  ctx.setLive(false);
  ctx.setLiveSeconds(0);
}

/** Render (or reuse) the sequence WAV. Throws when this is not an SDAT sequence. */
export async function ensureSequenceWav(ctx: SoundCtx): Promise<SeqWav> {
  if (ctx.fmt !== "SDAT" || ctx.seqIndex == null) throw new Error("sequence playback needs an SDAT");
  const cached = ctx.seqWav;
  if (cached && cached.index === ctx.seqIndex) return cached;
  const rendered = await ctx.client.renderSequenceWav(ctx.romHandle, ctx.ref, ctx.seqIndex, 0);
  const next: SeqWav = {
    index: ctx.seqIndex,
    bytes: base64ToBytes(rendered.base64),
    seconds: rendered.seconds,
    loopStartSec: rendered.loopStartSec,
    loopEndSec: rendered.loopEndSec,
  };
  ctx.setSeqWav(next);
  return next;
}

/** Whether goLive should also render WAV timing for the playhead. */
export function wantWavTiming(seqWav: SeqWav | null, seqIndex: number | null, notes: SequenceNotes): boolean {
  if (seqWav != null && seqWav.index === seqIndex) return true;
  return !isDemandingSequence(notes);
}

/** True when goLive has nothing to attach. */
export function liveBlocked(ctx: SoundCtx): boolean {
  if (ctx.fmt !== "SDAT" || ctx.seqIndex == null) return true;
  if (ctx.engineSlotRef.current.engine || !ctx.notes) return true;
  return false;
}

/** Engine bytes, plus a WAV render when that timing is cheap or already cached. */
async function enginePayload(ctx: SoundCtx): Promise<SequenceEngineData> {
  const notes = ctx.notes;
  const index = ctx.seqIndex;
  if (!notes || index == null) throw new Error("sequence playback needs an SDAT");
  if (!wantWavTiming(ctx.seqWav, index, notes)) return ctx.client.getSequenceEngineData(ctx.romHandle, ctx.ref, index);
  const both = await Promise.all([
    ensureSequenceWav(ctx),
    ctx.client.getSequenceEngineData(ctx.romHandle, ctx.ref, index),
  ]);
  return both[1];
}

/** Connect an engine that is still the one this call asked for. */
function attachLive(engine: EngineHandle, audioCtx: AudioContext, seedSeconds: number, ctx: SoundCtx): void {
  engine.node.connect(audioCtx.destination);
  ctx.audio.stop();
  ctx.setLiveSeconds(seedSeconds);
  ctx.engineSlotRef.current.set(engine, (seconds) => ctx.setLiveSeconds(seconds));
  ctx.setLive(true);
  const pending = ctx.pendingMaskRef.current;
  if (pending == null) return;
  engine.setTrackMask(pending);
  ctx.pendingMaskRef.current = null;
}

/** Clear the in-flight flag and retry a mask that arrived too late to apply. */
function finishGoLive(ctx: SoundCtx): void {
  ctx.goingLiveRef.current = false;
  ctx.setBusy(null);
  const stillPending = ctx.pendingMaskRef.current;
  if (stillPending == null || ctx.engineSlotRef.current.engine) return;
  ctx.pendingMaskRef.current = null;
  void goLive(stillPending, ctx);
}

/** Switch playback to the live mixing engine, seeded at the current position. */
export async function goLive(mask: number, ctx: SoundCtx): Promise<void> {
  if (liveBlocked(ctx)) return;
  if (ctx.goingLiveRef.current) {
    ctx.pendingMaskRef.current = mask;
    return;
  }
  ctx.goingLiveRef.current = true;
  const myGeneration = ctx.liveGenerationRef.current;
  const seedSeconds = ctx.audio.currentTime;
  ctx.setBusy("engine");
  try {
    const engineData = await enginePayload(ctx);
    const audioCtx = ctx.audio.ctx();
    const engine = await createEngine(audioCtx, engineData, { seedSeconds, trackMask: mask });
    if (ctx.liveGenerationRef.current !== myGeneration) {
      engine.node.disconnect();
      return;
    }
    attachLive(engine, audioCtx, seedSeconds, ctx);
  } catch (err) {
    alert("Live engine failed to start: " + errorMessage(err));
  } finally {
    finishGoLive(ctx);
  }
}

/** Play the selected sequence, using the live engine when a full render would be too large. */
export async function playSequence(ctx: SoundCtx): Promise<void> {
  if (!canPlaySequence(ctx.fmt, ctx.seqIndex) || !ctx.notes) return;
  if (isDemandingSequence(ctx.notes)) {
    await goLive(computeTrackMask(ctx.notes.trackCount, ctx.muted, ctx.solo), ctx);
    return;
  }
  ctx.setBusy("render");
  try {
    const wav = await ensureSequenceWav(ctx);
    ctx.audio.play(wav.bytes, seqLoop(wav));
  } catch (err) {
    alert("Render failed: " + errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

const EXPORT_WARN =
  "This is a large sequence. Rendering the full WAV to export it can use a lot of memory and " +
  "may crash the page on some devices (notably iOS Safari). Continue?";

/** Download the sequence WAV, confirming first when the song is large. */
export async function exportSequenceWav(ctx: SoundCtx): Promise<void> {
  if (!canPlaySequence(ctx.fmt, ctx.seqIndex)) return;
  if (demandingSequence(ctx.notes) && !window.confirm(EXPORT_WARN)) return;
  ctx.setBusy("render");
  try {
    const wav = await ensureSequenceWav(ctx);
    download(`${seqFileName(ctx.notes, ctx.selectionName)}.wav`, wav.bytes, "audio/wav");
  } catch (err) {
    alert("WAV export failed: " + errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Download a MIDI rendering of the sequence. */
export async function exportSequenceMidi(ctx: SoundCtx): Promise<void> {
  if (ctx.seqIndex == null && ctx.fmt !== "SSEQ") return;
  ctx.setBusy("midi");
  try {
    const rendered = await ctx.client.exportSequenceMidi(ctx.romHandle, ctx.ref, ctx.seqIndex ?? 0);
    download(`${seqFileName(ctx.notes, ctx.selectionName)}.mid`, base64ToBytes(rendered.base64), "audio/midi");
  } catch (err) {
    alert("MIDI export failed: " + errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Copy mute/solo flags out to the track count, flipping `track`. */
export function nextTrackFlags(kind: "mute" | "solo", track: number, muted: boolean[], solo: boolean[], count: number): { muted: boolean[]; solo: boolean[] } {
  const source = kind === "mute" ? muted : solo;
  const next = Array.from({ length: count }, (_, index) => source[index] ?? false);
  next[track] = !next[track];
  if (kind === "mute") return { muted: next, solo };
  return { muted, solo: next };
}

/** Send a mask to the running engine, or start the engine with it. */
function applyMask(mask: number, ctx: SoundCtx): void {
  const engine = ctx.engineSlotRef.current.engine;
  if (engine) engine.setTrackMask(mask);
  else void goLive(mask, ctx);
}

/** Toggle mute or solo and keep the engine's mask in step. */
export function toggleTrack(kind: "mute" | "solo", track: number, ctx: SoundCtx, setMuted: (flags: boolean[]) => void, setSolo: (flags: boolean[]) => void): void {
  if (!ctx.notes) return;
  const next = nextTrackFlags(kind, track, ctx.muted, ctx.solo, ctx.notes.trackCount);
  if (kind === "mute") setMuted(next.muted);
  else setSolo(next.solo);
  applyMask(computeTrackMask(ctx.notes.trackCount, next.muted, next.solo), ctx);
}

/** Load one sequence's notes. */
export async function loadSequence(index: number, ctx: SoundCtx): Promise<void> {
  ctx.setSeqIndex(index);
  ctx.setSeqWav(null);
  ctx.setBusy("notes");
  ctx.audio.stop();
  ctx.stopLive();
  try {
    ctx.setNotes(await ctx.client.getSequenceNotes(ctx.romHandle, ctx.ref, index));
  } catch (err) {
    ctx.setErr(errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Load one wave archive's listing. */
export async function loadArchive(index: number, ctx: SoundCtx): Promise<void> {
  ctx.setArcIndex(index);
  ctx.setWaveIndex(null);
  ctx.setWavePrev(null);
  ctx.setBusy("waves");
  try {
    ctx.setWaves((await ctx.client.getWaveArchiveInfo(ctx.romHandle, ctx.ref, index)).waves);
  } catch (err) {
    ctx.setErr(errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Load one wave's preview. */
export async function loadWave(index: number, ctx: SoundCtx): Promise<void> {
  ctx.setWaveIndex(index);
  ctx.setBusy("wave");
  ctx.audio.stop();
  try {
    ctx.setWavePrev(await ctx.client.getWavePreview(ctx.romHandle, ctx.ref, ctx.arcIndex ?? 0, index));
  } catch (err) {
    ctx.setErr(errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Load one stream's preview. */
export async function loadStream(index: number, ctx: SoundCtx): Promise<void> {
  ctx.setStreamIndex(index);
  ctx.setBusy("stream");
  ctx.audio.stop();
  try {
    ctx.setStreamPrev(await ctx.client.getStreamPreview(ctx.romHandle, ctx.ref, index));
  } catch (err) {
    ctx.setErr(errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Replace a wave with an imported WAV and refresh the listing. */
export async function importWaveFile(file: File, ctx: SoundCtx): Promise<void> {
  if (ctx.waveIndex == null) return;
  ctx.setBusy("import");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const arc = ctx.arcIndex ?? 0;
    await ctx.importWav(ctx.ref, arc, ctx.waveIndex, bytes);
    ctx.setWavePrev(await ctx.client.getWavePreview(ctx.romHandle, ctx.ref, arc, ctx.waveIndex));
    if (ctx.fmt === "SDAT" || ctx.fmt === "SWAR") {
      ctx.setWaves((await ctx.client.getWaveArchiveInfo(ctx.romHandle, ctx.ref, arc)).waves);
    }
  } catch (err) {
    alert("WAV import failed: " + errorMessage(err));
  } finally {
    ctx.setBusy(null);
  }
}

/** Play a wave or stream preview when one is loaded. */
export function playPreview(preview: { wavBase64: string } | null, audio: AudioControls): void {
  if (!preview) return;
  audio.play(base64ToBytes(preview.wavBase64));
}

/** Seek a decoded buffer when one is loaded. */
export function seekWave(time: number, bytes: Uint8Array | null, audio: AudioControls): void {
  if (!bytes) return;
  audio.seek(time, bytes);
}

/** Download the selected wave preview. */
export function exportWaveFile(preview: WavePreview | null, info: SdatInfo | null, arcIndex: number | null, waveIndex: number | null): void {
  if (!preview) return;
  download(waveDownloadName(info, arcIndex, waveIndex), base64ToBytes(preview.wavBase64), "audio/wav");
}

/** Download the selected stream. */
export function exportStreamFile(preview: StreamPreview, info: SdatInfo | null, streamIndex: number | null): void {
  download(`${streamFileBase(info, streamIndex)}.wav`, base64ToBytes(preview.wavBase64), "audio/wav");
}

/** Download one bank as a SoundFont. */
export function exportBank(index: number, ctx: SoundCtx): void {
  ctx.setBusy("sf2");
  ctx.client
    .exportBankSf2(ctx.romHandle, ctx.ref, index)
    .then((rendered) => {
      const name = ctx.info?.banks.find((bank) => bank.index === index)?.name || `bank${index}`;
      download(`${name.replace(/[^\w.-]+/g, "_")}.sf2`, base64ToBytes(rendered.base64));
    })
    .catch((err: unknown) => alert("SoundFont export failed: " + errorMessage(err)))
    .finally(() => ctx.setBusy(null));
}

/** Apply an SDAT header when the request is still current. */
function takeSdat(alive: boolean, info: SdatInfo, setInfo: (info: SdatInfo) => void): void {
  if (!alive) return;
  setInfo(info);
}

/** Apply a standalone sequence when the request is still current. */
function takeSseq(alive: boolean, notes: SequenceNotes, setNotes: (notes: SequenceNotes) => void, setSeqIndex: (index: number) => void): void {
  if (!alive) return;
  setNotes(notes);
  setSeqIndex(0);
}

/** Apply a standalone wave when the request is still current. */
function takeSwav(alive: boolean, preview: WavePreview, setWavePrev: (preview: WavePreview) => void, setWaves: (waves: WaveInfo[]) => void, setWaveIndex: (index: number) => void): void {
  if (!alive) return;
  setWavePrev(preview);
  setWaves([{ index: 0, sampleRate: preview.sampleRate, samples: preview.samples, type: preview.type, loops: preview.loops }]);
  setWaveIndex(0);
}

/** Record a load error when the request is still current. */
function takeErr(alive: boolean, err: unknown, setErr: (message: string) => void): void {
  if (!alive) return;
  setErr(errorMessage(err));
}

/** Load whichever document the selected format is. */
export function loadSoundDocument(
  fmt: string,
  alive: () => boolean,
  ctx: Pick<SoundCtx, "client" | "romHandle" | "ref">,
  set: {
    info: (info: SdatInfo) => void;
    notes: (notes: SequenceNotes) => void;
    seqIndex: (index: number) => void;
    waves: (waves: WaveInfo[]) => void;
    wavePrev: (preview: WavePreview) => void;
    waveIndex: (index: number) => void;
    stream: (preview: StreamPreview) => void;
    err: (message: string) => void;
  },
): void {
  const { client, romHandle, ref } = ctx;
  if (fmt === "SDAT") {
    client.getSdatInfo(romHandle, ref).then((info) => takeSdat(alive(), info, set.info)).catch((err: unknown) => takeErr(alive(), err, set.err));
    return;
  }
  if (fmt === "SSEQ") {
    client.getSequenceNotes(romHandle, ref, 0).then((notes) => takeSseq(alive(), notes, set.notes, set.seqIndex)).catch((err: unknown) => takeErr(alive(), err, set.err));
    return;
  }
  if (fmt === "SWAR") {
    client.getWaveArchiveInfo(romHandle, ref, 0).then((info) => { if (alive()) set.waves(info.waves); }).catch((err: unknown) => takeErr(alive(), err, set.err));
    return;
  }
  if (fmt === "SWAV") {
    client.getWavePreview(romHandle, ref, 0, 0).then((preview) => takeSwav(alive(), preview, set.wavePrev, set.waves, set.waveIndex)).catch((err: unknown) => takeErr(alive(), err, set.err));
    return;
  }
  if (fmt === "STRM") {
    client.getStreamPreview(romHandle, ref, 0).then((preview) => { if (alive()) set.stream(preview); }).catch((err: unknown) => takeErr(alive(), err, set.err));
  }
}
