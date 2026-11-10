import { useState } from "react";

const UNSEEN = Symbol("useChangedKey");

/**
 * True on the render where `key` is first seen and whenever it changes after that.
 * Resetting state here, instead of calling setState synchronously in an effect, is the
 * pattern React documents for storing information from previous renders:
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders
 *
 * `key` must be a primitive or a stable reference. A fresh object every render loops.
 */
export function useChangedKey(key: unknown): boolean {
  const [previous, setPrevious] = useState<unknown>(UNSEEN);
  if (!Object.is(previous, key)) {
    setPrevious(key);
    return true;
  }
  return false;
}
