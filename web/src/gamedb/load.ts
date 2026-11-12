// Foldered game DB. A family file is the shared wildcard. A language file is the exact-code override.

import { familyModules, languageModules } from "./folders";

const FAMILY_PATH = /(?:^|\/)([A-Za-z0-9]{3})\/gamedb\.json$/;
const LANGUAGE_PATH = /(?:^|\/)([A-Za-z0-9]{3})\/([A-Za-z0-9])\/gamedb\.json$/;

export interface LoadedDb {
  version: number;
  games: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;

  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    merged[key] = deepMerge(base[key], override[key]);
  }

  return merged;
}

/** Game fields from one file. `version` and `_source` stay on the file, not the entry. */
export function gameBody(file: unknown): Record<string, unknown> | null {
  if (!isRecord(file)) return null;

  const body = { ...file };
  delete body.version;
  delete body._source;

  return body;
}

/** Wildcard entries from family files, then exact codes from language overrides. */
export function assemble(families: Record<string, unknown>, languages: Record<string, unknown>): LoadedDb {
  const games: Record<string, unknown> = {};
  const version = addFamilies(games, families);

  addLanguages(games, languages);

  return { version, games };
}

function addFamilies(games: Record<string, unknown>, families: Record<string, unknown>): number {
  let version = 1;

  for (const [prefix, file] of Object.entries(families)) {
    const body = gameBody(file);
    if (!body) continue;

    games[`${prefix.toUpperCase()}*`] = body;
    version = versionFrom(file, version);
  }

  return version;
}

function versionFrom(file: unknown, version: number): number {
  if (!isRecord(file) || typeof file.version !== "number") return version;

  return file.version;
}

function addLanguages(games: Record<string, unknown>, languages: Record<string, unknown>): void {
  for (const [id, file] of Object.entries(languages)) {
    putLanguage(games, id, file);
  }
}

function putLanguage(games: Record<string, unknown>, id: string, file: unknown): void {
  const parts = languageParts(id);
  if (!parts) return;

  const override = gameBody(file);
  if (!override) return;

  const family = games[`${parts.prefix}*`];
  games[`${parts.prefix}${parts.letter}`] = isRecord(family) ? deepMerge(family, override) : override;
}

function languageParts(id: string): { prefix: string; letter: string } | null {
  const parts = id.split("/");
  if (parts.length !== 2) return null;

  const prefix = parts[0].toUpperCase();
  const letter = parts[1].toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(prefix) || !/^[A-Z0-9]$/.test(letter)) return null;

  return { prefix, letter };
}

/** Exact key wins. Otherwise the first `PREFIX*` wildcard whose prefix the code starts with. */
export function winningKey(games: object, gameCode: string | undefined): string | null {
  if (!gameCode) return null;

  const code = gameCode.toUpperCase();
  const table = games as Record<string, unknown>;
  if (table[code]) return code;

  return wildcardKey(table, code);
}

function wildcardKey(table: Record<string, unknown>, code: string): string | null {
  for (const key of Object.keys(table)) {
    const upper = key.toUpperCase();
    if (upper.endsWith("*") && code.startsWith(upper.slice(0, -1))) return key;
  }

  return null;
}

export function familyPrefix(path: string): string | null {
  const match = FAMILY_PATH.exec(path);
  if (!match) return null;

  return match[1].toUpperCase();
}

export function languageKey(path: string): string | null {
  const match = LANGUAGE_PATH.exec(path);
  if (!match) return null;

  return `${match[1].toUpperCase()}/${match[2].toUpperCase()}`;
}

export function loadGameDb(): LoadedDb {
  return assemble(modulesBy(familyModules, familyPrefix), modulesBy(languageModules, languageKey));
}

export function modulesBy(
  modules: Record<string, unknown>,
  keyOf: (path: string) => string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [path, file] of Object.entries(modules)) {
    const key = keyOf(path);
    if (!key) continue;

    out[key] = file;
  }

  return out;
}
