import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { BANNER_CONTAINER, BANNER_REF, ROM_CONTAINER, refKey, type TreeFolder } from "../transport";
import { base64ToBytes, download } from "../util";
import {
  acceptsDrop,
  clearDragOutCache,
  DRAG_MIME,
  getCachedDragOut,
  overwriteWithDraggedFile,
  overwriteWithOsFile,
  prepareDragOutBlob,
  type DragPayload,
} from "./dnd";

function FolderNode({ folder, path }: { folder: TreeFolder; path: string }) {
  const expanded = useStore((s) => s.expanded);
  const toggle = useStore((s) => s.toggleFolder);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const windowId = useStore((s) => s.windowId);
  const dragHoverKey = useStore((s) => s.dragHoverKey);
  const setDragHoverKey = useStore((s) => s.setDragHoverKey);
  const isOpen = expanded.has(path);
  const [extracting, setExtracting] = useState(false);

  // Extract this folder subtree (decompressed) to a ZIP mirroring the layout — Tinke's "extract folder".
  const extractFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = useStore.getState();
    if (st.romHandle == null) return;
    setExtracting(true);
    try {
      const r = await st.client.exportFolderZip(st.romHandle, path);
      const base = (path.replace(/\/$/, "").split("/").pop() || "filesystem").replace(/[^\w.\-]+/g, "_");
      download(`${base}.zip`, base64ToBytes(r.base64), "application/zip");
    } catch (err) {
      alert("Extract folder failed: " + (err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="tree-folder">
      <div className="tree-row folder" data-path={path} onClick={() => toggle(path)}>
        <span className="twisty">{isOpen ? "▾" : "▸"}</span>
        <span className="folder-name">{folder.name}</span>
        <button
          className="icon-btn tree-extract"
          title="Extract this folder to a zip"
          disabled={extracting}
          onClick={extractFolder}
        >
          {extracting ? "…" : "↓"}
        </button>
      </div>
      {isOpen && (
        <div className="tree-children">
          {folder.folders.map((sub) => (
            <FolderNode key={path + sub.name + "/"} folder={sub} path={path + sub.name + "/"} />
          ))}
          {folder.files.map((file) => {
            const fileRef = { container: ROM_CONTAINER, id: file.id };
            const selected = selection?.ref.container === ROM_CONTAINER && selection.ref.id === file.id;
            const filePath = path + (file.name || file.id);
            const dragHover = dragHoverKey === refKey(fileRef);
            return (
              <div
                key={file.id}
                className={"tree-row file" + (selected ? " selected" : "") + (dragHover ? " drag-hover" : "")}
                title={filePath}
                draggable={windowId != null}
                onClick={() => void select(fileRef, file.name)}
                onDragStart={(e) => {
                  if (windowId == null) return;
                  e.dataTransfer.effectAllowed = "copy";
                  const payload: DragPayload = { sourceWindowId: windowId, ref: fileRef, path: filePath };
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
                  const cached = getCachedDragOut(fileRef);
                  if (cached) {
                    e.dataTransfer.setData("DownloadURL", `application/octet-stream:${cached.filename}:${cached.url}`);
                  }
                  prepareDragOutBlob(fileRef, file.name || `#${file.id}`); // primes the cache for next time either way
                }}
                onDragOver={(e) => {
                  if (!acceptsDrop(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDragEnter={(e) => {
                  if (!acceptsDrop(e)) return;
                  e.preventDefault();
                  setDragHoverKey(refKey(fileRef));
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  if (useStore.getState().dragHoverKey === refKey(fileRef)) setDragHoverKey(null);
                }}
                onDrop={(e) => {
                  if (!acceptsDrop(e)) return;
                  e.preventDefault();
                  setDragHoverKey(null);
                  if (e.dataTransfer.types.includes(DRAG_MIME)) {
                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    if (raw) void overwriteWithDraggedFile(JSON.parse(raw) as DragPayload, fileRef, filePath);
                    return;
                  }
                  const osFile = e.dataTransfer.files[0];
                  if (osFile) void overwriteWithOsFile(osFile, fileRef, filePath);
                }}
              >
                <span className="twisty" />
                <span className="file-name">{file.name || `#${file.id}`}</span>
                <span className="file-id">#{file.id}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TreePane() {
  const tree = useStore((s) => s.tree);
  const navOpen = useStore((s) => s.navOpen);
  const revealPath = useStore((s) => s.revealPath);
  const revealTick = useStore((s) => s.revealTick);
  const idToPath = useStore((s) => s.idToPath);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const romHandle = useStore((s) => s.romHandle);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const bannerSelected = selection?.ref.container === BANNER_CONTAINER;

  // When a breadcrumb folder is clicked, revealFolder expands its ancestors and bumps revealTick;
  // scroll that folder's row into view (it now exists in the DOM because its ancestors are open).
  useEffect(() => {
    if (!revealPath) return;
    const el = scrollRef.current?.querySelector(`[data-path="${revealPath}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [revealPath, revealTick]);

  // The drag-out cache (shared with NarcBrowser) is keyed by refKey+editVersion, not romHandle —
  // closing this ROM and opening another resets editVersion to 0 and can even reuse container/id
  // numbers (ROM_CONTAINER is a fixed constant, and a re-opened NARC can land on the same handle), so
  // a stale cache could otherwise serve the previous ROM's bytes. Drop it whenever the open ROM changes.
  useEffect(() => {
    clearDragOutCache();
  }, [romHandle]);

  // Search filters the whole filesystem by path (a flat, clickable result list) — Tinke-style file search.
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    const hits: { id: number; path: string }[] = [];
    for (const [id, path] of Object.entries(idToPath)) {
      if (path.toLowerCase().includes(q)) hits.push({ id: Number(id), path });
      if (hits.length >= 300) break;
    }
    return hits.sort((a, b) => a.path.localeCompare(b.path));
  }, [q, idToPath]);

  return (
    <aside className={"pane tree-pane" + (navOpen ? " open" : "")}>
      <div className="pane-head tree-head">
        <span>Filesystem</span>
        <input
          className="tree-search"
          type="search"
          placeholder="Search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tree-scroll" ref={scrollRef}>
        {/* The icon/title banner isn't a file, but it lives in the ROM — pin it above the filesystem. */}
        <div
          className={"tree-row file tree-pinned" + (bannerSelected ? " selected" : "")}
          title="The DS home-menu icon and per-language game titles"
          onClick={() => void select(BANNER_REF, "Game icon")}
        >
          <span className="twisty">◆</span>
          <span className="file-name">Game icon &amp; titles</span>
        </div>
        {q ? (
          <div className="search-results">
            <div className="search-count">{results.length}{results.length >= 300 ? "+" : ""} matches</div>
            {results.map((r) => {
              const name = r.path.split("/").pop() || String(r.id);
              const dir = r.path.slice(0, r.path.length - name.length);
              return (
                <button
                  key={r.id}
                  className="search-hit"
                  title={r.path}
                  onClick={() => void select({ container: ROM_CONTAINER, id: r.id }, name)}
                >
                  <span className="search-hit-name">{name}</span>
                  <span className="search-hit-dir">{dir}</span>
                </button>
              );
            })}
          </div>
        ) : (
          tree && <FolderNode folder={tree} path="/" />
        )}
      </div>
    </aside>
  );
}
