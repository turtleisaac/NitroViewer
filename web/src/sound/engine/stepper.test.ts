// Exercises the bytecode interpreter's opcode table against exact expected state, derived by
// reading SequencePlayer.java's execOne/execPrefixed directly (see stepper.ts's header comment).
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper";
import type { LoadedSequence } from "./load";
import type { EngineInstrument } from "../../transport/types";

function seqOf(bytes: number[], instruments: EngineInstrument[] = []): LoadedSequence {
  return {
    bankId: 0,
    eventData: new Uint8Array(bytes),
    instruments,
    waveArchives: [null, null, null, null],
  };
}

/** A low output rate makes exactly one output sample = one driver frame (n is clamped to >=1
 *  well before the real ~5.2 sample/frame ratio at 65456/48000-ish rates), which keeps the
 *  bytecode-tick-vs-output-sample timing predictable for tests that care about exact tick counts. */
const TEST_RATE = 100;

/** Drive the stepper until track 0 stops (bytecode reaches 0xFF or an unknown opcode), or bail. */
function runToStop(s: Stepper, maxSamples = 200000): void {
  for (let i = 0; i < maxSamples && !s.getTrackDebug(0).stopped; i++) s.stepSample();
}

describe("Stepper bytecode interpreter", () => {
  it("0xC0 pan sets the raw 0-127 value", () => {
    const s = new Stepper(seqOf([0xc0, 100, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).pan).toBe(100);
  });

  it("0xC1 track volume / 0xC2 player volume", () => {
    const s = new Stepper(seqOf([0xc1, 90, 0xc2, 80, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(90);
    expect(s.playerVolumeDebug).toBe(80);
  });

  it("0xC3 transpose / 0xC4 pitch bend are signed bytes", () => {
    const s = new Stepper(seqOf([0xc3, 0xfe /* -2 */, 0xc4, 0x80 /* -128 */, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).transpose).toBe(-2);
    expect(s.getTrackDebug(0).pitchBend).toBe(-128);
  });

  it("0xC5 bend range / 0xC6 priority / 0xC7 note-wait", () => {
    const s = new Stepper(seqOf([0xc5, 12, 0xc6, 30, 0xc7, 0, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.bendRange).toBe(12);
    expect(tr.priority).toBe(30);
    expect(tr.noteWait).toBe(false);
  });

  it("0xC8 tie sets the flag", () => {
    const s = new Stepper(seqOf([0xc8, 1, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).tie).toBe(true);
  });

  it("0xC9 portamento control sets portamentoKey (transpose-adjusted, clamped) and turns it on", () => {
    const s = new Stepper(seqOf([0xc3, 5, 0xc9, 120, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.portamentoKey).toBe(125); // 120 + transpose 5
    expect(tr.portamentoOn).toBe(true);
  });

  it("0xC9 portamento control clamps to 0x7F", () => {
    const s = new Stepper(seqOf([0xc3, 20, 0xc9, 120, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).portamentoKey).toBe(0x7f);
  });

  it("0xCA-0xCD modulation depth/speed/type/range", () => {
    const s = new Stepper(seqOf([0xca, 10, 0xcb, 20, 0xcc, 2, 0xcd, 3, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.modDepth).toBe(10);
    expect(tr.modSpeed).toBe(20);
    expect(tr.modType).toBe(2);
    expect(tr.modRange).toBe(3);
  });

  it("0xCE portamento on/off / 0xCF portamento time", () => {
    const s = new Stepper(seqOf([0xce, 1, 0xcf, 40, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.portamentoOn).toBe(true);
    expect(tr.portamentoTime).toBe(40);
  });

  it("0xD0-0xD3 ADSR overrides", () => {
    const s = new Stepper(seqOf([0xd0, 1, 0xd1, 2, 0xd2, 3, 0xd3, 4, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.attackOv).toBe(1);
    expect(tr.decayOv).toBe(2);
    expect(tr.sustainOv).toBe(3);
    expect(tr.releaseOv).toBe(4);
  });

  it("0xD5 expression", () => {
    const s = new Stepper(seqOf([0xd5, 77, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).expression).toBe(77);
  });

  it("0xD6 print var is a byte-consuming no-op", () => {
    const s = new Stepper(seqOf([0xd6, 5, 0xc1, 42, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(42);
  });

  it("0xE0 modulation delay (u16 LE)", () => {
    const s = new Stepper(seqOf([0xe0, 0x34, 0x12, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).modDelay).toBe(0x1234);
  });

  it("0xE1 tempo (u16 LE)", () => {
    const s = new Stepper(seqOf([0xe1, 0x90, 0x00, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.tempoDebug).toBe(144);
  });

  it("0xE3 sweep pitch is a signed s16 LE", () => {
    const s = new Stepper(seqOf([0xe3, 0xff, 0xff, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).sweepPitch).toBe(-1);
  });

  it("0x81 program change (single-byte varlen)", () => {
    const s = new Stepper(seqOf([0x81, 5, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).program).toBe(5);
  });

  it("0x80 rest blocks the track for the given tick count", () => {
    // At TEST_RATE=100, 341*100/65456 < 1 so n clamps to 1 output-sample per driver frame — one
    // stepSample() call == one runDriverFrame() call. tempoStack starts at 0 and the default tempo
    // (120) crosses the 240 threshold on the 3rd call, so stepTick() first executes then.
    const s = new Stepper(seqOf([0x80, 100, 0xff]), TEST_RATE);
    s.stepSample();
    s.stepSample();
    s.stepSample();
    const tr = s.getTrackDebug(0);
    expect(tr.stopped).toBe(false);
    expect(tr.wait).toBe(100);
  });

  it("an unknown opcode stops the track without consuming further bytes", () => {
    const s = new Stepper(seqOf([0x82, 0xff]), TEST_RATE);
    runToStop(s);
    const tr = s.getTrackDebug(0);
    expect(tr.stopped).toBe(true);
    expect(tr.pc).toBe(1); // only the unknown opcode byte itself was consumed
  });

  it("0x95 call / 0xFD return resume exactly at the saved PC", () => {
    // 0: call -> 8 (4 bytes) | 4: volume=222 (2 bytes) | 6: end (1 byte) | 8: volume=77; return (3 bytes)
    const s = new Stepper(
      seqOf([0x95, 8, 0, 0, 0xc1, 222, 0xff, 0, 0xc1, 77, 0xfd]),
      TEST_RATE
    );
    runToStop(s);
    // subroutine ran (77) then mainline resumed and overwrote it (222) before stopping
    expect(s.getTrackDebug(0).volume).toBe(222);
  });

  it("0xD4/0xFC loop executes the body exactly `count` times", () => {
    // loop(3) { note-on key=60 vel=100 dur=0 } end. No bank is loaded, so every note-on fails to
    // resolve to a voice, but dbgNotes still increments unconditionally (matches
    // SequencePlayer.startNote, whose dbgNotes++ is its first line, before the mute/resolve checks).
    const s = new Stepper(seqOf([0xd4, 3, 60, 100, 0, 0xfc, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.dbgNotes).toBe(3);
  });

  it("0xFE allocate + 0x93 open track enables the target track at the given PC", () => {
    const s = new Stepper(seqOf([0xfe, 2, 0, 0x93, 1, 0, 0, 0, 0xff]), TEST_RATE);
    runToStop(s);
    const tr1 = s.getTrackDebug(1);
    expect(tr1.allocated).toBe(true);
    expect(tr1.enabled).toBe(true);
  });

  it("0x94 jump records a loop region once it repeats", () => {
    // rest(1); jump back to 0 — a classic BGM loop tail.
    const s = new Stepper(seqOf([0x80, 1, 0x94, 0, 0, 0]), TEST_RATE);
    for (let i = 0; i < 5000; i++) s.stepSample();
    const loop = s.getLoopPoints();
    expect(loop).not.toBeNull();
    expect(loop!.endFrame).toBeGreaterThan(loop!.startFrame);
  });

  it("stopAtLoop stops a track on its second jump instead of looping", () => {
    const s = new Stepper(seqOf([0x80, 1, 0x94, 0, 0, 0]), TEST_RATE);
    s.stopAtLoop = true;
    runToStop(s);
    expect(s.getTrackDebug(0).stopped).toBe(true);
    expect(s.getTrackDebug(0).loopJumps).toBe(2);
  });

  it("0xA0 (random) prefixing a u8-final op consumes exactly opcode+inner+2×s16", () => {
    const s = new Stepper(seqOf([0xa0, 0xc1, 1, 0, 2, 0, 0xc1, 55, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(55);
  });

  it("0xA1 (from-var) prefixing a u8-final op consumes exactly opcode+inner+1", () => {
    const s = new Stepper(seqOf([0xa1, 0xc1, 9, 0xc1, 66, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(66);
  });

  it("0xA2 (if) prefixing a u8-final op consumes exactly opcode+inner", () => {
    const s = new Stepper(seqOf([0xa2, 0xc1, 0xc1, 77, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(77);
  });

  it("0xB0-0xBD var ops consume exactly opcode+u8+s16", () => {
    const s = new Stepper(seqOf([0xb3, 1, 2, 0, 0xc1, 88, 0xff]), TEST_RATE);
    runToStop(s);
    expect(s.getTrackDebug(0).volume).toBe(88);
  });
});
