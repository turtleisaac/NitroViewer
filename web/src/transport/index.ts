import type { NitroViewerClient } from "./types";
import { CheerpjTransport } from "./cheerpj";

// Single place that picks the transport. Swap to an HttpTransport here (or by env flag) if the
// CheerpJ path is ever replaced with a backend — nothing else in the app changes.
export function createClient(): NitroViewerClient {
  return new CheerpjTransport();
}

export * from "./types";
