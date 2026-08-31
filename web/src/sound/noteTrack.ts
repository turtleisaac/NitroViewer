// Canvas piano-roll for SSEQ note events. Lives in the UI, not Nds4j: the library hands over
// {track, tick, duration, key} and we draw it.

export interface NoteEvent {
  track: number;
  tick: number;
  duration: number;
  key: number;
  velocity: number;
  program: number;
}

const LANE_H = 28;
const GUTTER = 72;
const COLORS = [
  "#5b7cfa", "#4fd1c5", "#e5b13a", "#f2675f", "#c084fc", "#34d399",
  "#60a5fa", "#fb7185", "#a3e635", "#f472b6", "#38bdf8", "#fbbf24",
];

export const NOTE_LANE_HEIGHT = LANE_H;
export const NOTE_GUTTER = GUTTER;

export function noteTrackHeight(trackCount: number): number {
  return Math.max(1, trackCount) * LANE_H;
}

/** Map a canvas X coordinate to a tick on the roll (clamped). */
export function tickFromCanvasX(x: number, width: number, ticks: number): number {
  const inner = Math.max(1, width - GUTTER);
  const u = (x - GUTTER) / inner;
  const t = u * Math.max(1, ticks);
  if (t < 0) return 0;
  if (t > ticks) return ticks;
  return t;
}

/** Draw one row-per-track note strip. `playheadTick` is null when not playing. */
export function drawNoteTrack(
  ctx: CanvasRenderingContext2D,
  notes: NoteEvent[],
  ticks: number,
  trackCount: number,
  playheadTick: number | null,
  width: number,
  loopStartTick = -1,
  loopEndTick = -1,
  silent: boolean[] | null = null
): void {
  const tracks = Math.max(1, trackCount);
  const height = tracks * LANE_H;
  const inner = Math.max(1, width - GUTTER);
  const tMax = Math.max(1, ticks);

  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, width, height);

  const range: { min: number; max: number }[] = [];
  for (let t = 0; t < tracks; t++) range.push({ min: 127, max: 0 });
  for (const n of notes) {
    if (n.track < 0 || n.track >= tracks) continue;
    if (n.key < range[n.track].min) range[n.track].min = n.key;
    if (n.key > range[n.track].max) range[n.track].max = n.key;
  }

  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";
  for (let t = 0; t < tracks; t++) {
    const y = t * LANE_H;
    const off = silent != null && silent[t];
    ctx.fillStyle = off ? "#12141a" : t % 2 === 0 ? "#1b1e26" : "#161920";
    ctx.fillRect(GUTTER, y, inner, LANE_H);
    ctx.fillStyle = "#262a34";
    ctx.fillRect(0, y + LANE_H - 1, width, 1);
  }

  for (const n of notes) {
    if (n.track < 0 || n.track >= tracks) continue;
    const r = range[n.track];
    const span = Math.max(1, r.max - r.min);
    const x = GUTTER + (n.tick / tMax) * inner;
    const w = Math.max(2, (n.duration / tMax) * inner);
    const pad = 3;
    const usable = LANE_H - pad * 2;
    const ny = n.track * LANE_H + pad + (1 - (n.key - r.min) / span) * (usable - 6);
    const off = silent != null && silent[n.track];
    ctx.globalAlpha = off ? 0.12 : 0.35 + 0.65 * (n.velocity / 127);
    ctx.fillStyle = COLORS[n.program % COLORS.length];
    ctx.fillRect(x, ny, w, 6);
    ctx.globalAlpha = 1;
  }

  if (loopEndTick > loopStartTick && loopStartTick >= 0) {
    const x0 = GUTTER + (loopStartTick / tMax) * inner;
    const x1 = GUTTER + (loopEndTick / tMax) * inner;
    ctx.fillStyle = "rgba(91, 124, 250, 0.08)";
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
    ctx.fillStyle = "#5b7cfa";
    ctx.fillRect(x0, 0, 1, height);
    ctx.fillRect(x1, 0, 1, height);
  }

  if (playheadTick != null) {
    const x = GUTTER + (playheadTick / tMax) * inner;
    ctx.fillStyle = "#e7e9ef";
    ctx.fillRect(x, 0, 1, height);
  }
}
