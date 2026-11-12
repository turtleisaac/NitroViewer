import { describe, expect, it } from "vitest";
import {
  assemble,
  deepMerge,
  familyPrefix,
  gameBody,
  languageKey,
  loadGameDb,
  modulesBy,
  winningKey,
} from "./load";

describe("deepMerge", () => {
  it("replaces scalars and arrays", () => {
    expect(deepMerge({ a: 1 }, 2)).toBe(2);
    expect(deepMerge(1, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ order: ["NCGR", "NCLR"] }, { order: ["NCGR"] })).toEqual({ order: ["NCGR"] });
    expect(deepMerge({ sets: [{ role: "a" }] }, { sets: [{ role: "b" }] })).toEqual({
      sets: [{ role: "b" }],
    });
  });

  it("merges a NARC by path and keeps sibling fields", () => {
    const merged = deepMerge(
      {
        title: "Wildcard",
        narcs: {
          "/a": {
            role: "sprites",
            render: { scanDirection: "front-to-back", tileWidth: 32 },
            entries: { "1": { bitDepth: 4 } },
            grouping: { strategy: "interleaved", order: ["NCGR", "NCLR"] },
          },
          "/b": { role: "icons", render: { tileWidth: 16 } },
        },
      },
      {
        narcs: {
          "/a": {
            render: { scanDirection: "back-to-front" },
            entries: { "4": { scanDirection: "front-to-back" } },
          },
        },
      },
    );

    expect(merged).toEqual({
      title: "Wildcard",
      narcs: {
        "/a": {
          role: "sprites",
          render: { scanDirection: "back-to-front", tileWidth: 32 },
          entries: { "1": { bitDepth: 4 }, "4": { scanDirection: "front-to-back" } },
          grouping: { strategy: "interleaved", order: ["NCGR", "NCLR"] },
        },
        "/b": { role: "icons", render: { tileWidth: 16 } },
      },
    });
  });
});

describe("gameBody", () => {
  it("drops the file header and leaves the game fields", () => {
    expect(gameBody(null)).toBeNull();
    expect(gameBody([])).toBeNull();
    expect(gameBody("CPU")).toBeNull();
    expect(gameBody({ version: 1, _source: "note", title: "Platinum", narcs: {} })).toEqual({
      title: "Platinum",
      narcs: {},
    });
  });
});

describe("assemble", () => {
  const family = {
    version: 1,
    _source: "note",
    title: "Wildcard",
    narcs: {
      "/a": {
        role: "sprites",
        render: { scanDirection: "front-to-back", tileWidth: 32 },
        entries: { "1": { bitDepth: 4 } },
      },
      "/b": { role: "icons" },
    },
  };
  const language = {
    narcs: {
      "/a": {
        render: { scanDirection: "back-to-front" },
        entries: { "4": { scanDirection: "front-to-back" } },
      },
    },
  };

  it("stores a family as the wildcard and a language file as the exact code", () => {
    const db = assemble({ CPU: family }, { "CPU/E": language });

    expect(db.version).toBe(1);
    expect(Object.keys(db.games).sort()).toEqual(["CPU*", "CPUE"]);
    expect(db.games["CPU*"]).toEqual({
      title: "Wildcard",
      narcs: family.narcs,
    });
    expect(db.games["CPUE"]).toEqual({
      title: "Wildcard",
      narcs: {
        "/a": {
          role: "sprites",
          render: { scanDirection: "back-to-front", tileWidth: 32 },
          entries: { "1": { bitDepth: 4 }, "4": { scanDirection: "front-to-back" } },
        },
        "/b": { role: "icons" },
      },
    });
  });

  it("keeps a language-only entry off the other letters", () => {
    const db = assemble({}, { "ADA/J": { title: "Diamond", narcs: { "/p": { role: "x" } } } });

    expect(db.version).toBe(1);
    expect(Object.keys(db.games)).toEqual(["ADAJ"]);
    expect(winningKey(db.games, "ADAJ")).toBe("ADAJ");
    expect(winningKey(db.games, "ADAE")).toBeNull();
    expect(winningKey(db.games, "ADA")).toBeNull();
  });

  it("ignores a file that is not a game object", () => {
    const db = assemble(
      { CPU: "nope", IPK: { title: "HeartGold" } },
      {
        CPU: { title: "bad id" },
        "NOPE/E": { title: "long prefix" },
        "CPU/EE": { title: "long letter" },
        "IPK/E": "nope",
      },
    );

    expect(db.version).toBe(1);
    expect(Object.keys(db.games)).toEqual(["IPK*"]);
    expect(assemble({ ADA: { version: 4, title: "Diamond" } }, {}).version).toBe(4);
  });
});

describe("winningKey", () => {
  const games = {
    "cpu*": { title: "Wild" },
    CPUE: { title: "Exact" },
  };

  it("prefers an exact code over the wildcard", () => {
    expect(winningKey(games, "CPUE")).toBe("CPUE");
    expect(winningKey(games, "cpue")).toBe("CPUE");
    expect(winningKey(games, "CPUJ")).toBe("cpu*");
    expect(winningKey(games, "CPU")).toBe("cpu*");
    expect(winningKey(games, "CPUEE")).toBe("cpu*");
  });

  it("returns null when nothing matches", () => {
    expect(winningKey(games, undefined)).toBeNull();
    expect(winningKey({}, "CPUE")).toBeNull();
    expect(winningKey({ zzze: { title: "lower" } }, "ZZZE")).toBeNull();
  });
});

function shipped(code: string): unknown {
  const db = loadGameDb();
  const key = winningKey(db.games, code);
  if (!key) return null;

  return db.games[key];
}

describe("shipped families", () => {
  it("loads one wildcard per family and no empty language override", () => {
    expect(loadGameDb().version).toBe(1);
    expect(Object.keys(loadGameDb().games).sort()).toEqual(["ADA*", "APA*", "CPU*", "IPG*", "IPK*"]);
  });

  it("returns the same merged Platinum entry for every region letter", () => {
    const platinum = shipped("CPUE");

    expect(platinum).toMatchObject({
      title: "Pokémon Platinum",
      narcs: {
        "/poketool/pokegra/pl_pokegra.narc": {
          role: "pokemon-battle-sprites",
          render: { scanDirection: "front-to-back" },
          grouping: { strategy: "interleaved", order: ["NCGR", "NCGR", "NCGR", "NCGR", "NCLR", "NCLR"] },
        },
        "/poketool/trgra/trbgra.narc": {
          role: "trainer-back-sprites",
          cipher: { indexMod: 5, indexRem: 4, scanDirection: "front-to-back" },
        },
        "/arc/manene.narc": { role: "field-model-set" },
      },
    });
    expect(shipped("CPUJ")).toEqual(platinum);
    expect(shipped("cpud")).toEqual(platinum);
    expect(shipped("CPUK")).toEqual(platinum);
    expect(shipped("CPU")).toEqual(platinum);
    expect(shipped("CPUEE")).toEqual(platinum);
  });

  it("returns the HeartGold, SoulSilver, Diamond, and Pearl entries", () => {
    expect(shipped("IPKS")).toMatchObject({
      title: "Pokémon HeartGold",
      narcs: {
        "/a/0/0/4": { render: { scanned: true, scanDirection: "front-to-back" } },
        "/a/0/5/8": { cipher: { scanDirection: "back-to-front" } },
      },
    });
    expect(shipped("IPKE")).toEqual(shipped("IPKS"));
    expect(shipped("IPGP")).toMatchObject({
      title: "Pokémon SoulSilver",
      narcs: { "/a/1/1/4": { render: { scanDirection: "front-to-back" } } },
    });
    expect(shipped("ipge")).toEqual(shipped("IPGP"));
    expect(shipped("ADAE")).toMatchObject({
      title: "Pokémon Diamond",
      narcs: {
        "/poketool/pokegra/pokegra.narc": { render: { scanDirection: "back-to-front" } },
        "/poketool/trgra/trfgra.narc": { cipher: { indexMod: 2, indexRem: 0, scanDirection: "back-to-front" } },
      },
    });
    expect(shipped("ADAJ")).toEqual(shipped("ADAE"));
    expect(shipped("APAJ")).toMatchObject({ title: "Pokémon Pearl" });
    expect(shipped("apae")).toEqual(shipped("APAJ"));
    expect(shipped("ABCD")).toBeNull();
    expect(shipped("IRDE")).toBeNull();
  });
});

describe("folder paths", () => {
  it("reads a family prefix and a language letter", () => {
    expect(familyPrefix("./CPU/gamedb.json")).toBe("CPU");
    expect(familyPrefix("CPU/gamedb.json")).toBe("CPU");
    expect(familyPrefix("./cpu/gamedb.json")).toBe("CPU");
    expect(familyPrefix("./CPU/E/gamedb.json")).toBeNull();
    expect(familyPrefix("CPU/gamedb.json.bak")).toBeNull();
    expect(languageKey("./CPU/E/gamedb.json")).toBe("CPU/E");
    expect(languageKey("CPU/E/gamedb.json")).toBe("CPU/E");
    expect(languageKey("./cpu/e/gamedb.json")).toBe("CPU/E");
    expect(languageKey("./CPU/gamedb.json")).toBeNull();
    expect(languageKey("./CPU/EE/gamedb.json")).toBeNull();
    expect(languageKey("CPU/E/gamedb.json.bak")).toBeNull();
    expect(modulesBy({ "CPU/gamedb.json": { title: "P" }, "nope.json": { title: "x" } }, familyPrefix)).toEqual({
      CPU: { title: "P" },
    });
  });
});
