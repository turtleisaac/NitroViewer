import type { DragEvent } from "react";
import { useStore } from "../state/store";
import { refKey, type ResourceRef } from "../transport";
import { base64ToBytes, exportFileName } from "../util";

// Shared drag-and-drop for anything that behaves like a ROM file: top-level tree entries
// (container = ROM_CONTAINER) and NARC sub-files (container = a narc handle) alike — both are just
// a ResourceRef as far as import/export are concerned, so one implementation covers both TreePane's
// file rows and NarcBrowser's entries.

// Custom DataTransfer type for dragging a file out to another NitroViewer window. Carries a small
// descriptor: `ref` (the resource's own ref, valid in the SOURCE window's session — used directly to
// fetch bytes over IPC, no path lookup needed) and `path` (a human-readable location, display-only,
// for the overwrite confirmation and the cross-location warning).
export const DRAG_MIME = "application/x-nitroviewer-file";

export interface DragPayload {
  sourceWindowId: number;
  ref: ResourceRef;
  path: string;
}

// A row accepts either our own cross-window drag (DRAG_MIME) or a real OS file dropped in from
// Finder/Explorer/desktop ("Files", the standard DataTransfer type for that). Anything else (text, a
// link, an image dragged from a webpage, …) is ignored — no preventDefault, so the browser shows its
// normal "not allowed" cursor instead of the row pretending it's a valid drop target.
export function acceptsDrop(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("Files");
}

// Fetches the dropped file's bytes from its source window (see requestDraggedFile in
// electron/main.cjs) and overwrites the target ref with them, reusing the store's existing
// importFile action — so this gets undo, dirty-tracking, and viewer refresh for free, identical to
// the manual "Import…"/replace button.
export async function overwriteWithDraggedFile(payload: DragPayload, targetRef: ResourceRef, targetPath: string) {
  const st = useStore.getState();
  if (payload.sourceWindowId === st.windowId && refKey(payload.ref) === refKey(targetRef)) return; // dropped on itself
  if (st.romHandle == null) return;
  // Same display location in both ROMs is the expected "compare/patch across versions" case. A
  // mismatch means the dragged file and the drop target aren't the same logical file — still allowed
  // (that's useful too, e.g. testing one file's data in another's slot), but worth calling out
  // explicitly so a drop on the wrong row doesn't quietly overwrite an unrelated file.
  const message =
    payload.path === targetPath
      ? `Overwrite "${targetPath}" with the dragged version?`
      : `Warning: the dragged file is at "${payload.path}", which doesn't match this file's location "${targetPath}" — they're different files.\n\nOverwrite "${targetPath}" with "${payload.path}" anyway?`;
  if (!window.confirm(message)) return;
  try {
    const res = await window.nitroviewer?.requestDraggedFile(payload.sourceWindowId, payload.ref);
    if (!res || !res.ok) throw new Error(res?.error || "Could not read the dragged file.");
    await st.importFile(targetRef, base64ToBytes(res.base64));
  } catch (err) {
    alert("Overwrite failed: " + (err as Error).message);
  }
}

function isPngFile(file: File): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

// The target's format, for deciding whether a dropped PNG should route into the sprite importer
// instead of a raw overwrite. `knownFormat` lets a caller that already has it for free (NarcBrowser's
// NarcEntry.format) skip the lookup; otherwise this reads the same cache `select()` populates
// (store.formats) and falls back to one detectFormat call for a not-yet-visited ROM tree file.
async function resolveDropFormat(ref: ResourceRef, knownFormat?: string): Promise<string> {
  if (knownFormat) return knownFormat;
  const st = useStore.getState();
  const cached = st.formats[refKey(ref)];
  if (cached) return cached.format;
  if (st.romHandle == null) return "";
  try {
    return (await st.client.detectFormat(st.romHandle, ref)).format;
  } catch {
    return "";
  }
}

// SpriteViewer has a dedicated "Import PNG…" flow for each of these (onScreenPngChosen/onCellPngChosen/
// onNanrPngChosen), same shape as the NCGR one below, but none of them are wired up to a drop yet — a
// PNG dropped here would otherwise fall through to the raw-overwrite path, and a PNG is not valid
// NSCR/NCER/NANR data, so that would silently corrupt the resource rather than import anything.
const PNG_DROP_UNSUPPORTED_FORMATS = new Set(["NSCR", "NCER", "NANR"]);

// Overwrites the target ref with a file dragged in from the OS (Finder/Explorer/desktop) — same
// destination as overwriteWithDraggedFile (store.importFile), just sourced from a real File object
// instead of another window's CheerpJ session. Equivalent to the manual replace button, triggered by
// drop instead of a file picker.
//
// Exception: a .png dropped on an NCGR doesn't make sense as a raw byte overwrite (a PNG is not valid
// NCGR data) — it routes through the same "Import PNG…" flow SpriteViewer's onPngChosen uses instead
// (palette pairing, dry-run match-vs-rebuild prompt), via pendingPngImport. The format check happens
// BEFORE selecting anything, so dropping a PNG on a non-NCGR file doesn't yank the user's current view
// away just to discover it should've been a plain overwrite.
export async function overwriteWithOsFile(file: File, targetRef: ResourceRef, targetPath: string, knownFormat?: string) {
  const st = useStore.getState();
  if (st.romHandle == null) return;
  if (isPngFile(file)) {
    const format = await resolveDropFormat(targetRef, knownFormat);
    if (format === "NCGR") {
      const name = targetPath.split(/[/#]/).pop() || targetPath;
      await st.select(targetRef, name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      useStore.getState().setPendingPngImport({ ref: targetRef, bytes });
      return;
    }
    if (PNG_DROP_UNSUPPORTED_FORMATS.has(format)) {
      alert(
        `Dropping a PNG onto ${format} isn't supported yet — open "${targetPath}" and use its "Import PNG…" button instead.`
      );
      return;
    }
  }
  if (!window.confirm(`Overwrite "${targetPath}" with "${file.name}" from your computer?`)) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await st.importFile(targetRef, bytes);
  } catch (err) {
    alert("Overwrite failed: " + (err as Error).message);
  }
}

// Dragging a file OUT of the ROM onto the OS (Finder/Explorer/desktop) uses the "DownloadURL"
// DataTransfer convention Chromium recognizes for "materialize this blob as a real file at the drop
// location" — no Electron/main-process involvement needed. The catch: dataTransfer.setData() only
// takes effect when called synchronously inside the dragstart handler, but the file's bytes only
// exist behind an async CheerpJ round-trip (exportFile). So the blob is prepared on the FIRST
// dragstart of a given ref/edit-version and cached; that first attempt can still be dropped onto
// another NitroViewer window (DRAG_MIME doesn't depend on this), just not onto the OS yet — every
// attempt after the first has the cached blob ready and can drop onto Finder/Desktop too.
const dragOutCache = new Map<string, { url: string; filename: string }>();
const dragOutInFlight = new Set<string>();

// Keyed by editVersion (bumped on every ROM edit) so an edit is never served as a stale drag-out —
// it's just a cache miss, and the next drag attempt re-fetches current bytes.
function dragOutKey(ref: ResourceRef, editVersion: number) {
  return `${refKey(ref)}@${editVersion}`;
}

export function getCachedDragOut(ref: ResourceRef): { url: string; filename: string } | undefined {
  return dragOutCache.get(dragOutKey(ref, useStore.getState().editVersion));
}

// refKey alone doesn't disambiguate across ROMs (ROM_CONTAINER is the same constant for every ROM,
// and a re-opened NARC can even land on the same handle number) — callers must clear this whenever
// the open ROM changes (TreePane does, on romHandle).
export function clearDragOutCache() {
  for (const { url } of dragOutCache.values()) URL.revokeObjectURL(url);
  dragOutCache.clear();
}

export function prepareDragOutBlob(ref: ResourceRef, displayName: string) {
  const st = useStore.getState();
  if (st.romHandle == null) return;
  const key = dragOutKey(ref, st.editVersion);
  if (dragOutCache.has(key) || dragOutInFlight.has(key)) return;
  dragOutInFlight.add(key);
  st.client
    .exportFile(st.romHandle, ref)
    .then((r) => {
      const filename = exportFileName(displayName, r.format);
      const blob = new Blob([base64ToBytes(r.base64) as unknown as BlobPart]);
      dragOutCache.set(key, { url: URL.createObjectURL(blob), filename });
    })
    .catch(() => {
      // Dragging within the app still works without this — the OS drop just won't produce a file
      // for this attempt; dragging again retries the fetch.
    })
    .finally(() => dragOutInFlight.delete(key));
}
