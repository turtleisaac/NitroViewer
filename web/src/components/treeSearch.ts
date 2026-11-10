import { ROM_CONTAINER } from "../transport";

export interface SearchHit {
  id: number;
  path: string;
}

/** Files whose path contains the query, capped at 300, sorted by path. */
export function searchFiles(idToPath: Record<number, string>, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const [id, path] of Object.entries(idToPath)) {
    if (path.toLowerCase().includes(q)) hits.push({ id: Number(id), path });
    if (hits.length >= 300) break;
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

/** Filename and the directory prefix shown on a search hit. */
export function searchHitLabel(path: string, id: number): { name: string; dir: string } {
  const name = path.split("/").pop() || String(id);
  return { name, dir: path.slice(0, path.length - name.length) };
}

/** Whether a filesystem row is the current selection. */
export function rowSelected(
  selection: { ref: { container: number; id: number } } | null,
  fileId: number,
): boolean {
  return selection?.ref.container === ROM_CONTAINER && selection.ref.id === fileId;
}

/** Match count, with a plus once the list is capped. */
export function matchCount(count: number): string {
  return count >= 300 ? `${count}+` : String(count);
}

/** Tree pane class, including the open drawer state. */
export function treePaneClass(navOpen: boolean): string {
  return navOpen ? "pane tree-pane open" : "pane tree-pane";
}

/** Pinned banner row class. */
export function bannerRowClass(selected: boolean): string {
  return selected ? "tree-row file tree-pinned selected" : "tree-row file tree-pinned";
}

/** Zip download name for a folder path. */
export function folderDownloadName(path: string): string {
  return (path.replace(/\/$/, "").split("/").pop() || "filesystem").replace(/[^\w.-]+/g, "_");
}
