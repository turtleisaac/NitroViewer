// Turns the wire-format SequenceEngineData (base64 bytecode + JSON instrument table + base64 PCM)
// into typed-array-backed data the realtime stepper can read with zero further decoding. Mirrors
// InstrumentBank/WaveArchive/Wave on the Java side (Nds4j sound package) — this is the load-time
// half of the port; stepper.ts is the per-frame half.

import type { EngineInstrument, EngineNoteRegion, SequenceEngineData } from "../../transport/types";
import { base64ToBytes } from "../../util";

export interface LoadedWave {
  sampleRate: number;
  timer: number;
  loops: boolean;
  loopStart: number;
  loopEnd: number;
  pcm: Int16Array;
}

export interface LoadedWaveArchive {
  waves: LoadedWave[];
}

export interface LoadedSequence {
  bankId: number;
  eventData: Uint8Array;
  instruments: EngineInstrument[];
  waveArchives: (LoadedWaveArchive | null)[];
}

/** Little-endian signed-16 PCM bytes -> Int16Array, matching the facade's pcm16LE encoding. */
function pcmFromBase64(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  const out = new Int16Array(bytes.length >> 1);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

export function loadSequenceEngineData(data: SequenceEngineData): LoadedSequence {
  return {
    bankId: data.bankId,
    eventData: base64ToBytes(data.eventData),
    instruments: data.instruments,
    waveArchives: data.waveArchives.map((arc) =>
      arc == null
        ? null
        : {
            waves: arc.waves.map((w) => ({
              sampleRate: w.sampleRate,
              timer: w.timer,
              loops: w.loops,
              loopStart: w.loopStart,
              loopEnd: w.loopEnd,
              pcm: pcmFromBase64(w.pcmBase64),
            })),
          }
    ),
  };
}

/**
 * Pick the note region a (program, note) pair plays. Matches InstrumentBank.resolve: type 1-15 is a
 * single region for the whole instrument, type 16 is a drum kit (one region per note from lowNote),
 * type 17 is a key-split (first splitPoint >= note wins).
 */
export function resolveRegion(
  instruments: EngineInstrument[],
  program: number,
  note: number
): EngineNoteRegion | null {
  if (program < 0 || program >= instruments.length) return null;
  const inst = instruments[program];
  if (inst.type === 0 || inst.regions.length === 0) return null;
  if (inst.type <= 15) return inst.regions[0];
  if (inst.type === 16) {
    const idx = note - inst.lowNote;
    return idx >= 0 && idx < inst.regions.length ? inst.regions[idx] : null;
  }
  if (inst.type === 17 && inst.splitPoints) {
    for (let i = 0; i < inst.splitPoints.length && i < inst.regions.length; i++)
      if (note <= inst.splitPoints[i]) return inst.regions[i];
    return null;
  }
  return null;
}
