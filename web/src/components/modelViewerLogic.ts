import { pickAnimByName } from "../state/pairing";
import type { ResourceItem } from "../state/store";
import { refKey, type ResourceRef } from "../transport";

/** Model name at `index`, or empty when the set has not loaded. */
export function modelNameAt(info: { models: string[] } | null, index: number): string {
  const name = info?.models[index];
  return name ?? "";
}

/** NSBCA chosen by clip name, or null when nothing pairs. */
export function pairedNsbca(
  items: ResourceItem[],
  names: Record<string, string[]>,
  modelName: string,
  selfId: number,
): ResourceRef | null {
  return pickAnimByName(items, names, modelName, selfId) ?? null;
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
