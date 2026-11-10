/** Pixels covered by the cipher key word. 4bpp is 4, 8bpp is 2. See Gen4SpriteCipher.java. */
export function seedPixelCount(bitDepth: number): number {
  return bitDepth === 8 ? 2 : 4;
}

/** True when (x, y) is part of the key word. Front-to-back uses the first word, back-to-front the last. */
export function isCipherSeedPixel(
  x: number,
  y: number,
  width: number,
  height: number,
  bitDepth: number,
  seedAtEnd: boolean,
): boolean {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return false;

  const n = seedPixelCount(bitDepth);
  const index = y * width + x;
  const total = width * height;
  if (seedAtEnd) return index >= total - n;
  return index < n;
}

/** True when the editor must leave this pixel alone. A scan with no key is never locked. */
export function isLockedSeedPixel(
  ciphered: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  bitDepth: number,
  seedAtEnd: boolean,
): boolean {
  if (!ciphered) return false;
  return isCipherSeedPixel(x, y, width, height, bitDepth, seedAtEnd);
}

/** Puts the key word back to 0 after a fill. Returns the same buffer when there is no key. */
export function clearLockedSeed(
  pixels: Uint8Array,
  ciphered: boolean,
  width: number,
  height: number,
  bitDepth: number,
  seedAtEnd: boolean,
): Uint8Array {
  if (!ciphered) return pixels;
  return clearCipherSeed(pixels, width, height, bitDepth, seedAtEnd);
}

/** Returns a copy with the key word set back to 0. */
export function clearCipherSeed(
  pixels: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  seedAtEnd: boolean,
): Uint8Array {
  const out = new Uint8Array(pixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isCipherSeedPixel(x, y, width, height, bitDepth, seedAtEnd)) out[y * width + x] = 0;
    }
  }
  return out;
}
