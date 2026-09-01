// Exercises voice allocation/stealing, tie-reuse, and the envelope lifecycle against exact
// expected behavior, derived by reading SequencePlayer.java's startNote/allocateChannel/channelTick.
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper";
import type { LoadedSequence, LoadedWaveArchive } from "./load";
import type { EngineInstrument } from "../../transport/types";

/** Fast-attack, sustained instrument: envelope reaches full volume almost immediately and holds
 *  until an explicit release, so voice-count assertions aren't racing the envelope's own decay. */
function sustainedInstrument(overrides: Partial<{ priority: number; recordType: number }> = {}): EngineInstrument {
  return {
    type: 1,
    lowNote: 0,
    splitPoints: null,
    regions: [
      {
        recordType: overrides.recordType ?? 1,
        waveIndex: 0,
        waveArcIndex: 0,
        baseNote: 60,
        attack: 127, // ATTACK_TABLE[127] = 0 -> attack phase completes in one envelope tick
        decay: 127,
        sustain: 127, // SUSTAIN_TABLE[127] = 0 -> full volume, holds indefinitely until release
        release: 127,
        pan: 64,
      },
    ],
  };
}

const oneWaveArchive: LoadedWaveArchive = {
  waves: [{ sampleRate: 16000, timer: 1047, loops: true, loopStart: 0, loopEnd: 32, pcm: new Int16Array(32).fill(1000) }],
};

function seqOf(bytes: number[], instrument: EngineInstrument): LoadedSequence {
  const inst = { ...instrument, regions: instrument.regions.map((r) => ({ ...r })) };
  return {
    bankId: 0,
    eventData: new Uint8Array(bytes),
    instruments: [inst],
    waveArchives: [oneWaveArchive, null, null, null],
  };
}

const TEST_RATE = 100;

/** Drive N driver frames (== N stepSample() calls at TEST_RATE; see stepper.test.ts). */
function drive(s: Stepper, n: number): void {
  for (let i = 0; i < n; i++) s.stepSample();
}

/** note-on key, velocity=100, duration=`dur` (varlen, <128 fits one byte). */
function noteOn(key: number, dur: number): number[] {
  return [key, 100, dur];
}

describe("Stepper voice allocation / mixer", () => {
  it("a resolvable note-on allocates a live voice", () => {
    const s = new Stepper(seqOf([...noteOn(60, 50), 0xff], sustainedInstrument()), TEST_RATE);
    drive(s, 10); // enough driver frames for stepTick() to reach and process the note-on
    expect(s.liveVoiceCountDebug).toBe(1);
    expect(s.dbgDropped).toBe(0);
  });

  it("PCM voices may use any of the 16 channel slots", () => {
    const s = new Stepper(seqOf([...noteOn(60, 50), 0xff], sustainedInstrument()), TEST_RATE);
    drive(s, 10);
    let slot = -1;
    for (let i = 0; i < 16; i++) if (s.getChannelDebug(i)) slot = i;
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it("PSG voices are restricted to hardware slots 8-13", () => {
    const s = new Stepper(seqOf([...noteOn(60, 50), 0xff], sustainedInstrument({ recordType: 2 })), TEST_RATE);
    drive(s, 10);
    let slot = -1;
    for (let i = 0; i < 16; i++) if (s.getChannelDebug(i)) slot = i;
    expect(slot).toBeGreaterThanOrEqual(8);
    expect(slot).toBeLessThanOrEqual(13);
  });

  it("noise voices are restricted to hardware slots 14-15", () => {
    const s = new Stepper(seqOf([...noteOn(60, 50), 0xff], sustainedInstrument({ recordType: 3 })), TEST_RATE);
    drive(s, 10);
    let slot = -1;
    for (let i = 0; i < 16; i++) if (s.getChannelDebug(i)) slot = i;
    expect(slot).toBeGreaterThanOrEqual(14);
    expect(slot).toBeLessThanOrEqual(15);
  });

  it("a 17th note is dropped, not stolen, when all 16 voices outrank it (equal priority, all fresh)", () => {
    // Track 0 fires 16 long-held notes back to back (no rest between — noteWait off so they all
    // fire within the same tick), filling every hardware channel; a 17th at the same priority finds
    // every candidate's score equal to its own incoming priority, so `incoming.priority < bestScore`
    // is false... to force a genuine drop we lower the 17th note's priority via 0xC6 mid-stream.
    const bytes: number[] = [0xc7, 0]; // note-wait off: fire all notes without waiting between them
    for (let i = 0; i < 16; i++) bytes.push(...noteOn(60, 60));
    bytes.push(0xc6, 10); // drop this and later notes to a low priority
    bytes.push(...noteOn(61, 60));
    bytes.push(0xff);
    const s = new Stepper(seqOf(bytes, sustainedInstrument()), TEST_RATE);
    drive(s, 10);
    expect(s.liveVoiceCountDebug).toBe(16);
    expect(s.dbgDropped).toBeGreaterThanOrEqual(1);
  });

  it("a higher-priority note steals the lowest-priority voice when all 16 slots are full", () => {
    const bytes: number[] = [0xc7, 0, 0xc6, 20]; // note-wait off, low priority (20) for the fill notes
    for (let i = 0; i < 16; i++) bytes.push(...noteOn(60, 60));
    bytes.push(0xc6, 100); // much higher priority for the stealing note
    bytes.push(...noteOn(62, 60));
    bytes.push(0xff);
    const s = new Stepper(seqOf(bytes, sustainedInstrument()), TEST_RATE);
    drive(s, 10);
    expect(s.liveVoiceCountDebug).toBe(16); // steal replaces a slot, doesn't add a 17th
    let found62 = false;
    for (let i = 0; i < 16; i++) {
      const v = s.getChannelDebug(i);
      if (v && v.key === 62) found62 = true;
    }
    expect(found62).toBe(true); // the high-priority note made it in by stealing a low-priority slot
  });

  it("tie reuses the last voice on the track instead of allocating a new one", () => {
    // note-wait off so both notes fire in the same tick, then tie on; two notes back to back
    const bytes = [0xc7, 0, 0xc8, 1, ...noteOn(60, 60), ...noteOn(64, 60), 0xff];
    const s = new Stepper(seqOf(bytes, sustainedInstrument()), TEST_RATE);
    drive(s, 10);
    expect(s.liveVoiceCountDebug).toBe(1); // second note-on updated the existing voice, no new one
    let key = -1;
    for (let i = 0; i < 16; i++) {
      const v = s.getChannelDebug(i);
      if (v) key = v.key;
    }
    expect(key).toBe(64); // the voice's key was updated to the second note, in place
  });

  it("a note's envelope reaches release and the voice eventually dies", () => {
    // Short duration (2 ticks): noteDuration hits 0 quickly, forcing envState -> release (4), and a
    // fast release rate (127) then clamps envVelocity to ENV_SILENT, killing the voice.
    const s = new Stepper(seqOf([...noteOn(60, 2), 0xff], sustainedInstrument()), TEST_RATE);
    drive(s, 5);
    expect(s.liveVoiceCountDebug).toBe(1);
    drive(s, 2000);
    expect(s.liveVoiceCountDebug).toBe(0);
  });
});
