import { describe, expect, it } from "vitest";
import { noteTrackHeight, NOTE_LANE_HEIGHT } from "./noteTrack";

describe("noteTrack", () => {
  it("sizes one lane per track", () => {
    expect(noteTrackHeight(1)).toBe(NOTE_LANE_HEIGHT);
    expect(noteTrackHeight(8)).toBe(NOTE_LANE_HEIGHT * 8);
    expect(noteTrackHeight(0)).toBe(NOTE_LANE_HEIGHT);
  });
});
