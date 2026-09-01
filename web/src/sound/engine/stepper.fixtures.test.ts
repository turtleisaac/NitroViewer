// Diffs the JS Stepper's offline output against Nds4j's own SequencePlayer.renderStereo, run over
// real Platinum.nds sequences. Fixtures are captured by CheerpjFacadeTest#dumpSoundEngineFixtures
// (gitignored — never commit ROM-derived audio); regenerate with:
//   cd NitroViewer/nitroviewer-core && mvn -Drom.dir=<dir> -Dtest=CheerpjFacadeTest#dumpSoundEngineFixtures test
// Every test here is skipped (not failed) when the fixtures aren't present, matching the Java
// suite's own ROM-gated-test convention.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Stepper } from "./stepper";
import { loadSequenceEngineData } from "./load";
import type { SequenceEngineData } from "../../transport/types";
import { base64ToBytes } from "../../util";

const FIXTURES_DIR = resolve(__dirname, "__fixtures__");
const SEQUENCES = ["SEQ_PV001", "SEQ_TOWN01_D", "SEQ_CITY01_D", "SEQ_PL_BA_GIRA", "SEQ_D_MOUNT1"];

interface ReferenceRender {
  sampleRate: number;
  seconds: number;
  loopStartSec: number;
  loopEndSec: number;
  base64: string;
}

/** Parse a canonical 16-bit PCM RIFF/WAVE file (as produced by WavFile.pcm16) without Web Audio. */
function parseWavPcm16(bytes: Uint8Array): { channels: number; sampleRate: number; samples: Int16Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  let p = 12;
  let dataOff = 44,
    dataLen = bytes.length - 44;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const size = dv.getUint32(p + 4, true);
    if (id === "data") {
      dataOff = p + 8;
      dataLen = size;
      break;
    }
    p += 8 + size + (size & 1);
  }
  const n = Math.floor(dataLen / 2);
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = dv.getInt16(dataOff + i * 2, true);
  return { channels, sampleRate, samples };
}

const fixturesPresent = SEQUENCES.every(
  (name) => existsSync(resolve(FIXTURES_DIR, `${name}.engine.json`)) && existsSync(resolve(FIXTURES_DIR, `${name}.reference.json`))
);

describe.skipIf(!fixturesPresent)("Stepper vs. Nds4j SequencePlayer (real Platinum.nds fixtures)", () => {
  for (const name of SEQUENCES) {
    it(`${name}: offline render matches the Java reference`, () => {
      const engineData = JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.engine.json`), "utf8")) as SequenceEngineData;
      const reference = JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.reference.json`), "utf8")) as ReferenceRender;

      const wav = parseWavPcm16(base64ToBytes(reference.base64));
      expect(wav.channels).toBe(2);
      expect(wav.sampleRate).toBe(reference.sampleRate);

      const seq = loadSequenceEngineData(engineData);
      const stepper = new Stepper(seq, reference.sampleRate);
      stepper.stopAtLoop = true; // matches renderSequenceWav's player.stopAtLoop = true

      const out: number[] = [];
      const maxFrames = reference.sampleRate * 600; // matches the Java side's 600s safety cap
      while (out.length < maxFrames * 2) {
        const sample = stepper.stepSample();
        if (sample == null) break; // nothing produced — the sequence ended, not a silent frame
        out.push(sample[0], sample[1]);
      }
      const mine = Int16Array.from(out);

      // Frame count: the Java and JS auto-stop heuristics are both driven by the identical
      // allTracksDone/liveVoices/silence-timeout state machine, so they must agree exactly — and,
      // empirically, do (see below): this locks that in as a regression guard.
      const refFrames = wav.samples.length / 2;
      const mineFrames = mine.length / 2;
      expect(mineFrames).toBeGreaterThan(0);
      expect(mineFrames).toBe(refFrames);

      // Sample-level diff over every frame. All the arithmetic here (drop-sample resampling,
      // integer-truncating envelope/mixer math) is fixed-point, not floating-point, so there's no
      // accumulation-drift excuse for anything less than bit-exact — and across these three real
      // sequences (hundreds of thousands to millions of samples, real bank/wave data) it is exactly
      // that. Asserted at 100%/0 rather than a loose tolerance so any future regression trips this
      // immediately instead of hiding under a margin.
      const n = Math.min(mine.length, wav.samples.length);
      let sumSqErr = 0;
      let maxErr = 0;
      let exact = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(mine[i] - wav.samples[i]);
        if (d === 0) exact++;
        if (d > maxErr) maxErr = d;
        sumSqErr += d * d;
      }
      const rmse = Math.sqrt(sumSqErr / n);
      const exactPct = (100 * exact) / n;
      // eslint-disable-next-line no-console
      console.log(
        `${name}: ${n} samples compared, ${exactPct.toFixed(2)}% bit-exact, RMSE=${rmse.toFixed(3)}, maxErr=${maxErr}`
      );
      expect(maxErr).toBe(0);
      expect(rmse).toBe(0);
      expect(exactPct).toBe(100);

      // Loop points: my getLoopPoints() is frame-based; convert to seconds and compare to the
      // Java reference's loopStartSec/loopEndSec within a fraction of a sample period.
      if (reference.loopStartSec >= 0) {
        const loop = stepper.getLoopPoints();
        expect(loop).not.toBeNull();
        const tol = 2 / reference.sampleRate;
        expect(Math.abs(loop!.startFrame / reference.sampleRate - reference.loopStartSec)).toBeLessThan(tol);
        expect(Math.abs(loop!.endFrame / reference.sampleRate - reference.loopEndSec)).toBeLessThan(tol);
      }
    });
  }
});
