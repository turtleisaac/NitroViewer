import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveGame,
  resolveNarcInfo,
  resolveRenderHints,
  resolveRenderHintsIn,
  resolveSpriteUnit,
  resolveSpriteUnitIn,
  resolveExplicitUnit,
  resolveExplicitUnitIn,
  groupUnit,
  explicitIssues,
  playbackRateFor,
  explicitUnitsContaining,
  explicitUnitsIn,
  type EntryLike,
  type ExplicitMember,
  type GroupingSpec,
} from "./grouping";
import { KNOWN_FORMATS } from "../util";

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
  it("matches a lower-case code the same way the Java loader does", () => {
    expect(resolveGame("cpue")?.title).toBe("Pokémon Platinum");
  });
});

// Same document as Gen4SpriteCipherTest.directionPrecedenceAgrees. Exact code beats the wildcard,
// a matching cipher rule beats render.scanDirection, and a per-entry hint beats both.
const conflictDb = {
  version: 1,
  games: {
    "zzz*": {
      title: "Wildcard",
      narcs: {
        "/conflict.narc": {
          render: { scanDirection: "front-to-back" as const },
          cipher: { indexMod: 5, indexRem: 4, scanDirection: "back-to-front" as const },
          entries: { "4": { scanDirection: "front-to-back" as const } },
        },
      },
    },
    ZZZE: {
      title: "Exact",
      narcs: {
        "/conflict.narc": {
          render: { scanDirection: "back-to-front" as const },
        },
      },
    },
  },
};

describe("cipher direction precedence", () => {
  it("agrees with the Java conflict document", () => {
    const dir = (code: string, id: number) =>
      resolveRenderHintsIn(conflictDb, code, "/conflict.narc", id)?.scanDirection;
    expect(dir("ZZZE", 4)).toBe("back-to-front");
    expect(dir("zzze", 4)).toBe("back-to-front");
    expect(dir("ZZZJ", 0)).toBe("front-to-back");
    expect(dir("ZZZJ", 9)).toBe("back-to-front");
    expect(dir("ZZZJ", 4)).toBe("front-to-back");
    expect(resolveRenderHintsIn(conflictDb, "ZZZJ", "/conflict.narc", 9)?.scanned).toBe(true);
  });

  it("skips a negative index, ciphers every entry when there is no modulus, and ignores a non-positive modulus", () => {
    const source = {
      version: 1,
      games: {
        CPUE: {
          title: "Exact",
          narcs: {
            "/every.narc": { cipher: { scanDirection: "back-to-front" as const } },
            "/none.narc": {
              render: { scanDirection: "front-to-back" as const },
              cipher: { indexMod: -5, scanDirection: "back-to-front" as const },
            },
            "/zero.narc": {
              render: { scanDirection: "front-to-back" as const },
              cipher: { indexMod: 0, scanDirection: "back-to-front" as const },
            },
          },
        },
      },
    };

    expect(resolveRenderHintsIn(source, "CPUE", "/every.narc", 0)?.scanned).toBe(true);
    expect(resolveRenderHintsIn(source, "CPUE", "/every.narc", -1)).toBeNull();
    expect(resolveRenderHintsIn(source, "CPUE", "/none.narc", 0)?.scanDirection).toBe("front-to-back");
    expect(resolveRenderHintsIn(source, "CPUE", "/zero.narc", 0)?.scanDirection).toBe("front-to-back");
  });
});

describe("resolveRenderHints", () => {
  it("leaves a Platinum trainer drawing unciphered and marks the scan", () => {
    expect(resolveRenderHints("CPUE", "/poketool/trgra/trbgra.narc", 0)).toEqual({ transparent: true });
    expect(resolveRenderHints("CPUE", "/poketool/trgra/trbgra.narc", 4)).toEqual({
      transparent: true,
      scanned: true,
      scanDirection: "front-to-back",
    });
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
    expect(resolveNarcInfo("ABCD", "/whatever.narc")).toBeNull();
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
    expect(resolveSpriteUnit("CPUE", "/poketool/icongra/pl_poke_icon.narc", 0, entries, 4)).toBeNull();
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
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"] }, lock, 99, 5)).toBeNull();
  });

  it("returns null when the clicked id isn't in the entry list", () => {
    expect(groupUnit({ strategy: "interleaved", order }, interleaved, 99, 0)).toBeNull();
  });

  it("keeps the first repeated companion and uses the clicked file for its role", () => {
    const entries: EntryLike[] = [
      { index: 10, format: "NCGR" },
      { index: 11, format: "NCLR" },
      { index: 12, format: "NCLR" },
    ];
    expect(groupUnit({ strategy: "interleaved", order: ["NCGR", "NCLR", "NCLR"] }, entries, 10, 0)).toEqual({
      ncgr: { container: 0, id: 10 },
      nclr: { container: 0, id: 11 },
    });
  });

  it("stops an interleaved unit at the end of a short archive", () => {
    const entries: EntryLike[] = [
      { index: 0, format: "NCGR" },
      { index: 1, format: "NCLR" },
      { index: 2, format: "NCER" },
    ];
    expect(groupUnit({ strategy: "interleaved", order }, entries, 2, 0)).toEqual({
      ncgr: { container: 0, id: 0 },
      nclr: { container: 0, id: 1 },
      ncer: { container: 0, id: 2 },
    });
  });

  it("uses a declared lockstep count and skips a run that would pass the archive", () => {
    const entries: EntryLike[] = [
      { index: 0, format: "NCGR" },
      { index: 1, format: "NCGR" },
    ];
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"], count: 10 }, entries, 0, 4)).toEqual({
      ncgr: { container: 4, id: 0 },
    });
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR", "NCER", "NANR"] }, entries, 0, 4)).toBeNull();
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"], count: 0 }, entries, 0, 4)).toBeNull();
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"], count: 1 }, [{ index: 0, format: "NCGR" }], 0, 4)).toEqual({
      ncgr: { container: 4, id: 0 },
    });
    const longLock: EntryLike[] = [
      { index: 0, format: "NCGR" },
      { index: 1, format: "NCLR" },
      { index: 2, format: "NCER" },
      { index: 3, format: "NANR" },
    ];
    expect(groupUnit({ strategy: "lockstep", order: ["NCGR", "NCLR"], count: 1 }, longLock, 0, 1)).toEqual({
      ncgr: { container: 1, id: 0 },
      nclr: { container: 1, id: 1 },
    });
  });

  it("returns null for a stride grouping that has no order", () => {
    const entries: EntryLike[] = [{ index: 0, format: "NCGR" }];
    expect(groupUnit({ strategy: "interleaved" }, entries, 0, 0)).toBeNull();
    expect(groupUnit({ strategy: "lockstep" }, entries, 0, 0)).toBeNull();
  });
});

const shared: ExplicitMember[] = [
  { nclr: 63, ncgr: 64, ncer: 65, nanr: 66 },
  { ncgr: 70, nclr: 63 },
  { ncgr: 4, nclr: 4 },
];

describe("explicit units", () => {
  it("accepts partial units, index 0, and every format role", () => {
    expect(explicitIssues([{ nanr: 0 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ ncgr: 64, nanr: 66 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ ncgr: 1 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ nclr: 1 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ ncer: 1 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ nanr: 1 }], "explicit")).toEqual([]);
    expect(explicitIssues(undefined, "interleaved")).toEqual([]);
    expect(explicitIssues(undefined, "lockstep")).toEqual([]);
    expect(explicitIssues(undefined, undefined)).toEqual([]);
    for (const format of KNOWN_FORMATS) {
      expect(explicitIssues([{ [format.toLowerCase()]: 1 }], "explicit")).toEqual([]);
    }
  });

  it("rejects a bad role, a negative index, and a non-integer", () => {
    expect(explicitIssues([{ NCGR: 1 }], "explicit")).toEqual(["unit 0 has unknown role NCGR"]);
    expect(explicitIssues([{ foo: 1, ncgr: -1 }], "explicit")).toEqual([
      "unit 0 has unknown role foo",
      "unit 0 ncgr is negative",
    ]);
    expect(explicitIssues([{ nclr: -2 }], "explicit")).toEqual(["unit 0 nclr is negative"]);
    expect(explicitIssues([{ ncgr: 1.5 }], "explicit")).toEqual(["unit 0 ncgr is not a whole number"]);
    expect(explicitIssues([{ ncgr: "1" }], "explicit")).toEqual(["unit 0 ncgr is not a whole number"]);
    expect(explicitIssues([{ ncer: true }], "explicit")).toEqual(["unit 0 ncer is not a whole number"]);
    expect(explicitIssues([{ nanr: Number.NaN }], "explicit")).toEqual(["unit 0 nanr is not a whole number"]);
    expect(explicitIssues([{ model: 1 }], "explicit")).toEqual(["unit 0 has unknown role model"]);
    expect(explicitIssues([{ NSBMD: 0 }], "explicit")).toEqual(["unit 0 has unknown role NSBMD"]);
    expect(explicitIssues([{ nsbca: [] }], "explicit")).toEqual(["unit 0 nsbca is empty"]);
    expect(explicitIssues([{ nsbca: [1, -2] }], "explicit")).toEqual(["unit 0 nsbca is negative"]);
    expect(explicitIssues([{ nsbtx: [1, 1.5] }], "explicit")).toEqual(["unit 0 nsbtx is not a whole number"]);
    expect(explicitIssues([{ nscr: ["2"] }], "explicit")).toEqual(["unit 0 nscr is not a whole number"]);
  });

  it("rejects an empty unit, a non-object, a non-list, and a missing explicit list", () => {
    expect(explicitIssues([{}], "explicit")).toEqual(["unit 0 has no members"]);
    expect(explicitIssues([null], "explicit")).toEqual(["unit 0 is not an object"]);
    expect(explicitIssues([1], "explicit")).toEqual(["unit 0 is not an object"]);
    expect(explicitIssues(["x"], "explicit")).toEqual(["unit 0 is not an object"]);
    expect(explicitIssues([[]], "explicit")).toEqual(["unit 0 is not an object"]);
    expect(explicitIssues({ ncgr: 1 }, "explicit")).toEqual(["explicit units are not a list"]);
    expect(explicitIssues(null, "interleaved")).toEqual(["explicit units are not a list"]);
    expect(explicitIssues(undefined, "explicit")).toEqual(["explicit grouping needs units"]);
    expect(explicitIssues([], "explicit")).toEqual([]);
    expect(explicitIssues([{ ncgr: 1 }, { nclr: -1 }], "explicit")).toEqual(["unit 1 nclr is negative"]);
    expect(explicitIssues([{ spa: 151, playbackRate: 30 }], "explicit")).toEqual([]);
    expect(explicitIssues([{ spa: 151, playbackRate: 0 }], "explicit")).toEqual([
      "unit 0 playbackRate is not a positive number",
    ]);
    expect(explicitIssues([{ playbackRate: 30 }], "explicit")).toEqual(["unit 0 has no members"]);
    expect(playbackRateFor("IPKE", "/a/1/0/9", 151)).toBe(30);
    expect(playbackRateFor("IPGE", "/a/1/0/9", 152)).toBe(30);
    expect(playbackRateFor("IPKE", "/a/1/0/9", 150)).toBeNull();
  });

  it("uses the formats formatOf returns as role keys", () => {
    const java = readFileSync(facadeSource(), "utf8");
    const start = java.indexOf("private static String formatOf");
    const end = java.indexOf("private static String describe", start);
    const found = [...java.slice(start, end).matchAll(/return "([A-Z0-9]+)";/g)].map((match) => match[1]);
    expect([...new Set(found)].sort()).toEqual([...KNOWN_FORMATS].sort());
  });

  it("lists every unit that contains a member, in declaration order", () => {
    expect(explicitUnitsContaining(shared, 63)).toEqual([shared[0], shared[1]]);
    expect(explicitUnitsContaining(shared, 4)).toEqual([shared[2]]);
    expect(explicitUnitsContaining(shared, 65)).toEqual([shared[0]]);
    expect(explicitUnitsContaining(shared, 99)).toEqual([]);
    const models: ExplicitMember[] = [
      { nsbmd: 0, nsbtx: 1, nsbca: [2, 5], nsbta: 4 },
      { nsbmd: 5, nsbtx: [8, 9] },
    ];
    expect(explicitUnitsContaining(models, 5)).toEqual(models);
    expect(explicitUnitsContaining(models, 9)).toEqual([models[1]]);
    expect(explicitUnitsContaining(models, 4)).toEqual([models[0]]);
    expect(explicitUnitsContaining(models, 3)).toEqual([]);
  });

  it("uses the first unit when a member is shared, and omits roles that unit lacks", () => {
    expect(groupUnit({ strategy: "explicit", units: shared }, [], 63, 7)).toEqual({
      nclr: { container: 7, id: 63 },
      ncgr: { container: 7, id: 64 },
      ncer: { container: 7, id: 65 },
      nanr: { container: 7, id: 66 },
    });
    expect(groupUnit({ strategy: "explicit", units: shared }, [], 70, 7)).toEqual({
      ncgr: { container: 7, id: 70 },
      nclr: { container: 7, id: 63 },
    });
    expect(groupUnit({ strategy: "explicit", units: shared }, [], 4, 7)).toEqual({
      ncgr: { container: 7, id: 4 },
      nclr: { container: 7, id: 4 },
    });
    expect(groupUnit({ strategy: "explicit", units: [{ ncgr: 0, nclr: 2 }] }, [], 0, 7)).toEqual({
      ncgr: { container: 7, id: 0 },
      nclr: { container: 7, id: 2 },
    });
    expect(groupUnit({ strategy: "explicit", units: shared }, [], 3, 7)).toBeNull();
    expect(groupUnit({ strategy: "explicit", units: [{ ncgr: [10, 11], nclr: 12 }] }, [], 11, 3)).toEqual({
      ncgr: { container: 3, id: 10 },
      nclr: { container: 3, id: 12 },
    });
    expect(groupUnit({ strategy: "explicit", units: [{ nsbmd: 0, nsbca: [2, 3] }] }, [], 2, 3)).toEqual({});
  });

  it("prefers an explicit unit over a stride, and leaves other indexes on the stride", () => {
    const entries: EntryLike[] = [
      { index: 0, format: "NCGR" },
      { index: 1, format: "NCLR" },
      { index: 2, format: "NCER" },
      { index: 3, format: "NANR" },
    ];
    const grouping: GroupingSpec = {
      strategy: "interleaved",
      order: ["NCGR", "NCLR", "NCER", "NANR"],
      units: [{ nclr: 63, ncgr: 0, ncer: 1 }],
    };
    expect(groupUnit(grouping, entries, 0, 2)).toEqual({
      nclr: { container: 2, id: 63 },
      ncgr: { container: 2, id: 0 },
      ncer: { container: 2, id: 1 },
    });
    expect(groupUnit(grouping, entries, 2, 2)).toEqual({
      ncgr: { container: 2, id: 0 },
      nclr: { container: 2, id: 1 },
      ncer: { container: 2, id: 2 },
      nanr: { container: 2, id: 3 },
    });
  });

  it("ignores order when the strategy is explicit", () => {
    const entries: EntryLike[] = [
      { index: 0, format: "NCGR" },
      { index: 1, format: "NCLR" },
    ];
    const grouping: GroupingSpec = {
      strategy: "explicit",
      order: ["NCGR", "NCLR"],
      units: [{ ncgr: 64, nclr: 63 }],
    };
    expect(groupUnit(grouping, entries, 0, 1)).toBeNull();
    expect(groupUnit(grouping, entries, 64, 1)).toEqual({
      ncgr: { container: 1, id: 64 },
      nclr: { container: 1, id: 63 },
    });
  });
});

function facadeSource(): string {
  // Walk up from this file. Stryker copies the test into a sandbox.
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let step = 0; step < 8; step++) {
    const candidate = path.join(dir, "nitroviewer-core/src/main/java/com/nitroviewer/core/CheerpjFacade.java");

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  throw new Error("CheerpjFacade.java not found");
}

function narcDb(grouping: GroupingSpec) {
  return {
    version: 1,
    games: {
      ZZZE: {
        title: "Synthetic",
        narcs: { "/intro": { grouping } },
      },
    },
  };
}

describe("resolveSpriteUnitIn", () => {
  const entries: EntryLike[] = [
    { index: 0, format: "NCGR" },
    { index: 1, format: "NCLR" },
    { index: 2, format: "NCER" },
    { index: 3, format: "NANR" },
  ];
  const grouping: GroupingSpec = {
    strategy: "interleaved",
    order: ["NCGR", "NCLR", "NCER", "NANR"],
    units: [
      { nclr: 63, ncgr: 64, ncer: 65, nanr: 66 },
      { ncgr: 70, nclr: 63 },
    ],
  };

  it("resolves a synthetic explicit unit and lists every unit containing the member", () => {
    const source = narcDb(grouping);
    expect(resolveSpriteUnitIn(source, "ZZZE", "/intro", 8, entries, 63)).toEqual({
      nclr: { container: 8, id: 63 },
      ncgr: { container: 8, id: 64 },
      ncer: { container: 8, id: 65 },
      nanr: { container: 8, id: 66 },
    });
    expect(explicitUnitsIn(source, "zzze", "/intro")).toEqual(grouping.units);
    const listed = explicitUnitsIn(source, "ZZZE", "/intro");
    let members: ExplicitMember[] = [];
    if (listed !== null) {
      members = listed;
    }
    const declared = grouping.units;
    if (declared === undefined) {
      throw new Error("fixture has no units");
    }
    expect(explicitUnitsContaining(members, 63)).toEqual([declared[0], declared[1]]);
    const stride = resolveSpriteUnitIn(source, "ZZZE", "/intro", 8, entries, 2);
    if (stride === null) {
      throw new Error("stride unit missing");
    }
    expect(stride.nclr).toEqual({ container: 8, id: 1 });
    const models = narcDb({
      strategy: "explicit",
      units: [{ nsbmd: 0, nsbtx: [1, 7], nsbca: [2, 3], nscr: 6 }],
    });
    expect(resolveExplicitUnitIn(models, "ZZZE", "/intro", 8, 3)).toEqual({
      nsbmd: [{ container: 8, id: 0 }],
      nsbtx: [{ container: 8, id: 1 }, { container: 8, id: 7 }],
      nsbca: [{ container: 8, id: 2 }, { container: 8, id: 3 }],
      nscr: [{ container: 8, id: 6 }],
    });
    expect(resolveExplicitUnitIn(models, "ZZZE", "/intro", 8, 7)?.nsbtx?.[1]).toEqual({ container: 8, id: 7 });
    expect(resolveExplicitUnitIn(models, "ZZZE", "/intro", 8, 4)).toBeNull();
    expect(resolveExplicitUnit("ZZZE", "/intro", 8, 0)).toBeNull();
    expect(resolveSpriteUnitIn(models, "ZZZE", "/intro", 8, entries, 0)).toEqual({});
  });

  it("rejects a malformed explicit list", () => {
    const source = narcDb({
      strategy: "interleaved",
      order: ["NCGR", "NCLR", "NCER", "NANR"],
      units: [{ ncgr: -1, nclr: 1 }],
    });
    expect(resolveSpriteUnitIn(source, "ZZZE", "/intro", 8, entries, 0)).toBeNull();
    expect(explicitUnitsIn(source, "ZZZE", "/intro")).toBeNull();
  });

  it("returns null when the game or NARC has no explicit list", () => {
    const source = narcDb({ strategy: "interleaved", order: ["NCGR", "NCLR", "NCER", "NANR"] });
    expect(explicitUnitsIn(source, "ZZZE", "/intro")).toBeNull();
    expect(explicitUnitsIn(source, "ZZZE", "/missing")).toBeNull();
    expect(resolveSpriteUnitIn(source, "NOPE", "/intro", 8, entries, 0)).toBeNull();
    expect(resolveSpriteUnitIn(source, "ZZZE", null, 8, entries, 0)).toBeNull();
    const ungrouped = {
      version: 1,
      games: {
        ZZZE: {
          title: "Synthetic",
          narcs: { "/intro": { role: "plain" } },
        },
      },
    };
    expect(explicitUnitsIn(ungrouped, "ZZZE", "/intro")).toBeNull();
    expect(resolveSpriteUnitIn(ungrouped, "ZZZE", "/intro", 8, entries, 0)).toBeNull();
    const noNarcs = { version: 1, games: { ZZZE: { title: "Synthetic" } } };
    expect(resolveSpriteUnitIn(noNarcs, "ZZZE", "/intro", 8, entries, 0)).toBeNull();
    expect(explicitUnitsIn(noNarcs, "ZZZE", "/intro")).toBeNull();
  });

  it("returns null when an explicit strategy has no unit list", () => {
    const source = narcDb({ strategy: "explicit", order: ["NCGR", "NCLR"] });
    expect(resolveSpriteUnitIn(source, "ZZZE", "/intro", 8, entries, 0)).toBeNull();
    expect(explicitUnitsIn(source, "ZZZE", "/intro")).toBeNull();
  });

  it("treats an empty explicit list as declared and empty", () => {
    const empty = narcDb({ strategy: "explicit", units: [] });
    expect(explicitUnitsIn(empty, "ZZZE", "/intro")).toEqual([]);
    expect(resolveSpriteUnitIn(empty, "ZZZE", "/intro", 8, entries, 0)).toBeNull();
  });
});
