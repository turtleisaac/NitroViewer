import { describe, expect, it } from "vitest";
import { blendedSample, nodeShown, resourceAlpha, resourceWire, shapeDraw } from "./polygonDraw";

describe("polygon draw", () => {
  it("skips polygon alpha 0, and a wireframe flag does not bring those edges back", () => {
    expect(shapeDraw(0, false, null, true)).toEqual({ visible: false, wireframe: false });
    expect(shapeDraw(0, true, null, true)).toEqual({ visible: false, wireframe: false });
    expect(shapeDraw(31, true, 0, true)).toEqual({ visible: false, wireframe: false });
  });

  it("draws a non-zero alpha, as edges only when the material flag is set", () => {
    expect(shapeDraw(31, false, null, true)).toEqual({ visible: true, wireframe: false });
    expect(shapeDraw(31, true, null, true)).toEqual({ visible: true, wireframe: true });
    expect(shapeDraw(0, false, 0.5, true)).toEqual({ visible: true, wireframe: false });
    expect(shapeDraw(31, true, 0.0323, false)).toEqual({ visible: false, wireframe: true });
  });

  it("reads extras, a blended sample, and the node bit", () => {
    const anim = { materials: [{ name: "lambert30", alpha: [0, 0.5] }] };

    expect(resourceAlpha(undefined)).toBe(31);
    expect(resourceAlpha(0)).toBe(0);
    expect(resourceWire(undefined)).toBe(false);
    expect(resourceWire(true)).toBe(true);
    expect(blendedSample(null, "lambert30", 0)).toBeNull();
    expect(blendedSample(anim, "other", 0)).toBeNull();
    expect(blendedSample(anim, "lambert30", 0)).toBe(0);
    expect(blendedSample(anim, "lambert30", 1)).toBe(0.5);
    expect(blendedSample(anim, "lambert30", 4)).toBeNull();
    expect(nodeShown(null, 0, 0)).toBe(true);
    expect(nodeShown([[1, 0]], undefined, 1)).toBe(true);
    expect(nodeShown([[1]], 3, 0)).toBe(true);
    expect(nodeShown([[1, 0]], 0, 1)).toBe(false);
    expect(nodeShown([[1, 0]], 0, 0)).toBe(true);
  });
});
