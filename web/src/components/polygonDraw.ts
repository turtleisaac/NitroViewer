// NNS sbc.c: after funcBlendMat, polygon alpha 0 sets NNS_G3D_RSFLAG_MAT_TRANSPARENT and
// emits no material commands, so the shape command skips the display list. GBATEK treats
// alpha 0 as wireframe on the geometry engine. NNS_G3D_MATFLAG_WIREFRAME (0x0020) only
// clears a non-zero alpha before those commands are sent. An alpha of 0 is never submitted.

export interface ShapeState {
  visible: boolean;
  wireframe: boolean;
}

/** Resource alpha is 0..31. A blended sample is 0..1, and null means no NSBMA track. */
export function shapeDraw(
  polygonAlpha: number,
  wireframe: boolean,
  blendedAlpha: number | null,
  nodeVisible: boolean,
): ShapeState {
  const alpha = pickedAlpha(polygonAlpha, blendedAlpha);

  if (alpha === 0) {
    return { visible: false, wireframe: false };
  }

  return shownShape(wireframe, nodeVisible);
}

/** Polygon alpha from glTF material extras, or 31 when the export predates the field. */
export function resourceAlpha(value: unknown): number {
  if (typeof value !== "number") {
    return 31;
  }

  return value;
}

/** Wireframe flag from glTF material extras. Only a real true requests edges. */
export function resourceWire(value: unknown): boolean {
  return value === true;
}

interface AlphaTrack {
  name: string;
  alpha: number[];
}

/** Blended polygon alpha for one material, or null when this frame has no sample. */
export function blendedSample(
  anim: { materials: AlphaTrack[] } | null,
  materialName: string,
  frame: number,
): number | null {
  if (anim === null) {
    return null;
  }

  return sampleList(anim.materials, materialName, frame, 0);
}

/** Node-visibility bit for this frame. No row leaves the node shown. */
export function nodeShown(rows: number[][] | null, node: number | undefined, frame: number): boolean {
  if (rows === null) {
    return true;
  }

  return rowShown(rows, node, frame);
}

// The blend replaces the resource alpha. Null keeps the resource value.
function pickedAlpha(polygonAlpha: number, blendedAlpha: number | null): number {
  if (blendedAlpha === null) {
    return polygonAlpha;
  }

  return blendedAlpha;
}

// A submitted shape is hidden while its node track is off. The wireframe flag stays.
function shownShape(wireframe: boolean, nodeVisible: boolean): ShapeState {
  if (!nodeVisible) {
    return { visible: false, wireframe };
  }

  return { visible: true, wireframe };
}

// Walk the material tracks. A handful of names, so the index is the cursor.
function sampleList(materials: AlphaTrack[], materialName: string, frame: number, index: number): number | null {
  if (index >= materials.length) {
    return null;
  }

  return sampleAt(materials, materialName, frame, index);
}

// Take this track when the name matches, otherwise keep walking.
function sampleAt(materials: AlphaTrack[], materialName: string, frame: number, index: number): number | null {
  const track = materials[index];

  if (track.name !== materialName) {
    return sampleList(materials, materialName, frame, index + 1);
  }

  return frameAlpha(track.alpha, frame);
}

// A missing key is not a blend to zero. Zero is a real sample.
function frameAlpha(alpha: number[], frame: number): number | null {
  const value = alpha[frame];

  if (value === undefined) {
    return null;
  }

  return value;
}

// No node id, or no visibility row, leaves the mesh shown.
function rowShown(rows: number[][], node: number | undefined, frame: number): boolean {
  if (node === undefined) {
    return true;
  }

  return bitShown(rows[node], frame);
}

// A 0 bit hides the node. A missing row does not.
function bitShown(row: number[] | undefined, frame: number): boolean {
  if (row === undefined) {
    return true;
  }

  return row[frame] !== 0;
}
