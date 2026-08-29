import { describe, it, expect } from "vitest";
import {
  resolveGame,
  resolveNarcInfo,
  resolveRenderHints,
  resolveSpriteUnit,
  groupUnit,
  type EntryLike,
} from "./grouping";

describe("resolveGame", () => {
  it("matches Platinum (CPUE) via the CPU* wildcard", () => {
    expect(resolveGame("CPUE")?.title).toBe("Pokémon Platinum");
  });
  it("matches HeartGold / SoulSilver via their wildcards", () => {
    expect(resolveGame("IPKE")?.title).toBe("Pokémon HeartGold");
    expect(resolveGame("IPGE")?.title).toBe("Pokémon SoulSilver");
  });
  it("returns null for an unlisted game", () => {
    expect(resolveGame("ABCD")).toBeNull();
    expect(resolveGame(undefined)).toBeNull();
  });
});

describe("resolveRenderHints", () => {
  it("returns the NARC's declared render hints (Platinum trainer back sprites are scanned)", () => {
    const h = resolveRenderHints("CPUE", "/poketool/trgra/trbgra.narc", 0);
    expect(h).toEqual({ transparent: true, scanned: true });
  });
  it("returns transparent for the trainer front sprites", () => {
    expect(resolveRenderHints("CPUE", "/poketool/trgra/trfgra.narc", 4)?.transparent).toBe(true);
  });
  it("returns null for an unlisted NARC (heuristic fallback)", () => {
    expect(resolveRenderHints("CPUE", "/poketool/unknown.narc", 0)).toBeNull();
  });
});

describe("resolveNarcInfo", () => {
  it("labels a listed NARC with the game title + role for the badge", () => {
    expect(resolveNarcInfo("CPUE", "/poketool/trgra/trfgra.narc")).toEqual({
      title: "Pokémon Platinum",
      role: "trainer-front-sprites",
    });
  });
  it("returns null when the NARC isn't in the manifest", () => {
    expect(resolveNarcInfo("CPUE", "/whatever.narc")).toBeNull();
  });
});

describe("resolveSpriteUnit — Platinum battle sprites (pl_pokegra, PokEditor-Core layout)", () => {
  // 6-file interleaved unit: femaleBack, maleBack, femaleFront, maleFront, palette, shinyPalette.
  const entries: EntryLike[] = [];
  for (let s = 0; s < 3; s++) {
    entries.push({ index: s * 6 + 0, format: "NCGR" });
    entries.push({ index: s * 6 + 1, format: "NCGR" });
    entries.push({ index: s * 6 + 2, format: "NCGR" });
    entries.push({ index: s * 6 + 3, format: "NCGR" });
    entries.push({ index: s * 6 + 4, format: "NCLR" });
    entries.push({ index: s * 6 + 5, format: "NCLR" });
  }
  const PATH = "/poketool/pokegra/pl_pokegra.narc";

  it("pairs any clicked sprite with its species' (non-shiny) palette and keeps the clicked sprite", () => {
    // Click species-1 male-front (index 9) → palette = species-1 PALETTE (index 10), not SHINY (11).
    const u = resolveSpriteUnit("CPUE", PATH, 0, entries, 9);
    expect(u?.ncgr).toEqual({ container: 0, id: 9 }); // the clicked sprite
    expect(u?.nclr).toEqual({ container: 0, id: 10 }); // its species PALETTE (first NCLR in the unit)
  });
  it("resolves the same palette for every sprite in the species", () => {
    for (const id of [6, 7, 8, 9]) {
      expect(resolveSpriteUnit("CPUE", PATH, 0, entries, id)?.nclr).toEqual({ container: 0, id: 10 });
    }
  });
});

describe("resolveSpriteUnit (against the real manifest)", () => {
  it("returns null for a declared NARC with no grouping (render-hints only → heuristic pairing)", () => {
    const entries: EntryLike[] = [{ index: 4, format: "NCGR" }];
    expect(resolveSpriteUnit("CPUE", "/poketool/trgra/trfgra.narc", 0, entries, 4)).toBeNull();
  });
  it("returns null for an unlisted NARC", () => {
    expect(resolveSpriteUnit("CPUE", "/nope.narc", 0, [], 0)).toBeNull();
  });
});

// The grouping arithmetic, tested directly on the pure helper with synthetic uniform archives.
describe("groupUnit strategies", () => {
  const order = ["NCGR", "NCLR", "NCER", "NANR"];
  const interleaved: EntryLike[] = [];
  for (let u = 0; u < 3; u++) {
    order.forEach((fmt, k) => interleaved.push({ index: u * 4 + k, format: fmt }));
  }

  it("interleaved: clicking any member resolves the whole unit (stride = order length)", () => {
    expect(groupUnit({ strategy: "interleaved", order }, interleaved, 7, 0)).toEqual({
      ncgr: { container: 0, id: 4 },
      nclr: { container: 0, id: 5 },
      ncer: { container: 0, id: 6 },
      nanr: { container: 0, id: 7 },
    });
    expect(groupUnit({ strategy: "interleaved", order }, interleaved, 0, 0)?.nanr).toEqual({
      container: 0,
      id: 3,
    });
  });

  it("lockstep: equal-length runs of each format; unit i = i-th of each run", () => {
    // 8 entries = two runs of 4 (NCGR block then NCLR block).
    const lock: EntryLike[] = [
      { index: 0, format: "NCGR" }, { index: 1, format: "NCGR" }, { index: 2, format: "NCGR" }, { index: 3, format: "NCGR" },
      { index: 4, format: "NCLR" }, { index: 5, format: "NCLR" }, { index: 6, format: "NCLR" }, { index: 7, format: "NCLR" },
    ];
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"] }, lock, 2, 5)).toEqual({
      ncgr: { container: 5, id: 2 },
      nclr: { container: 5, id: 6 },
    });
  });

  it("returns null when the clicked id isn't in the entry list", () => {
    expect(groupUnit({ strategy: "interleaved", order }, interleaved, 99, 0)).toBeNull();
  });
});
