import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "./state/store";
import { TreePane } from "./components/TreePane";
import { InspectorPane } from "./components/InspectorPane";

export function App() {
  const boot = useStore((s) => s.boot);
  const booted = useStore((s) => s.booted);
  const status = useStore((s) => s.status);
  const loading = useStore((s) => s.loading);
  const romHandle = useStore((s) => s.romHandle);
  const romName = useStore((s) => s.romName);
  const openRom = useStore((s) => s.openRom);
  const openRomBytes = useStore((s) => s.openRomBytes);
  const openUnpackedFolder = useStore((s) => s.openUnpackedFolder);
  const openUnpackedEntries = useStore((s) => s.openUnpackedEntries);
  const navOpen = useStore((s) => s.navOpen);
  const setNavOpen = useStore((s) => s.setNavOpen);
  const treeCollapsed = useStore((s) => s.treeCollapsed);
  const setTreeCollapsed = useStore((s) => s.setTreeCollapsed);
  const treeWidth = useStore((s) => s.treeWidth);
  const setTreeWidth = useStore((s) => s.setTreeWidth);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  const saveRom = useStore((s) => s.saveRom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const editorDirty = useStore((s) => s.editorDirty);
  const editorCapturesUndo = useStore((s) => s.editorCapturesUndo);
  const editorCanUndo = useStore((s) => s.editorCanUndo);
  const editorCanRedo = useStore((s) => s.editorCanRedo);
  const romCanUndo = useStore((s) => s.undoStack.length > 0);
  const romCanRedo = useStore((s) => s.redoStack.length > 0);
  const useEditorUndo = editorDirty || editorCapturesUndo;
  const canUndo = useEditorUndo ? editorCanUndo : romCanUndo;
  const canRedo = useEditorUndo ? editorCanRedo : romCanRedo;
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const topOpenRef = useRef<HTMLDivElement>(null);
  const emptyOpenRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<null | "top" | "empty">(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Drag the divider to resize the file browser column (desktop only). clientX is measured from the
  // viewport's left edge, which is where the column starts, so it maps directly to the column width.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => setTreeWidth(e.clientX);
    const stop = () => setResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing, setTreeWidth]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (topOpenRef.current?.contains(t) || emptyOpenRef.current?.contains(t)) return;
      setOpenMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [openMenu]);

  async function applyNativePick(): Promise<boolean> {
    const api = window.nitroviewer;
    if (!api?.pickOpen) return false;
    const result = await api.pickOpen();
    if (!result || !("kind" in result)) return true;
    if (result.kind === "file") {
      const raw = result.bytes;
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      await openRomBytes(result.name, bytes);
    } else {
      await openUnpackedEntries(
        result.name,
        result.files.map((f) => ({
          path: f.path,
          data: f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data),
        }))
      );
    }
    return true;
  }

  async function onOpenClick(at: "top" | "empty") {
    if (await applyNativePick()) return;
    setOpenMenu((cur) => (cur === at ? null : at));
  }

  function openMenuItems() {
    return (
      <div className="open-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpenMenu(null);
            fileRef.current?.click();
          }}
        >
          ROM file (.nds)
          <span className="hint">Nintendo DS ROM image</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpenMenu(null);
            folderRef.current?.click();
          }}
        >
          Unpacked folder
          <span className="hint">Nds4j / ds-rom extract</span>
        </button>
      </div>
    );
  }

  // Warn before leaving with unsaved edits (edits live only in the tab's memory until Save ROM).
  useEffect(() => {
    if (!dirty && !editorDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editorDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      e.preventDefault();
      if (key === "y" || (key === "z" && e.shiftKey)) void redo();
      else void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="app">
      <header className="topbar">
        {romHandle != null && (
          <button className="nav-toggle" aria-label="Toggle file list" onClick={() => setNavOpen(!navOpen)}>
            ☰
          </button>
        )}
        <div className="brand">
          <span className="logo">◆</span> <span className="brand-name">NitroViewer</span>
          <span className="tagline">DS ROM viewer</span>
        </div>
        <div className="topbar-actions">
          <span className={"status" + (loading ? " status--busy" : "")}>{status}</span>
          {(dirty || editorDirty) && (
            <span
              className="badge badge--dirty"
              title={
                editorDirty
                  ? "Unsaved color/sprite edits — Save in the editor, then Save ROM to download"
                  : "Unsaved edits — download with Save ROM"
              }
            >
              ● unsaved
            </span>
          )}
          {romHandle != null && (
            <>
              <button
                className="btn btn--icon"
                disabled={!canUndo}
                title={
                  useEditorUndo
                    ? canUndo
                      ? "Undo the last color/pixel edit"
                      : "Nothing to undo"
                    : canUndo
                      ? "Undo the last edit"
                      : "Nothing to undo"
                }
                onClick={() => void undo()}
              >
                ↶ Undo
              </button>
              <button
                className="btn btn--icon"
                disabled={!canRedo}
                title={
                  useEditorUndo
                    ? canRedo
                      ? "Redo the last color/pixel edit"
                      : "Nothing to redo"
                    : canRedo
                      ? "Redo the undone edit"
                      : "Nothing to redo"
                }
                onClick={() => void redo()}
              >
                ↷ Redo
              </button>
              <button
                className="btn btn--save"
                disabled={saving || !dirty}
                title={dirty ? "Download the edited .nds" : "No edits to save"}
                onClick={() => void saveRom()}
              >
                {saving ? "Saving…" : "Save ROM"}
              </button>
            </>
          )}
          <div className="open-wrap" ref={topOpenRef}>
            <button
              className="btn"
              disabled={!booted || loading}
              title="Open a .nds ROM or an unpacked ROM folder"
              onClick={() => void onOpenClick("top")}
            >
              {romHandle == null ? "Open ROM…" : "Open another…"}
            </button>
            {openMenu === "top" && openMenuItems()}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".nds"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openRom(f);
              e.target.value = "";
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              const list = e.target.files;
              if (list && list.length > 0) void openUnpackedFolder(list);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <main className="body">
        {loading ? (
          <div className="loading-screen">
            <div className="spinner" aria-label="Loading" />
            <div className="loading-text">{status}</div>
          </div>
        ) : romHandle == null ? (
          <div className="empty">
            <div className="empty-card">
              <div className="empty-logo">◆</div>
              <h1>NitroViewer</h1>
              <p>
                A modern replacement for Tinke. Open a Nintendo DS ROM file, or an unpacked ROM
                folder (Nds4j/PokEditor with header.bin, or a ds-rom extract with config.yaml).
              </p>
              <div className="empty-actions">
                <div className="open-wrap open-wrap--center" ref={emptyOpenRef}>
                  <button
                    className="btn btn--lg"
                    disabled={!booted}
                    title="Open a .nds ROM or an unpacked ROM folder"
                    onClick={() => void onOpenClick("empty")}
                  >
                    {booted ? "Open ROM…" : status}
                  </button>
                  {openMenu === "empty" && openMenuItems()}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={
              "split" + (navOpen ? " nav-open" : "") + (treeCollapsed ? " tree-collapsed" : "")
            }
            style={{ "--tree-w": `${treeWidth}px` } as CSSProperties}
          >
            <TreePane />
            {!treeCollapsed && (
              <div
                className={"tree-resizer" + (resizing ? " dragging" : "")}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize file browser"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setResizing(true);
                }}
                onDoubleClick={() => setTreeWidth(340)}
              />
            )}
            <InspectorPane />
            {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
            <button
              className="tree-collapse-btn"
              aria-label={treeCollapsed ? "Show file browser" : "Hide file browser"}
              title={treeCollapsed ? "Show file browser" : "Hide file browser"}
              onClick={() => setTreeCollapsed(!treeCollapsed)}
            >
              {treeCollapsed ? "▶" : "◀"}
            </button>
          </div>
        )}
      </main>
      {romName && romHandle != null && <footer className="statusbar">{romName}</footer>}
    </div>
  );
}
