// Shipped game DB files. The BAD and MAL fixtures live under src/test/resources and are not loaded.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { explicitIssues, type GroupingSpec } from "../state/grouping";
import { assemble, familyPrefix, gameBody, languageKey, type LoadedDb } from "./load";

/** Strategies `GroupingSpec` names. See grouping.ts. */
const KNOWN_STRATEGIES = {
  lockstep: true,
  interleaved: true,
  explicit: true,
} satisfies Record<GroupingSpec["strategy"], true>;

/** Shipped files parse, and merged groupings pass explicitIssues. See load.ts and grouping.ts. */
function expectShippedGameDb(): void {
  // Family files, language overrides, and any classpath copy GameDb reads.
  const files = shippedFiles();

  // assemble deep-merges a language file onto its family before the grouping check.
  const problems = problemsFor(files);

  expect(files.length).toBeGreaterThan(0);
  expect(problems).toEqual([]);
}

describe("shipped game db", () => {
  it("parses every shipped file and accepts its groupings", expectShippedGameDb);
});

/** Checkout root. This file sits at web/src/gamedb. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Folders `loadGameDb` and `GameDb.readResource` read. See folders.ts and GameDb.java. */
function loaderRoots(): string[] {
  const root = repoRoot();

  return [
    join(root, "web", "src", "gamedb"),
    join(root, "nitroviewer-core", "src", "main", "resources"),
  ];
}

/** Shipped `gamedb.json` paths. See the globs in folders.ts. */
function shippedFiles(): string[] {
  const found: string[] = [];

  // Both loader roots. A missing Java resources directory adds nothing.
  for (const root of loaderRoots()) {
    collectFiles(root, found);
  }

  return found;
}

/** `gamedb.json` files under one loader root. A missing directory adds nothing. */
function collectFiles(root: string, found: string[]): void {
  // Java's main resources directory is optional. Test resources are not this root.
  if (!existsSync(root)) {
    return;
  }

  walk(root, found);
}

/** One directory of a loader root. */
function walk(dir: string, found: string[]): void {
  for (const name of readdirSync(dir)) {
    take(join(dir, name), found);
  }
}

/** A directory is walked. A `gamedb.json` file is kept. */
function take(path: string, found: string[]): void {
  if (statSync(path).isDirectory()) {
    walk(path, found);
    return;
  }

  if (path.endsWith(`${sep}gamedb.json`)) {
    found.push(path);
  }
}

/** Problems for every shipped file, one loader root at a time. See load.ts and GameDb.java. */
function problemsFor(files: string[]): string[] {
  const problems: string[] = [];

  // A Java copy is assembled on its own, not mixed into the web folder.
  for (const root of loaderRoots()) {
    addRoot(root, filesIn(root, files), problems);
  }

  return problems;
}

/** Paths under one loader root. See GameDb.java. */
function filesIn(root: string, files: string[]): string[] {
  const prefix = `${root}${sep}`;
  const owned: string[] = [];

  for (const file of files) {
    if (file.startsWith(prefix)) {
      owned.push(file);
    }
  }

  return owned;
}

/** Parse one root and check the document `assemble` builds. See load.ts. */
function addRoot(root: string, files: string[], problems: string[]): void {
  if (files.length === 0) {
    return;
  }

  // The same two maps loadGameDb passes to assemble.
  const families: Record<string, unknown> = {};
  const languages: Record<string, unknown> = {};

  for (const file of files) {
    placeFile(root, file, families, languages, problems);
  }

  // Language overrides are already merged into each exact game code.
  addMerged(assemble(families, languages), problems);
}

/** Put one file in the family or language map `modulesBy` would build. See load.ts. */
function placeFile(
  root: string,
  file: string,
  families: Record<string, unknown>,
  languages: Record<string, unknown>,
  problems: string[],
): void {
  const parsed = readParsed(file, problems);

  if (parsed === undefined) {
    return;
  }

  // gameBody drops anything that is not a JSON object. Java throws on the same shape.
  if (gameBody(parsed) === null) {
    problems.push(`${file}: not an object`);
    return;
  }

  // familyPrefix and languageKey match the slash form the globs use.
  const rel = relative(root, file).split(sep).join("/");

  storeParsed(file, rel, parsed, families, languages, problems);
}

/** Parsed JSON, or undefined when the file does not parse. See GameDb.read. */
function readParsed(file: string, problems: string[]): unknown {
  const text = readFileSync(file, "utf8");

  // A bad file is reported. It does not abort the rest of the root.
  try {
    return parseJson(text);
  } catch (error) {
    problems.push(`${file}: ${errorText(error)}`);
    return undefined;
  }
}

/** JSON.parse is typed as any. This is the one cast off that any. See cheerpj.ts. */
function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Text of a JSON parse error. See GameDb.read. */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "could not parse gamedb.json";
}

/** Store a family or language file. Anything else is a path the globs skip. See folders.ts. */
function storeParsed(
  file: string,
  rel: string,
  parsed: unknown,
  families: Record<string, unknown>,
  languages: Record<string, unknown>,
  problems: string[],
): void {
  if (storeFamily(rel, parsed, families)) {
    return;
  }
  if (storeLanguage(rel, parsed, languages)) {
    return;
  }

  problems.push(`${file}: not a family or language path`);
}

/** True when `rel` is `PREFIX/gamedb.json` and was stored. See familyPrefix. */
function storeFamily(rel: string, parsed: unknown, families: Record<string, unknown>): boolean {
  if (rel.split("/").length !== 2) {
    return false;
  }

  const family = familyPrefix(rel);

  if (family === null) {
    return false;
  }

  families[family] = parsed;
  return true;
}

/** True when `rel` is `PREFIX/L/gamedb.json` and was stored. See languageKey. */
function storeLanguage(rel: string, parsed: unknown, languages: Record<string, unknown>): boolean {
  if (rel.split("/").length !== 3) {
    return false;
  }

  const language = languageKey(rel);

  if (language === null) {
    return false;
  }

  languages[language] = parsed;
  return true;
}

/** Groupings on the assembled games, including a merged language entry. See assemble. */
function addMerged(db: LoadedDb, problems: string[]): void {
  // LoadedDb is a numeric version plus a games object.
  const shape = shapeProblem(db);

  if (shape !== null) {
    problems.push(shape);
  }

  for (const [code, game] of Object.entries(db.games)) {
    addGame(code, game, problems);
  }
}

/** LoadedDb is a number version and a games object. See load.ts. */
function shapeProblem(db: LoadedDb): string | null {
  if (typeof db.version !== "number") {
    return "assembled version is not a number";
  }

  if (gameBody(db.games) === null) {
    return "assembled games is not an object";
  }

  return null;
}

/** Groupings under one assembled game. See GameDef in grouping.ts. */
function addGame(code: string, game: unknown, problems: string[]): void {
  const body = gameBody(game);

  if (body === null) {
    problems.push(`${code}: game is not an object`);
    return;
  }

  // No narcs object means this entry declares no groupings.
  const narcs = gameBody(body.narcs);

  if (narcs === null) {
    return;
  }

  for (const [narcPath, narc] of Object.entries(narcs)) {
    addNarc(code, narcPath, narc, problems);
  }
}

/** One NARC. A missing grouping is left to the heuristic. See narcDefIn. */
function addNarc(code: string, narcPath: string, narc: unknown, problems: string[]): void {
  const body = gameBody(narc);

  if (body === null) {
    return;
  }
  if (body.grouping === undefined) {
    return;
  }

  addGrouping(code, narcPath, body.grouping, problems);
}

/** Known strategy, then the unit-list check `resolveSpriteUnitIn` already runs. See grouping.ts. */
function addGrouping(code: string, narcPath: string, grouping: unknown, problems: string[]): void {
  const body = gameBody(grouping);

  if (body === null) {
    problems.push(`${code} ${narcPath}: grouping is not an object`);
    return;
  }

  // GroupingSpec names lockstep, interleaved, and explicit.
  const strategy = body.strategy;

  if (!knownStrategy(strategy)) {
    problems.push(`${code} ${narcPath}: unknown strategy`);
    return;
  }

  // explicitIssues rejects a bad list for an explicit grouping and for any other strategy that has one.
  const issues = explicitIssues(body.units, strategy);

  for (const issue of issues) {
    problems.push(`${code} ${narcPath}: ${issue}`);
  }
}

/** True when `value` is one of the `GroupingSpec` strategies. See grouping.ts. */
function knownStrategy(value: unknown): value is GroupingSpec["strategy"] {
  if (typeof value !== "string") {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(KNOWN_STRATEGIES, value);
}
