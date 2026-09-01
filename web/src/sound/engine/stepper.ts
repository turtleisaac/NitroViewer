// A from-scratch JS port of Nds4j's SequencePlayer (io.github.turtleisaac.nds4j.sound), the
// hardware-accurate DS SDAT software synthesizer: 16 tracks (bytecode VMs) driving up to 16
// hardware voices, a 192 Hz envelope/LFO driver, and a 65456 Hz drop-sample mixer. This file is
// the per-frame half of the port; load.ts turns the wire-format SequenceEngineData into the typed
// arrays this reads. Every table/formula below is transcribed from (or directly mirrors the
// integer semantics of) SequencePlayer.java / DsSynth.java / DsEnvelope.java — see tables.ts for
// the literal lookup tables. Deliberately NOT ported: SSEQ 0xA0/0xA1/0xA2 (random/fromvar/if) and
// 0xB0-0xBD (variable ops) have no effect in the Java reference either — only their bytes are
// consumed so the stream stays aligned. Same for LFO volume/pan targets (modType 1/2): Java parses
// but does not apply them beyond the pitch target (modType 0); ported as-is, not "fixed".
import { ATTACK_TABLE, DECAY_TABLE, PITCH_TABLE, SIN_TABLE, SUSTAIN_TABLE, VOLUME_TABLE } from "./tables";
import { resolveRegion, type LoadedSequence, type LoadedWave } from "./load";

const MAX_TRACKS = 16;
const MAX_VOICES = 16;
const MIX_RATE = 65456;
const MIX_SAMPLES_PER_FRAME = 341;
const ENV_SILENT = -92544;
const EMPTY_PCM = new Int16Array(0);

// ---------------------------------------------------------------- DsSynth ports

/** DsSynth.sin: quarter-wave LFO sine, 7-bit phase -> -127..127. */
function dsSin(index: number): number {
  index &= 0x7f;
  if (index < 0x20) return SIN_TABLE[index];
  if (index < 0x40) return SIN_TABLE[0x40 - index];
  if (index < 0x60) return -SIN_TABLE[index - 0x40];
  return -SIN_TABLE[0x80 - index];
}

/** DsSynth.advanceLfoPhase. */
function advanceLfoPhase(phase: number, speed: number): number {
  const step = speed << 6;
  let counter = (phase + step) >> 8;
  while (counter >= 0x80) counter -= 0x80;
  let newPhase = (phase + step) & 0xff;
  newPhase |= counter << 8;
  return newPhase & 0xffff;
}

/** DsSynth.psgSquare. */
function psgSquare(counter: number, duty: number): number {
  return (counter & 7) <= duty ? -0x8000 : 0x7fff;
}

/** DsSynth.noiseStep: one step of the 16-bit LFSR (poly 0x6000), mutating v.noiseLfsr in place
 *  (avoids allocating a [sample, nextState] tuple on every sample of every active noise voice). */
function noiseStep(v: Voice): number {
  let c = v.noiseLfsr & 0xffff;
  let samp: number;
  if (c & 1) {
    c = (c >>> 1) ^ 0x6000;
    samp = -0x7fff;
  } else {
    c = c >>> 1;
    samp = 0x7fff;
  }
  v.noiseLfsr = c & 0xffff;
  return samp;
}

/**
 * DsSynth.channelTimer. Uses BigInt for exact 64-bit-long fidelity with the Java source (the
 * intermediate product and shift can exceed the 32-bit range Java's `int` arithmetic would silently
 * wrap on, and this is the one place that distinction is worth not hand-waving away with floats).
 */
function channelTimer(baseTimer: number, pitchUnits: number): number {
  let shift = 0;
  let pitch = -pitchUnits;
  while (pitch < 0) {
    shift--;
    pitch += 0x300;
  }
  while (pitch >= 0x300) {
    shift++;
    pitch -= 0x300;
  }
  let timer = (BigInt(PITCH_TABLE[pitch]) + 0x10000n) * BigInt(baseTimer & 0xffff);
  shift -= 16;
  if (shift <= 0) {
    timer >>= BigInt(-shift);
  } else if (shift < 32) {
    if ((timer & (-1n << BigInt(32 - shift))) !== 0n) return 0xffff;
    timer <<= BigInt(shift);
  } else {
    return 0xffff;
  }
  if (timer < 0x10n) return 0x10;
  if (timer > 0xffffn) return 0xffff;
  return Number(timer);
}

// -------------------------------------------------------------- DsEnvelope ports

function attackRate(attack: number): number {
  return ATTACK_TABLE[attack & 0x7f];
}
function getFallingRate(t: number): number {
  return DECAY_TABLE[t & 0x7f];
}
/** DsEnvelope.channelVolume: summed attenuation -> hardware 0..127 channel volume. */
function channelVolume(vol: number): number {
  let a = Math.trunc(vol / 0x80);
  if (a < -723) a = -723;
  else if (a > 0) a = 0;
  return VOLUME_TABLE[a + 723] & 0xff;
}

function clamp7(x: number): number {
  return x < 0 ? 0 : x > 127 ? 127 : x;
}
function clip16(v: number): number {
  if (v > 32767) v = 32767;
  if (v < -32768) v = -32768;
  return v | 0;
}

// ---------------------------------------------------------------------- track VM

export class Track {
  allocated = false;
  enabled = false;
  stopped = false;
  pc = 0;
  wait = 0;
  program = 0;
  volume = 127;
  expression = 127;
  pan = 64;
  transpose = 0;
  pitchBend = 0;
  bendRange = 2;
  priority = 64;
  modDepth = 0;
  modSpeed = 16;
  modType = 0;
  modRange = 1;
  modDelay = 0;
  lfoPhase = 0;
  lfoDelayCount = 0;
  sweepPitch = 0;
  portamentoKey = 60;
  portamentoOn = false;
  portamentoTime = 0;
  noteWait = true;
  tie = false;
  waitingForNote = false;
  loopJumps = 0;
  firstJumpFrame = -1;
  secondJumpFrame = -1;
  attackOv = 0xff;
  decayOv = 0xff;
  sustainOv = 0xff;
  releaseOv = 0xff;
  callStack: number[] = [0, 0, 0];
  callStackLoops: number[] = [0, 0, 0];
  callDepth = 0;
}

export class Voice {
  samples: Int16Array = EMPTY_PCM;
  isPsg = false;
  isNoise = false;
  duty = 0;
  noiseLfsr = 0x7fff;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  velocity = 0;
  key = 0;
  baseKey = 0;
  baseTimer = 16;
  timer = 16;
  timerPos = 0;
  waveIndex = 0;
  lastSamp = 0;
  psgCounter = 0;
  autoSweep = false;
  sweepPitch = 0;
  sweepLength = 0;
  sweepCounter = 0;
  envState = 0; // 0 attack, 2 decay, 3 sustain, 4 release
  envVelocity = 0;
  envAtk = 0;
  envDec = 0;
  envSus = 0;
  envRel = 0;
  noteDuration = 0;
  dead = false;
  trackId = -1;
  priority = 64;
  regionPan = 0;
  volByte = 0;
  pan = 0;
  serial = 0;
}

export interface LoopPoints {
  startFrame: number;
  endFrame: number;
}

/**
 * Incremental port of SequencePlayer: instead of one monolithic renderStereo() call producing a
 * whole buffer, stepSample() produces at most one output-rate stereo sample per call — null once
 * the sequence has ended, so callers never mistake a "nothing left to produce" bail for a real
 * (possibly silent) sample. That's the primitive both the realtime AudioWorklet (call it per
 * process() quantum) and an offline fast-forward/verification run (call it in a tight loop, keeping
 * or discarding the output) share — see stepper.test.ts / the fixture-diff harness for the offline use.
 */
export class Stepper {
  readonly outRate: number;
  /** SSEQ track i is heard when true. A muted track still runs (keeps timing), matching
   *  SequencePlayer.trackEnabled — this is the live mute/solo control surface. */
  readonly trackEnabled: boolean[] = new Array(MAX_TRACKS).fill(true);
  /** When true, a track's second 0x94 jump stops it instead of looping — one full playthrough. */
  stopAtLoop = false;

  private readonly seq: LoadedSequence;
  private readonly tracks: Track[] = [];
  private readonly channels: (Voice | null)[] = new Array(MAX_VOICES).fill(null);
  private allocSerial = 0;
  private tempo = 120;
  private playerVolume = 127;
  private tempoStack = 0;
  private emitAcc = 0;
  private mixerIncAcc = 0;
  private frame = 0;
  private renderFrame = 0;
  private samplesRemainingInDriverFrame = 0;
  private silentFrames = 0;
  private ended = false;
  // Reused across every stepSample() call instead of allocating a fresh tuple per sample — this
  // runs inside the AudioWorklet's real-time render thread, where per-sample GC pressure is a
  // direct source of audio glitches. Safe because no caller holds the reference across calls (every
  // caller reads sampleOut[0]/[1] immediately, matching the offline callers' scalar-push pattern).
  private readonly sampleOut: [number, number] = [0, 0];

  dbgNotes = 0;
  dbgDropped = 0;

  constructor(seq: LoadedSequence, outRate: number) {
    this.seq = seq;
    this.outRate = outRate;
    for (let i = 0; i < MAX_TRACKS; i++) {
      const t = new Track();
      t.allocated = t.enabled = i === 0;
      this.tracks.push(t);
    }
  }

  /** Whether the sequence has naturally finished (all tracks stopped, no live voices, silence). */
  get done(): boolean {
    return this.ended;
  }
  /** Output-rate frames produced so far — the realtime host's position-report clock. */
  get currentFrame(): number {
    return this.frame;
  }

  /** Test/debug introspection only (mirrors SequencePlayer's own public dbg* counters) — a
   *  read-only snapshot of one track's bytecode-VM state, for asserting exact opcode semantics. */
  getTrackDebug(trackId: number): Readonly<Track> {
    return { ...this.tracks[trackId] };
  }
  get tempoDebug(): number {
    return this.tempo;
  }
  get playerVolumeDebug(): number {
    return this.playerVolume;
  }
  get liveVoiceCountDebug(): number {
    return this.liveVoices();
  }
  /** Test/debug introspection only — a read-only snapshot of one hardware channel slot (0-15). */
  getChannelDebug(slot: number): Readonly<Voice> | null {
    const v = this.channels[slot];
    return v == null ? null : { ...v };
  }

  getLoopPoints(): LoopPoints | null {
    let bestStart = -1,
      bestEnd = -1,
      bestPeriod = -1;
    for (const t of this.tracks) {
      if (t.firstJumpFrame < 0 || t.secondJumpFrame <= t.firstJumpFrame) continue;
      const p = t.secondJumpFrame - t.firstJumpFrame;
      if (p > bestPeriod) {
        bestPeriod = p;
        bestStart = t.firstJumpFrame;
        bestEnd = t.secondJumpFrame;
      }
    }
    return bestPeriod > 0 ? { startFrame: bestStart, endFrame: bestEnd } : null;
  }

  /**
   * Advance to (and stop at) `targetFrame` without producing audible output, preserving every bit
   * of track/voice/envelope state exactly as if stepSample() had been called that many times. This
   * is the seek/seed primitive: the realtime engine fast-forwards here before switching a playing
   * WAV-rendered source over to itself.
   */
  fastForward(targetFrame: number): void {
    while (this.frame < targetFrame && !this.ended) this.stepSample();
  }

  /** Produce one interleaved stereo sample [left, right], each a clipped int16 — or null once the
   *  sequence has ended (nothing was produced; do not treat this as a silent sample). */
  stepSample(): [number, number] | null {
    if (this.ended) return null;
    if (this.samplesRemainingInDriverFrame <= 0) {
      // Driver-frame boundary: matches renderStereo's outer-loop check
      // (`if (done || (allTracksDone() && liveVoices()==0)) break;`), which runs once per driver
      // frame *after* that frame's whole ~114-sample batch (at a typical 22050 Hz output rate) —
      // not per individual sample. The silence-timeout stop below is checked per sample instead,
      // matching the inner-loop check it corresponds to.
      if (this.allTracksDone() && this.liveVoices() === 0) {
        this.ended = true;
        return null;
      }
      this.runDriverFrame();
    }

    this.mixerIncAcc += MIX_RATE << 8;
    let mixerInc = Math.trunc(this.mixerIncAcc / this.outRate);
    this.mixerIncAcc %= this.outRate;
    if (mixerInc < 1) mixerInc = 1;

    let left = 0,
      right = 0;
    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.channels[vi];
      if (v == null || v.dead) continue;
      const samp = this.sampleVoice(v, mixerInc);
      if (v.dead) continue;
      const vol = v.volByte;
      const pan = v.pan;
      const l = Math.trunc((samp * vol) / 0x7f);
      const r = Math.trunc((samp * vol) / 0x7f);
      left += Math.trunc((l * (-pan + 0x40)) / 0x80);
      right += Math.trunc((r * (pan + 0x40)) / 0x80);
    }
    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.channels[vi];
      if (v != null && v.dead) this.channels[vi] = null;
    }

    if (this.allTracksDone()) {
      // Inner-loop check: a half-second of near-silence stops immediately, mid-driver-frame-batch,
      // matching Java exactly. The liveVoices()==0 check is the *outer*-loop condition — see the
      // driver-frame boundary above, not here.
      if (Math.abs(left) < 4 && Math.abs(right) < 4) {
        if (++this.silentFrames > this.outRate / 2) this.ended = true;
      } else this.silentFrames = 0;
    }

    this.samplesRemainingInDriverFrame--;
    this.frame++;
    this.sampleOut[0] = clip16(left);
    this.sampleOut[1] = clip16(right);
    return this.sampleOut;
  }

  private runDriverFrame(): void {
    this.renderFrame = this.frame;
    while (this.tempoStack >= 240) {
      this.tempoStack -= 240;
      this.stepTick();
    }
    let t = this.tempo;
    if (t < 1) t = 1;
    this.tempoStack += t;
    this.channelTick();

    this.emitAcc += MIX_SAMPLES_PER_FRAME * this.outRate;
    let n = Math.trunc(this.emitAcc / MIX_RATE);
    this.emitAcc %= MIX_RATE;
    if (n < 1) n = 1;
    this.samplesRemainingInDriverFrame = n;
  }

  // ------------------------------------------------------------- envelope / mixer

  private sampleVoice(v: Voice, inc: number): number {
    if (v.dead) return 0;
    const tim = v.timer < 16 ? 16 : v.timer;
    const num = Math.trunc((v.timerPos + inc) / tim);
    v.timerPos = (v.timerPos + inc) % tim;
    for (let n = 0; n < num; n++) {
      if (v.isPsg) {
        v.lastSamp = psgSquare(v.psgCounter, v.duty);
        v.psgCounter = (v.psgCounter + 1) & 7;
      } else if (v.isNoise) {
        v.lastSamp = noiseStep(v);
      } else {
        if (v.samples.length === 0) {
          v.lastSamp = 0;
          break;
        }
        let end = v.samples.length;
        if (v.loop && v.loopEnd > v.loopStart && v.loopEnd <= v.samples.length) end = v.loopEnd;
        if (v.waveIndex >= end) {
          if (v.loop) v.waveIndex = v.loopStart;
          else {
            v.lastSamp = 0;
            v.dead = true;
            return 0;
          }
        }
        if (v.waveIndex >= 0 && v.waveIndex < v.samples.length) v.lastSamp = v.samples[v.waveIndex];
        v.waveIndex++;
      }
    }
    return v.lastSamp;
  }

  private channelTick(): void {
    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.channels[vi];
      if (v == null || v.dead) continue;
      const tr = v.trackId >= 0 && v.trackId < MAX_TRACKS ? this.tracks[v.trackId] : null;
      this.stepEnvelope(v);
      if (v.noteDuration === 0 && (tr == null || !tr.waitingForNote)) v.envState = 4;

      let lfoPitch = 0,
        lfoVol = 0,
        lfoPan = 0;
      if (tr != null) {
        const lfoRaw = tr.modDepth !== 0 ? tr.modRange * dsSin(tr.lfoPhase >> 8) * tr.modDepth : 0;
        if (tr.modType === 0) lfoPitch = (lfoRaw * 60) >> 14;
        else if (tr.modType === 1) lfoVol = scaleLfoVolPan(lfoRaw);
        else if (tr.modType === 2) lfoPan = scaleLfoVolPan(lfoRaw);
      }

      const units =
        ((v.key - v.baseKey) << 6) +
        this.sweepMain(v) +
        (tr == null ? 0 : Math.trunc((tr.pitchBend * tr.bendRange) / 2)) +
        lfoPitch;
      v.timer = channelTimer(v.baseTimer, units);

      const vol = tr == null ? 127 : tr.volume;
      const expr = tr == null ? 127 : tr.expression;
      const atten =
        v.envVelocity +
        SUSTAIN_TABLE[clamp7(v.velocity)] +
        SUSTAIN_TABLE[clamp7(vol)] +
        SUSTAIN_TABLE[clamp7(expr)] +
        SUSTAIN_TABLE[clamp7(this.playerVolume)] +
        lfoVol;
      if (v.envState === 4 && atten <= ENV_SILENT) {
        v.dead = true;
        continue;
      }
      v.volByte = channelVolume(atten);

      let panPot = v.regionPan + (tr == null ? 0 : tr.pan - 64) + lfoPan;
      if (panPot < -64) panPot = -64;
      if (panPot > 63) panPot = 63;
      v.pan = panPot;
    }
  }

  /** SequencePlayer.sweepMain: remainder of the glide; autoSweep steps at 192 Hz. */
  private sweepMain(v: Voice): number {
    if (v.sweepPitch !== 0 && v.sweepCounter < v.sweepLength) {
      const sweep = Math.trunc((v.sweepPitch * (v.sweepLength - v.sweepCounter)) / v.sweepLength);
      if (v.autoSweep) v.sweepCounter++;
      return sweep;
    }
    return 0;
  }

  private stepEnvelope(v: Voice): void {
    switch (v.envState) {
      case 0: // attack
        v.envVelocity = Math.trunc((v.envAtk * v.envVelocity) / 0xff);
        if (v.envVelocity === 0) v.envState = 2;
        break;
      case 2: // decay
        v.envVelocity -= v.envDec;
        if (v.envVelocity <= v.envSus) {
          v.envVelocity = v.envSus;
          v.envState = 3;
        }
        break;
      case 3: // sustain
        break;
      case 4: // release
        v.envVelocity -= v.envRel;
        if (v.envVelocity < ENV_SILENT) v.envVelocity = ENV_SILENT;
        break;
    }
  }

  // ---------------------------------------------------------------- tick logic

  private stepTick(): void {
    for (let t = 0; t < MAX_TRACKS; t++) {
      const tr = this.tracks[t];
      if (!tr.enabled) continue;
      if (tr.wait > 0) tr.wait--;
      let live = 0;
      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.channels[vi];
        if (v == null || v.dead || v.trackId !== t) continue;
        live++;
        if (v.noteDuration > 0) v.noteDuration--;
        if (!v.autoSweep && v.sweepCounter < v.sweepLength) v.sweepCounter++;
      }
      if (live !== 0) {
        if (tr.lfoDelayCount > tr.modDelay) tr.lfoPhase = advanceLfoPhase(tr.lfoPhase, tr.modSpeed);
        else tr.lfoDelayCount++;
      } else {
        tr.waitingForNote = false;
        tr.lfoPhase = 0;
        tr.lfoDelayCount = tr.modDelay;
      }
      let guard = 0;
      while (tr.enabled && !tr.stopped && tr.wait === 0 && !tr.waitingForNote && guard++ < 100000)
        this.execOne(t, tr);
    }
  }

  private allTracksDone(): boolean {
    for (const t of this.tracks) if (t.enabled && !t.stopped) return false;
    return true;
  }

  private liveVoices(): number {
    let n = 0;
    for (let i = 0; i < MAX_VOICES; i++) if (this.channels[i] != null && !this.channels[i]!.dead) n++;
    return n;
  }

  // ----------------------------------------------------------------- opcodes

  private execOne(trackId: number, tr: Track): void {
    const ev = this.seq.eventData;
    if (tr.pc >= ev.length) {
      tr.stopped = true;
      return;
    }
    const op = ev[tr.pc++];

    if (op < 0x80) {
      // note on
      const velocity = ev[tr.pc++];
      const duration = this.readVarLen(tr);
      let key = op + tr.transpose;
      if (key < 0) key = 0;
      else if (key > 0x7f) key = 0x7f;
      this.startNote(trackId, tr, key, velocity, duration);
      tr.portamentoKey = key;
      if (tr.noteWait) {
        tr.wait = duration;
        if (duration === 0) tr.waitingForNote = true;
      }
      return;
    }

    switch (op) {
      case 0x80:
        tr.wait = this.readVarLen(tr);
        break;
      case 0x81:
        tr.program = this.readVarLen(tr);
        break;
      case 0x93: {
        // open track (track 0 only; must be allocated)
        const tn = ev[tr.pc++];
        const off = this.readU24(tr);
        if (trackId === 0 && tn < MAX_TRACKS && this.tracks[tn].allocated && !this.tracks[tn].enabled) {
          this.tracks[tn].enabled = true;
          this.tracks[tn].stopped = false;
          this.tracks[tn].pc = off;
        }
        break;
      }
      case 0x94: {
        // jump (BGM loop)
        const off = this.readU24(tr);
        tr.loopJumps++;
        if (tr.loopJumps === 1) tr.firstJumpFrame = this.renderFrame;
        else if (tr.loopJumps === 2) tr.secondJumpFrame = this.renderFrame;
        if (this.stopAtLoop && tr.loopJumps >= 2) tr.stopped = true;
        else tr.pc = off;
        break;
      }
      case 0x95: {
        // call
        const off = this.readU24(tr);
        if (tr.callDepth < 3) {
          tr.callStack[tr.callDepth] = tr.pc;
          tr.callDepth++;
          tr.pc = off;
        }
        break;
      }
      case 0xa0:
      case 0xa1:
      case 0xa2:
        this.execPrefixed(tr, op);
        break;
      case 0xb0:
      case 0xb1:
      case 0xb2:
      case 0xb3:
      case 0xb4:
      case 0xb5:
      case 0xb6:
      case 0xb7:
      case 0xb8:
      case 0xb9:
      case 0xba:
      case 0xbb:
      case 0xbc:
      case 0xbd:
        tr.pc += 1;
        this.readS16(tr);
        break;
      case 0xc0:
        tr.pan = ev[tr.pc++];
        break;
      case 0xc1:
        tr.volume = ev[tr.pc++];
        break;
      case 0xc2:
        this.playerVolume = ev[tr.pc++];
        break;
      case 0xc3:
        tr.transpose = toS8(ev[tr.pc++]);
        break;
      case 0xc4:
        tr.pitchBend = toS8(ev[tr.pc++]);
        break;
      case 0xc5:
        tr.bendRange = ev[tr.pc++];
        break;
      case 0xc6:
        tr.priority = ev[tr.pc++];
        break;
      case 0xc7:
        tr.noteWait = ev[tr.pc++] !== 0;
        break;
      case 0xc8:
        tr.tie = ev[tr.pc++] !== 0;
        this.stopTrackVoices(trackId);
        break;
      case 0xc9: {
        // portamento control: from-note + enable
        let k = ev[tr.pc++] + tr.transpose;
        if (k < 0) k = 0;
        else if (k > 0x7f) k = 0x7f;
        tr.portamentoKey = k;
        tr.portamentoOn = true;
        break;
      }
      case 0xca:
        tr.modDepth = ev[tr.pc++];
        break;
      case 0xcb:
        tr.modSpeed = ev[tr.pc++];
        break;
      case 0xcc:
        tr.modType = ev[tr.pc++];
        break;
      case 0xcd:
        tr.modRange = ev[tr.pc++];
        break;
      case 0xce:
        tr.portamentoOn = ev[tr.pc++] !== 0;
        break;
      case 0xcf:
        tr.portamentoTime = ev[tr.pc++];
        break;
      case 0xd0:
        tr.attackOv = ev[tr.pc++];
        break;
      case 0xd1:
        tr.decayOv = ev[tr.pc++];
        break;
      case 0xd2:
        tr.sustainOv = ev[tr.pc++];
        break;
      case 0xd3:
        tr.releaseOv = ev[tr.pc++];
        break;
      case 0xd4: {
        // loop start (shares the 3-deep call stack)
        const count = ev[tr.pc++];
        if (tr.callDepth < 3) {
          tr.callStack[tr.callDepth] = tr.pc;
          tr.callStackLoops[tr.callDepth] = count;
          tr.callDepth++;
        }
        break;
      }
      case 0xd5:
        tr.expression = ev[tr.pc++];
        break;
      case 0xd6:
        tr.pc++;
        break;
      case 0xe0:
        tr.modDelay = this.readU16(tr);
        break;
      case 0xe1:
        this.tempo = this.readU16(tr);
        break;
      case 0xe3:
        tr.sweepPitch = this.readS16(tr);
        break;
      case 0xfc: {
        // loop end
        if (tr.callDepth !== 0) {
          let count = tr.callStackLoops[tr.callDepth - 1] & 0xff;
          if (count === 0 && this.stopAtLoop) {
            tr.callDepth--;
            break;
          }
          if (count !== 0) {
            count--;
            if (count === 0) {
              tr.callDepth--;
              break;
            }
          }
          tr.callStackLoops[tr.callDepth - 1] = count;
          tr.pc = tr.callStack[tr.callDepth - 1];
        }
        break;
      }
      case 0xfd: // return
        if (tr.callDepth !== 0) {
          tr.callDepth--;
          tr.pc = tr.callStack[tr.callDepth];
        }
        break;
      case 0xfe: {
        // allocate tracks (bitmask, track 0 only)
        const mask = this.readU16(tr);
        if (trackId === 0) {
          for (let i = 0; i < MAX_TRACKS; i++) if ((mask & (1 << i)) !== 0) this.tracks[i].allocated = true;
        }
        break;
      }
      case 0xff: // end of track
        tr.stopped = true;
        break;
      default: // unknown: stop this track (avoid desync noise)
        tr.stopped = true;
        break;
    }
  }

  /** 0xA0/0xA1/0xA2 prefix an inner command; consume its bytes so the stream stays in sync. */
  private execPrefixed(tr: Track, prefix: number): void {
    const ev = this.seq.eventData;
    const inner = ev[tr.pc++];
    if (inner < 0x80) tr.pc++; // note: skip velocity, duration replaced below
    switch (inner) {
      case 0x80:
      case 0x81:
        break; // varlen final, replaced
      case 0x93:
        tr.pc++;
        this.readU24(tr);
        break;
      case 0x94:
      case 0x95:
        this.readU24(tr);
        break;
      case 0xe0:
      case 0xe1:
      case 0xe3:
        break;
      case 0xfc:
      case 0xfd:
      case 0xff:
        return;
      default:
        break; // u8 final, replaced
    }
    if (prefix === 0xa0) {
      this.readS16(tr);
      this.readS16(tr);
    } else if (prefix === 0xa1) {
      tr.pc++;
    }
    // prefix 0xa2 (if): no extra bytes. Effect not modelled in either engine.
  }

  // ----------------------------------------------------------------- notes

  private startNote(trackId: number, tr: Track, note: number, velocity: number, durationTicks: number): void {
    this.dbgNotes++;
    if (trackId >= 0 && trackId < MAX_TRACKS && !this.trackEnabled[trackId]) return; // muted: keep timing, no sound

    if (tr.tie) {
      const existing = this.lastVoiceOnTrack(trackId);
      if (existing != null) {
        existing.key = note;
        existing.velocity = velocity;
        applySweep(existing, tr, note, durationTicks);
        return;
      }
      durationTicks = -1;
    }

    const region = resolveRegion(this.seq.instruments, tr.program, note);
    if (region == null) return;

    let relReg = region.release;
    if (relReg === 0xff) {
      durationTicks = -1;
      relReg = 0;
    }

    const v = new Voice();
    v.trackId = trackId;
    v.key = note;
    if (region.recordType === 2) {
      // PSG square
      v.isPsg = true;
      v.duty = region.waveIndex & 0x7;
      v.samples = EMPTY_PCM;
      v.baseTimer = 8006;
      v.baseKey = region.baseNote === 0x7f ? 60 : region.baseNote;
    } else if (region.recordType === 3) {
      // PSG noise
      v.isNoise = true;
      v.samples = EMPTY_PCM;
      v.baseTimer = 8006;
      v.baseKey = region.baseNote === 0x7f ? 60 : region.baseNote;
    } else {
      const arc =
        region.waveArcIndex >= 0 && region.waveArcIndex < this.seq.waveArchives.length
          ? this.seq.waveArchives[region.waveArcIndex]
          : null;
      if (arc == null || region.waveIndex >= arc.waves.length) return;
      const wave: LoadedWave = arc.waves[region.waveIndex];
      if (wave.pcm.length === 0) return;
      v.samples = wave.pcm;
      // Wave.getTimer(): SequencePlayer uses the raw ARM7 timer directly when present, only
      // falling back to a sampleRate-derived approximation for malformed/zero-timer waves.
      v.baseTimer = wave.timer > 0 ? wave.timer : Math.round(16756991 / Math.max(1, wave.sampleRate));
      v.baseKey = region.baseNote;
      v.loop = wave.loops;
      v.loopStart = wave.loopStart;
      v.loopEnd = wave.loopEnd;
      if (v.loopStart >= wave.pcm.length) v.loopStart = 0;
      if (v.loopEnd > wave.pcm.length || v.loopEnd <= v.loopStart) v.loopEnd = wave.pcm.length;
    }

    const a = tr.attackOv !== 0xff ? tr.attackOv : region.attack;
    const d = tr.decayOv !== 0xff ? tr.decayOv : region.decay;
    const s = tr.sustainOv !== 0xff ? tr.sustainOv : region.sustain;
    if (tr.releaseOv !== 0xff) relReg = tr.releaseOv;
    v.envAtk = attackRate(a);
    v.envDec = getFallingRate(d);
    v.envSus = SUSTAIN_TABLE[clamp7(s)];
    v.envRel = getFallingRate(relReg);
    v.envVelocity = ENV_SILENT;
    v.envState = 0;
    v.velocity = velocity;
    v.noteDuration = durationTicks;
    v.priority = tr.priority;
    v.regionPan = region.pan - 64;
    v.timer = channelTimer(v.baseTimer, (v.key - v.baseKey) << 6);
    applySweep(v, tr, note, durationTicks);
    const slot = this.allocateChannel(v);
    if (slot < 0) {
      this.dbgDropped++;
      return;
    }
    v.serial = ++this.allocSerial;
    this.channels[slot] = v;
  }

  private lastVoiceOnTrack(trackId: number): Voice | null {
    let best: Voice | null = null;
    for (let i = 0; i < MAX_VOICES; i++) {
      const c = this.channels[i];
      if (c == null || c.dead || c.trackId !== trackId) continue;
      if (best == null || c.serial >= best.serial) best = c;
    }
    return best;
  }

  private stopTrackVoices(trackId: number): void {
    for (let i = 0; i < MAX_VOICES; i++) if (this.channels[i] != null && this.channels[i]!.trackId === trackId) this.channels[i] = null;
  }

  /**
   * GotaSequenceLib Mixer.AllocateChannel: 16 hardware slots, type-restricted (PCM any, PSG 8-13,
   * noise 14-15). Prefer free, then releasing, then lowest track priority / quietest. The new note
   * is dropped (not force-stolen) if every candidate outranks it.
   */
  private allocateChannel(incoming: Voice): number {
    const allowed = incoming.isNoise ? 0xc000 : incoming.isPsg ? 0x3f00 : 0xffff;
    let best = -1;
    let bestScore = Number.MAX_SAFE_INTEGER;
    let bestVol = Number.MAX_VALUE;
    for (let i = 0; i < MAX_VOICES; i++) {
      if ((allowed & (1 << i)) === 0) continue;
      const c = this.channels[i];
      let score: number, vol: number;
      if (c == null || c.dead) {
        score = -2;
        vol = 0;
      } else if (c.envState === 4) {
        score = -1;
        vol = c.volByte;
      } else {
        score = c.priority;
        vol = c.volByte;
      }
      if (best < 0 || score < bestScore || (score === bestScore && vol <= bestVol)) {
        best = i;
        bestScore = score;
        bestVol = vol;
      }
    }
    if (best < 0) return -1;
    if (bestScore >= 0 && incoming.priority < bestScore) return -1;
    return best;
  }

  // --------------------------------------------------------------- readers

  private readVarLen(tr: Track): number {
    let value = 0,
      b: number;
    const ev = this.seq.eventData;
    do {
      b = ev[tr.pc++];
      value = (value << 7) | (b & 0x7f);
    } while ((b & 0x80) !== 0);
    return value;
  }
  private readU16(tr: Track): number {
    const ev = this.seq.eventData;
    const v = ev[tr.pc] | (ev[tr.pc + 1] << 8);
    tr.pc += 2;
    return v;
  }
  private readS16(tr: Track): number {
    return toS16(this.readU16(tr));
  }
  private readU24(tr: Track): number {
    const ev = this.seq.eventData;
    const v = ev[tr.pc] | (ev[tr.pc + 1] << 8) | (ev[tr.pc + 2] << 16);
    tr.pc += 3;
    return v;
  }
}

/** Gota PlayNote sweep: SweepPitch + (PortamentoKey - key)*64; length from porta time or duration. */
function applySweep(v: Voice, tr: Track, key: number, duration: number): void {
  let sp = tr.sweepPitch;
  if (tr.portamentoOn) sp += (tr.portamentoKey - key) << 6;
  v.sweepPitch = sp;
  if (tr.portamentoTime !== 0) {
    v.sweepLength = (tr.portamentoTime * tr.portamentoTime * Math.abs(v.sweepPitch)) >> 11;
    v.autoSweep = true;
  } else {
    v.sweepLength = duration;
    v.autoSweep = false;
  }
  v.sweepCounter = 0;
}

/** The DS volume/pan LFO scaling (Gota7 GetVolume/GetPan). */
function scaleLfoVolPan(lfoRaw: number): number {
  const lfo = lfoRaw | 0;
  return ((lfo & ~0xfc000000) >> 8) | ((lfo < 0 ? -1 : 0) << 6) | ((lfo >>> 26) << 18);
}

function toS8(u8: number): number {
  return u8 > 127 ? u8 - 256 : u8;
}
function toS16(u16: number): number {
  return u16 > 32767 ? u16 - 65536 : u16;
}
