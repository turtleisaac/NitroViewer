import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { BANNER_CONTAINER, BANNER_REF, ROM_CONTAINER, type NitroViewerClient, type TreeFolder } from "../transport";
import { base64ToBytes, download } from "../util";
import { Icon } from "./icons";
import { bannerRowClass, folderDownloadName, matchCount, rowSelected, searchFiles, searchHitLabel, treePaneClass } from "./treeSearch";

/** Download one folder zip, or null when no ROM is open. */
async function folderZip(client: NitroViewerClient, romHandle: number | null, path: string) {
  if (romHandle == null) return null;
  const r = await client.exportFolderZip(romHandle, path);
  return { name: `${folderDownloadName(path)}.zip`, bytes: base64ToBytes(r.base64) };
}

function FileRow({
  path,
  file,
  selected,
  onSelect,
}: {
  path: string;
  file: { id: number; name?: string };
  selected: boolean;
  onSelect: () => void;
}) {
  const name = file.name || `#${file.id}`;
  return (
    <div
      className={"tree-row file" + (selected ? " selected" : "")}
      title={path + name}
      onClick={onSelect}
    >
      <span className="twisty" />
      <span className="file-name">{name}</span>
      <span className="file-id">#{file.id}</span>
    </div>
  );
}

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
    setExtracting(true);
    try {
      const zip = await folderZip(st.client, st.romHandle, path);
      if (zip) download(zip.name, zip.bytes, "application/zip");
    } catch (err) {
      alert("Extract folder failed: " + (err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="tree-folder">
      <div className="tree-row folder" data-path={path} onClick={() => toggle(path)}>
        <span className="twisty">{isOpen ? <Icon name="chevron-down" /> : <Icon name="chevron-right" />}</span>
        <span className="folder-name">{folder.name}</span>
        <button
          className="icon-btn tree-extract"
          title="Extract this folder to a zip"
          disabled={extracting}
          onClick={(e) => { void extractFolder(e); }}
        >
          {extracting ? "…" : <Icon name="download" />}
        </button>
      </div>
      {isOpen && (
        <div className="tree-children">
          {folder.folders.map((sub) => (
            <FolderNode key={path + sub.name + "/"} folder={sub} path={path + sub.name + "/"} />
          ))}
          {folder.files.map((file) => (
            <FileRow
              key={file.id}
              path={path}
              file={file}
              selected={rowSelected(selection, file.id)}
              onSelect={() => void select({ container: ROM_CONTAINER, id: file.id }, file.name)}
            />
          ))}
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

  // Search filters the whole filesystem by path (a flat, clickable result list) — Tinke-style file search.
  const results = useMemo(() => searchFiles(idToPath, query), [query, idToPath]);
  const q = query.trim();

  return (
    <aside className={treePaneClass(navOpen)}>
      <div className="pane-head tree-head">
        <span>Filesystem</span>
        <input
          className="tree-search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tree-scroll" ref={scrollRef}>
        {/* The icon/title banner isn't a file, but it lives in the ROM — pin it above the filesystem. */}
        <div
          className={bannerRowClass(bannerSelected)}
          title="The DS home-menu icon and per-language game titles"
          onClick={() => void select(BANNER_REF, "Game icon")}
        >
          <span className="twisty">◆</span>
          <span className="file-name">Game icon &amp; titles</span>
        </div>
        {q ? (
          <div className="search-results">
            <div className="search-count">{matchCount(results.length)} matches</div>
            {results.map((r) => {
              const { name, dir } = searchHitLabel(r.path, r.id);
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
