import { resolveExplicitUnit, type ExplicitUnit } from "../state/grouping";
import { pickAnimByName } from "../state/pairing";
import { useStore, type ResourceItem } from "../state/store";
import { refKey, type ResourceRef } from "../transport";

/** Model name at `index`, or empty when the set has not loaded. */
export function modelNameAt(info: { models: string[] } | null, index: number): string {
  const name = info?.models[index];
  return name ?? "";
}

/** Explicit NSBCA when the unit names one, otherwise the heuristic choice. */
export function chosenNsbca(unit: ExplicitUnit | null, fallback: ResourceRef | null): ResourceRef | null {
  // No unit, or a unit that does not name an animation, keeps the heuristic.
  if (unit === null) {
    return fallback;
  }

  const listed = unit.nsbca;

  if (listed === undefined) {
    return fallback;
  }

  if (listed.length === 0) {
    return fallback;
  }

  return listed[0];
}

/** Explicit NSBCA for the open file, then the clip-name choice. */
export function pairedNsbca(
  items: ResourceItem[],
  names: Record<string, string[]>,
  modelName: string,
  selfId: number,
  unit: ExplicitUnit | null = openExplicitUnit(),
): ResourceRef | null {
  // Name match, then nearest index. Missing both leaves the slot empty.
  const named = pickAnimByName(items, names, modelName, selfId);
  let heuristic: ResourceRef | null = null;

  if (named !== undefined) {
    heuristic = named;
  }

  return chosenNsbca(unit, heuristic);
}

/** Explicit unit for the file the store has open, or null. */
function openExplicitUnit(): ExplicitUnit | null {
  const state = useStore.getState();
  const selection = state.selection;

  if (selection === null) {
    return null;
  }

  // The ROM header may not be loaded yet.
  let gameCode: string | undefined;

  if (state.romInfo === null) {
    gameCode = undefined;
  } else {
    gameCode = state.romInfo.gameCode;
  }

  const narcPath = state.narcPathOf(selection.ref.container);

  return resolveExplicitUnit(gameCode, narcPath, selection.ref.container, selection.ref.id);
}

/** Key that changes when the model or the loaded NSBCA clip names change. */
export function nsbcaPairKey(
  selKey: string,
  modelIndex: number,
  modelName: string,
  items: ResourceItem[],
  names: Record<string, string[]>,
): string {
  const itemKeys = items.map((item) => refKey(item.ref)).join(",");
  const nameKeys = Object.entries(names).map(([key, list]) => `${key}=${list.join(",")}`).join(";");
  return [selKey, modelIndex, modelName, itemKeys, nameKeys].join("\0");
}

/** Value of the Textures `<select>`. */
export function textureValue(useEmbedded: boolean, nsbtx: ResourceRef | null): string {
  if (useEmbedded) return "embedded";
  if (!nsbtx) return "";
  return refKey(nsbtx);
}

/** Apply a Textures dropdown choice to the embedded flag and the external NSBTX. */
export function applyTextureChoice(
  value: string,
  items: ResourceItem[],
  setUseEmbedded: (embedded: boolean) => void,
  setNsbtx: (ref: ResourceRef | null) => void,
): void {
  if (value === "embedded") {
    setUseEmbedded(true);
    setNsbtx(null);
    return;
  }
  const match = items.find((item) => refKey(item.ref) === value);
  if (!match) return;
  setUseEmbedded(false);
  setNsbtx(match.ref);
}

/** Option label for one NSBCA, preferring its first clip name. */
export function nsbcaLabel(item: ResourceItem, names: Record<string, string[]>): string {
  const list = names[refKey(item.ref)];
  const clip = list && list.length ? list[0] : null;
  if (clip) return `${clip} (${item.label})`;
  return `NSBCA ${item.label}`;
}

/** First item whose ref key matches, or null. */
export function findRef(items: ResourceItem[], value: string): ResourceRef | null {
  return items.find((item) => refKey(item.ref) === value)?.ref ?? null;
}

/** Label for a model `<option>`, falling back when the set left the name blank. */
export function modelOptionLabel(name: string, index: number): string {
  return name || `model ${index}`;
}

/** True when skeletal clips or a material track can drive the viewport. */
export function showPlayback(
  animNames: string[],
  nsbma: ResourceRef | null,
  nsbva: ResourceRef | null,
  nsbtp: ResourceRef | null,
): boolean {
  return animNames.length > 0 || !!nsbma || !!nsbva || !!nsbtp;
}

/** True when the interval should advance the mixer and the non-skeletal tracks. */
export function canPlayModel(
  scene: { matColor: unknown; vis: unknown; texPat: unknown } | null,
  playing: boolean,
  busy: boolean,
  info: unknown,
  animNames: string[],
): boolean {
  if (!scene || !playing || busy || !info) return false;
  return animNames.length > 0 || !!scene.matColor || !!scene.vis || !!scene.texPat;
}

/** `.obj` file name, case-insensitive. */
export function isObjName(name: string): boolean {
  return /\.obj$/i.test(name);
}

/** File whose MIME type is not an image. Used as the OBJ fallback. */
export function lacksImageMime(file: File): boolean {
  return !file.type.startsWith("image/");
}

/** Image chosen as an OBJ texture, by MIME type or extension. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|bmp|jpe?g|gif)$/i.test(file.name);
}

/** OBJ file: a `.obj` name, otherwise the first non-image MIME. */
export function pickObjFile(files: File[]): File | undefined {
  return files.find((file) => isObjName(file.name)) ?? files.find((file) => lacksImageMime(file));
}

/** Texture image accompanying an OBJ import. */
export function pickTexFile(files: File[]): File | undefined {
  return files.find((file) => isImageFile(file));
}

/** `[u32 LE objLen][obj bytes][texture bytes]` payload the textured OBJ import expects. */
export function frameObjPayload(objBytes: Uint8Array, texBytes: Uint8Array): Uint8Array {
  const payload = new Uint8Array(4 + objBytes.length + texBytes.length);
  new DataView(payload.buffer).setUint32(0, objBytes.length, true);
  payload.set(objBytes, 4);
  payload.set(texBytes, 4 + objBytes.length);
  return payload;
}
