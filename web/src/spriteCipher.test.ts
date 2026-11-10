import { describe, expect, it } from "vitest";
import { clearCipherSeed, clearLockedSeed, isCipherSeedPixel, isLockedSeedPixel, seedPixelCount } from "./spriteCipher";
import { resolveRenderHints, resolveSpriteUnit, type EntryLike } from "./state/grouping";

describe("cipher seed pixels", () => {
  it("locks the first word of a forward sprite and the last word of a backward one", () => {
    expect(seedPixelCount(4)).toBe(4);
    expect(seedPixelCount(8)).toBe(2);
    expect(isCipherSeedPixel(0, 0, 160, 80, 4, false)).toBe(true);
    expect(isCipherSeedPixel(3, 0, 160, 80, 4, false)).toBe(true);
    expect(isCipherSeedPixel(4, 0, 160, 80, 4, false)).toBe(false);
    expect(isCipherSeedPixel(0, 0, 160, 80, 4, true)).toBe(false);
    expect(isCipherSeedPixel(156, 79, 160, 80, 4, true)).toBe(true);
    expect(isCipherSeedPixel(159, 79, 160, 80, 4, true)).toBe(true);
    expect(isCipherSeedPixel(155, 79, 160, 80, 4, true)).toBe(false);
  });

  it("clearCipherSeed forces only the key word back to 0", () => {
    const pixels = new Uint8Array(16);
    pixels.fill(5);
    const forward = clearCipherSeed(pixels, 16, 1, 4, false);
    expect(Array.from(forward.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(forward[4]).toBe(5);
    const backward = clearCipherSeed(pixels, 16, 1, 4, true);
    expect(backward[0]).toBe(5);
    expect(Array.from(backward.slice(12))).toEqual([0, 0, 0, 0]);
    expect(pixels[0]).toBe(5);
  });

  it("does not lock or clear a scanned sheet that has no cipher key", () => {
    const pixels = new Uint8Array(16);
    pixels.fill(5);
    expect(isLockedSeedPixel(false, 0, 0, 16, 1, 4, false)).toBe(false);
    expect(isLockedSeedPixel(false, 15, 0, 16, 1, 4, true)).toBe(false);
    const kept = clearLockedSeed(pixels, false, 16, 1, 4, false);
    expect(kept).toBe(pixels);
    expect(Array.from(kept)).toEqual(Array(16).fill(5));
  });

  it("still locks and clears a ciphered image in both directions", () => {
    expect(isLockedSeedPixel(true, 0, 0, 16, 1, 4, false)).toBe(true);
    expect(isLockedSeedPixel(true, 3, 0, 16, 1, 4, false)).toBe(true);
    expect(isLockedSeedPixel(true, 4, 0, 16, 1, 4, false)).toBe(false);
    expect(isLockedSeedPixel(true, 0, 0, 16, 1, 4, true)).toBe(false);
    expect(isLockedSeedPixel(true, 12, 0, 16, 1, 4, true)).toBe(true);
    expect(isLockedSeedPixel(true, 15, 0, 16, 1, 4, true)).toBe(true);

    const pixels = new Uint8Array(16);
    pixels.fill(5);
    const forward = clearLockedSeed(pixels, true, 16, 1, 4, false);
    expect(Array.from(forward.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(forward[4]).toBe(5);
    const backward = clearLockedSeed(pixels, true, 16, 1, 4, true);
    expect(backward[0]).toBe(5);
    expect(Array.from(backward.slice(12))).toEqual([0, 0, 0, 0]);
    expect(pixels[0]).toBe(5);
  });
});

describe("game DB cipher direction", () => {
  it("walks Diamond and Pearl trainer drawings and battle sprites backward", () => {
    expect(resolveRenderHints("ADAE", "/poketool/trgra/trbgra.narc", 0)?.scanDirection).toBe("back-to-front");
    expect(resolveRenderHints("APAE", "/poketool/trgra/trfgra.narc", 2)?.scanned).toBe(true);
    expect(resolveRenderHints("ADAE", "/poketool/trgra/trbgra.narc", 1)?.scanDirection).toBeUndefined();
    expect(resolveRenderHints("ADAE", "/poketool/pokegra/pokegra.narc", 3)?.scanDirection).toBe("back-to-front");
    expect(resolveRenderHints("APAJ", "/poketool/pokegra/otherpoke.narc", 0)?.scanDirection).toBe("back-to-front");
  });

  it("walks Platinum trainer scans forward and leaves the cell drawing alone", () => {
    expect(resolveRenderHints("CPUE", "/poketool/trgra/trbgra.narc", 0)).toEqual({ transparent: true });
    expect(resolveRenderHints("CPUE", "/poketool/trgra/trbgra.narc", 4)).toEqual({
      transparent: true,
      scanned: true,
      scanDirection: "front-to-back",
    });
    expect(resolveRenderHints("CPUJ", "/poketool/trgra/trfgra.narc", 9)?.scanDirection).toBe("front-to-back");
    expect(resolveRenderHints("CPUE", "/poketool/pokegra/pl_pokegra.narc", 1)?.scanDirection).toBe("front-to-back");
    expect(resolveRenderHints("CPUE", "/poketool/pokegra/pokegra.narc", 1)?.scanDirection).toBe("back-to-front");
  });

  it("walks HeartGold and SoulSilver trainer scans backward and Pokémon sprites forward", () => {
    expect(resolveRenderHints("IPKE", "/a/0/0/6", 0)?.scanDirection).toBeUndefined();
    expect(resolveRenderHints("IPKE", "/a/0/0/6", 4)).toMatchObject({
      scanned: true,
      scanDirection: "back-to-front",
    });
    expect(resolveRenderHints("IPGE", "/a/0/5/8", 4)?.scanDirection).toBe("back-to-front");
    expect(resolveRenderHints("IPKS", "/a/0/0/4", 2361)?.scanDirection).toBe("front-to-back");
    expect(resolveRenderHints("IPGP", "/a/1/1/4", 0)?.scanDirection).toBe("front-to-back");
    expect(resolveRenderHints("IPKE", "/pbr/pokegra.narc", 3)?.scanDirection).toBe("back-to-front");
    expect(resolveRenderHints("IPGJ", "/pbr/otherpoke.narc", 1)?.scanDirection).toBe("back-to-front");
  });

  it("does not invent a direction for an unlisted archive", () => {
    expect(resolveRenderHints("CPUE", "/graphic/font.narc", 0)).toBeNull();
    expect(resolveRenderHints("ABCD", "/poketool/trgra/trbgra.narc", 4)).toBeNull();
  });

  it("pairs a Platinum trainer cell with the drawing, not the ciphered scan", () => {
    const entries: EntryLike[] = [];
    for (let n = 0; n < 2; n++) {
      const base = n * 5;
      entries.push(
        { index: base, format: "NCGR" },
        { index: base + 1, format: "NCLR" },
        { index: base + 2, format: "NCER" },
        { index: base + 3, format: "NANR" },
        { index: base + 4, format: "NCGR" }
      );
    }
    const cell = resolveSpriteUnit("CPUE", "/poketool/trgra/trbgra.narc", 7, entries, 2);
    expect(cell?.ncgr).toEqual({ container: 7, id: 0 });
    expect(cell?.nclr).toEqual({ container: 7, id: 1 });
    const scan = resolveSpriteUnit("IPKE", "/a/0/0/6", 3, entries, 4);
    expect(scan?.ncgr).toEqual({ container: 3, id: 4 });
    expect(scan?.nclr).toEqual({ container: 3, id: 1 });
  });
});
