import { describe, expect, it, vi } from "vitest";
import type { ResourceItem } from "../state/store";
import {
  applyTextureChoice,
  canPlayModel,
  findRef,
  frameObjPayload,
  isImageFile,
  isObjName,
  lacksImageMime,
  modelNameAt,
  modelOptionLabel,
  nsbcaLabel,
  pairedNsbca,
  pickObjFile,
  pickTexFile,
  showPlayback,
  textureValue,
} from "./modelViewerLogic";
import { fileStem, formatsOf, refDep, resourcesInContainer } from "./viewerShared";

function item(id: number, format: string, label = `#${id}`): ResourceItem {
  return { ref: { container: 1, id }, label, format };
}

describe("model viewer choices", () => {
  it("names a model and a texture selection", () => {
    expect(modelNameAt(null, 0)).toBe("");
    expect(modelNameAt({ models: ["body"] }, 0)).toBe("body");
    expect(modelNameAt({ models: [] }, 0)).toBe("");
    expect(modelOptionLabel("", 2)).toBe("model 2");
    expect(modelOptionLabel("body", 0)).toBe("body");
    expect(textureValue(true, { container: 1, id: 2 })).toBe("embedded");
    expect(textureValue(false, null)).toBe("");
    expect(textureValue(false, { container: 1, id: 2 })).toBe("1:2");
  });

  it("applies a texture choice and finds a sibling ref", () => {
    const setEmbedded = vi.fn();
    const setNsbtx = vi.fn();
    const items = [item(4, "NSBTX")];
    applyTextureChoice("embedded", items, setEmbedded, setNsbtx);
    expect(setEmbedded).toHaveBeenCalledWith(true);
    expect(setNsbtx).toHaveBeenCalledWith(null);
    applyTextureChoice("1:4", items, setEmbedded, setNsbtx);
    expect(setNsbtx).toHaveBeenCalledWith(items[0].ref);
    applyTextureChoice("missing", items, setEmbedded, setNsbtx);
    expect(findRef(items, "1:4")).toEqual(items[0].ref);
    expect(findRef(items, "nope")).toBeNull();
  });

  it("labels an animation set and decides when playback is useful", () => {
    const anim = item(3, "NSBCA", "walk");
    expect(nsbcaLabel(anim, {})).toBe("NSBCA walk");
    expect(nsbcaLabel(anim, { "1:3": [] })).toBe("NSBCA walk");
    expect(nsbcaLabel(anim, { "1:3": ["manene"] })).toBe("manene (walk)");
    expect(pairedNsbca([], {}, "body", 1)).toBeNull();
    expect(showPlayback([], null, null, null)).toBe(false);
    expect(showPlayback(["a"], null, null, null)).toBe(true);
    expect(showPlayback([], { container: 1, id: 1 }, null, null)).toBe(true);
    const scene = { matColor: null, vis: null, texPat: null };
    expect(canPlayModel(null, true, false, {}, ["a"])).toBe(false);
    expect(canPlayModel(scene, false, false, {}, ["a"])).toBe(false);
    expect(canPlayModel(scene, true, true, {}, ["a"])).toBe(false);
    expect(canPlayModel(scene, true, false, null, ["a"])).toBe(false);
    expect(canPlayModel(scene, true, false, {}, [])).toBe(false);
    expect(canPlayModel(scene, true, false, {}, ["a"])).toBe(true);
    expect(canPlayModel({ ...scene, matColor: {} }, true, false, {}, [])).toBe(true);
    expect(canPlayModel({ ...scene, vis: {} }, true, false, {}, [])).toBe(true);
    expect(canPlayModel({ ...scene, texPat: {} }, true, false, {}, [])).toBe(true);
  });

  it("picks an OBJ and its texture out of a dropped file list", () => {
    const obj = new File([new Uint8Array([1])], "hero.OBJ", { type: "" });
    const png = new File([new Uint8Array([2])], "hero.png", { type: "image/png" });
    const other = new File([new Uint8Array([3])], "notes.txt", { type: "text/plain" });
    expect(isObjName("hero.obj")).toBe(true);
    expect(isObjName("hero.md")).toBe(false);
    expect(lacksImageMime(obj)).toBe(true);
    expect(lacksImageMime(png)).toBe(false);
    expect(isImageFile(png)).toBe(true);
    expect(isImageFile(new File([], "a.jpeg"))).toBe(true);
    expect(isImageFile(other)).toBe(false);
    expect(pickObjFile([png, obj])?.name).toBe("hero.OBJ");
    expect(pickObjFile([png, other])?.name).toBe("notes.txt");
    expect(pickObjFile([png])).toBeUndefined();
    expect(pickTexFile([obj, png])?.name).toBe("hero.png");
    const framed = frameObjPayload(new Uint8Array([9, 8]), new Uint8Array([7]));
    expect(Array.from(framed)).toEqual([2, 0, 0, 0, 9, 8, 7]);
  });

  it("lists the files that share a container", () => {
    const loose = [item(1, "NSBMD")];
    expect(resourcesInContainer(-1, {}, loose)).toBe(loose);
    expect(resourcesInContainer(4, {}, loose)).toEqual([]);
    const listed = resourcesInContainer(4, { 4: { entries: [{ index: 2, format: "NSBTX" }] } }, loose);
    expect(listed[0]).toMatchObject({ label: "#2", format: "NSBTX" });
    expect(formatsOf(listed, "NSBTX")).toHaveLength(1);
    expect(formatsOf(listed, "NSBCA")).toEqual([]);
    expect(fileStem("a/b/hero.nsbmd", "model")).toBe("hero.nsbmd");
    expect(fileStem("", "model")).toBe("model");
    expect(refDep(null)).toBe("");
    expect(refDep({ container: 1, id: 2 })).toBe("1:2");
  });
});
