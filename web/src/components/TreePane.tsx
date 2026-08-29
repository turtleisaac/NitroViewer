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
      <div className="tree-row folder" onClick={() => toggle(path)}>
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
                onClick={() => void select({ container: ROM_CONTAINER, id: file.id }, file.name)}
              >
                <span className="twisty" />
                <span className="file-name">{file.name}</span>
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
  return (
    <aside className="pane tree-pane">
      <div className="pane-head">Filesystem</div>
      <div className="tree-scroll">{tree && <FolderNode folder={tree} path="/" />}</div>
    </aside>
  );
}
