import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { ROM_CONTAINER, type TreeFolder } from "../transport";

function FolderNode({ folder, path }: { folder: TreeFolder; path: string }) {
  const expanded = useStore((s) => s.expanded);
  const toggle = useStore((s) => s.toggleFolder);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const isOpen = expanded.has(path);

  return (
    <div className="tree-folder">
      <div className="tree-row folder" data-path={path} onClick={() => toggle(path)}>
        <span className="twisty">{isOpen ? "▾" : "▸"}</span>
        <span className="folder-name">{folder.name}</span>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // When a breadcrumb folder is clicked, revealFolder expands its ancestors and bumps revealTick;
  // scroll that folder's row into view (it now exists in the DOM because its ancestors are open).
  useEffect(() => {
    if (!revealPath) return;
    const el = scrollRef.current?.querySelector(`[data-path="${revealPath}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [revealPath, revealTick]);

  return (
    <aside className={"pane tree-pane" + (navOpen ? " open" : "")}>
      <div className="pane-head">Filesystem</div>
      <div className="tree-scroll" ref={scrollRef}>
        {tree && <FolderNode folder={tree} path="/" />}
      </div>
    </aside>
  );
}
