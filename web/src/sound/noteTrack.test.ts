import { describe, expect, it } from "vitest";
import { noteTrackHeight, NOTE_LANE_HEIGHT, NOTE_GUTTER, tickFromCanvasX } from "./noteTrack";

describe("noteTrack", () => {
  it("sizes one lane per track", () => {
    expect(noteTrackHeight(1)).toBe(NOTE_LANE_HEIGHT);
    expect(noteTrackHeight(8)).toBe(NOTE_LANE_HEIGHT * 8);
    expect(noteTrackHeight(0)).toBe(NOTE_LANE_HEIGHT);
  });

  it("maps canvas x to ticks past the gutter", () => {
    const width = NOTE_GUTTER + 100;
    expect(tickFromCanvasX(NOTE_GUTTER, width, 200)).toBe(0);
    expect(tickFromCanvasX(NOTE_GUTTER + 50, width, 200)).toBe(100);
    expect(tickFromCanvasX(NOTE_GUTTER + 100, width, 200)).toBe(200);
    expect(tickFromCanvasX(0, width, 200)).toBe(0);
  });
});
