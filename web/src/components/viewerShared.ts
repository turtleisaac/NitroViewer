import { useChangedKey } from "../useChangedKey";
import type { ResourceItem } from "../state/store";
import { refKey, type ResourceRef } from "../transport";

export interface NarcListing {
  entries: { index: number; format: string }[];
}

/** Entries of the open NARC, or loose ROM siblings when the file is not in a NARC. */
export function resourcesInContainer(
  container: number,
  narcs: Record<number, NarcListing | undefined>,
  romSiblings: ResourceItem[],
): ResourceItem[] {
  if (container < 0) return romSiblings;
  const narc = narcs[container];
  if (!narc) return [];
  return narc.entries.map((entry) => ({
    ref: { container, id: entry.index },
    label: `#${entry.index}`,
    format: entry.format,
  }));
}

/** Resources whose format tag matches `fmt`. */
export function formatsOf(items: ResourceItem[], fmt: string): ResourceItem[] {
  return items.filter((item) => item.format === fmt);
}

/** File name used for downloads, with path separators and odd characters stripped. */
export function fileStem(name: string, fallback: string): string {
  return (name.split(/[/:]/).pop() || fallback).replace(/[^\w.-]+/g, "_");
}

/** Effect dependency string for an optional resource ref. */
export function refDep(ref: ResourceRef | null): string {
  if (!ref) return "";
  return refKey(ref);
}

/** Run `apply` on the render where `key` first appears or changes. */
export function useApplyOnChange(key: unknown, apply: () => void): void {
  if (useChangedKey(key)) apply();
}
