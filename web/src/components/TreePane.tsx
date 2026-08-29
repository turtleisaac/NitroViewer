import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ROM_CONTAINER, type TreeFolder } from "../transport";
import { base64ToBytes, download } from "../util";

function FolderNode({ folder, path }: { folder: TreeFolder; path: string }) {
  const expanded = useStore((s) => s.expanded);
  const toggle = useStore((s) => s.toggleFolder);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
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
            const selected =
              selection?.ref.container === ROM_CONTAINER && selection.ref.id === file.id;
            return (
              <div
                key={file.id}
                className={"tree-row file" + (selected ? " selected" : "")}
                title={path + (file.name || file.id)}
                onClick={() => void select({ container: ROM_CONTAINER, id: file.id }, file.name)}
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  // When a breadcrumb folder is clicked, revealFolder expands its ancestors and bumps revealTick;
  // scroll that folder's row into view (it now exists in the DOM because its ancestors are open).
  useEffect(() => {
    if (!revealPath) return;
    const el = scrollRef.current?.querySelector(`[data-path="${revealPath}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [revealPath, revealTick]);

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
