import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { useStore } from "./state/store";
import { TreePane } from "./components/TreePane";
import { InspectorPane } from "./components/InspectorPane";
import { Icon } from "./components/icons";

/** Uses the desktop shell's native picker when it is there. */
async function applyNativePick(): Promise<boolean> {
  const api = window.nitroviewer;
  if (!api?.pickOpen) return false;
  const result = await api.pickOpen();
  if (!result || !("kind" in result)) return true;
  const { openRomBytes, openUnpackedEntries } = useStore.getState();
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

/** Opens the native picker, or the in-page menu when the page is in a browser. */
async function onOpenClick(at: "top" | "empty", setOpenMenu: Dispatch<SetStateAction<null | "top" | "empty">>) {
  if (await applyNativePick()) return;
  setOpenMenu((cur) => (cur === at ? null : at));
}

/** The ROM-file and unpacked-folder choices. */
function openMenuItems(
  setOpenMenu: (menu: null | "top" | "empty") => void,
  fileRef: RefObject<HTMLInputElement>,
  folderRef: RefObject<HTMLInputElement>
): ReactNode {
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

/** Keeps the file-browser width following the pointer until the mouse is released. */
function trackTreeResize(setTreeWidth: (width: number) => void, setResizing: (resizing: boolean) => void): () => void {
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
}

/** Clicks outside either Open button close the menu. */
function closeOpenMenu(
  e: MouseEvent,
  top: HTMLDivElement | null,
  empty: HTMLDivElement | null,
  setOpenMenu: (menu: null | "top" | "empty") => void
) {
  const t = e.target as Node;
  if (top?.contains(t) || empty?.contains(t)) return;
  setOpenMenu(null);
}

/** Asks the browser to confirm before a tab with unsaved edits is closed. */
function warnBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "";
}

/** True while the key event landed in a field the browser should keep for itself. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Y, or Z with Shift, is redo. Plain Z is undo. */
function redoKey(key: string, shift: boolean): boolean {
  return key === "y" || (key === "z" && shift);
}

/** Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z (or Ctrl-Y) undo and redo, except while typing. */
function undoShortcut(e: KeyboardEvent, undo: () => Promise<void>, redo: () => Promise<void>) {
  if (!e.metaKey && !e.ctrlKey) return;
  const key = e.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  if (typingTarget(e.target)) return;
  e.preventDefault();
  if (redoKey(key, e.shiftKey)) void redo();
  else void undo();
}

export function App() {
  const boot = useStore((s) => s.boot);
  const booted = useStore((s) => s.booted);
  const status = useStore((s) => s.status);
  const loading = useStore((s) => s.loading);
  const romHandle = useStore((s) => s.romHandle);
  const romName = useStore((s) => s.romName);
  const openRom = useStore((s) => s.openRom);
  const openUnpackedFolder = useStore((s) => s.openUnpackedFolder);
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
    return trackTreeResize(setTreeWidth, setResizing);
  }, [resizing, setTreeWidth]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => closeOpenMenu(e, topOpenRef.current, emptyOpenRef.current, setOpenMenu);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [openMenu]);

  // Warn before leaving with unsaved edits (edits live only in the tab's memory until Save ROM).
  useEffect(() => {
    if (!dirty && !editorDirty) return;
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, editorDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => undoShortcut(e, undo, redo);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <AppFrame
      romHandle={romHandle}
      navOpen={navOpen}
      setNavOpen={setNavOpen}
      loading={loading}
      status={status}
      dirty={dirty}
      editorDirty={editorDirty}
      canUndo={canUndo}
      canRedo={canRedo}
      useEditorUndo={useEditorUndo}
      undo={undo}
      redo={redo}
      saving={saving}
      saveRom={saveRom}
      booted={booted}
      onOpenClick={(at) => onOpenClick(at, setOpenMenu)}
      openMenu={openMenu}
      openMenuItems={() => openMenuItems(setOpenMenu, fileRef, folderRef)}
      topOpenRef={topOpenRef}
      fileRef={fileRef}
      folderRef={folderRef}
      openRom={openRom}
      openUnpackedFolder={openUnpackedFolder}
      romName={romName}
      treeCollapsed={treeCollapsed}
      setTreeCollapsed={setTreeCollapsed}
      treeWidth={treeWidth}
      setTreeWidth={setTreeWidth}
      resizing={resizing}
      setResizing={setResizing}
      emptyOpenRef={emptyOpenRef}
    />
  );
}

/** Tooltip for the unsaved badge. */
function dirtyTitle(editorDirty: boolean): string {
  return editorDirty
    ? "Unsaved color/sprite edits — Save in the editor, then Save ROM to download"
    : "Unsaved edits — download with Save ROM";
}

/** Tooltip for Undo or Redo, for the editor stack or the ROM stack. */
function historyTitle(kind: "undo" | "redo", editor: boolean, can: boolean): string {
  if (kind === "undo") {
    if (!can) return "Nothing to undo";
    return editor ? "Undo the last color/pixel edit" : "Undo the last edit";
  }
  if (!can) return "Nothing to redo";
  return editor ? "Redo the last color/pixel edit" : "Redo the undone edit";
}

/** Tooltip for Save ROM. */
function saveTitle(dirty: boolean): string {
  return dirty ? "Download the edited .nds" : "No edits to save";
}

/** Opens the first chosen ROM file and clears the input so the same file can be picked again. */
function takeRomFile(e: ChangeEvent<HTMLInputElement>, openRom: (file: File) => Promise<void>) {
  const f = e.target.files?.[0];
  if (f) void openRom(f);
  e.target.value = "";
}

/** Opens a chosen unpacked folder and clears the input. */
function takeFolder(e: ChangeEvent<HTMLInputElement>, openUnpackedFolder: (files: FileList | File[]) => Promise<void>) {
  const list = e.target.files;
  if (list && list.length > 0) void openUnpackedFolder(list);
  e.target.value = "";
}

function AppFrame(props: {
  romHandle: number | null;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  loading: boolean;
  status: string;
  dirty: boolean;
  editorDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  useEditorUndo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saving: boolean;
  saveRom: () => Promise<void>;
  booted: boolean;
  onOpenClick: (at: "top" | "empty") => Promise<void>;
  openMenu: null | "top" | "empty";
  openMenuItems: () => ReactNode;
  topOpenRef: RefObject<HTMLDivElement>;
  fileRef: RefObject<HTMLInputElement>;
  folderRef: RefObject<HTMLInputElement>;
  openRom: (file: File) => Promise<void>;
  openUnpackedFolder: (files: FileList | File[]) => Promise<void>;
  romName: string;
  treeCollapsed: boolean;
  setTreeCollapsed: (collapsed: boolean) => void;
  treeWidth: number;
  setTreeWidth: (width: number) => void;
  resizing: boolean;
  setResizing: (resizing: boolean) => void;
  emptyOpenRef: RefObject<HTMLDivElement>;
}) {
  const {
    romHandle, navOpen, setNavOpen, loading, status, dirty, editorDirty, canUndo, canRedo,
    useEditorUndo, undo, redo, saving, saveRom, booted, onOpenClick, openMenu, openMenuItems,
    topOpenRef, fileRef, folderRef, openRom, openUnpackedFolder, romName, treeCollapsed,
    setTreeCollapsed, treeWidth, setTreeWidth, resizing, setResizing, emptyOpenRef,
  } = props;
  return (
    <div className="app">
      <AppHeader
        romHandle={romHandle}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        loading={loading}
        status={status}
        dirty={dirty}
        editorDirty={editorDirty}
        canUndo={canUndo}
        canRedo={canRedo}
        useEditorUndo={useEditorUndo}
        undo={undo}
        redo={redo}
        saving={saving}
        saveRom={saveRom}
        booted={booted}
        onOpenClick={onOpenClick}
        openMenu={openMenu}
        openMenuItems={openMenuItems}
        topOpenRef={topOpenRef}
        fileRef={fileRef}
        folderRef={folderRef}
        openRom={openRom}
        openUnpackedFolder={openUnpackedFolder}
      />
      <AppMain
        loading={loading}
        status={status}
        romHandle={romHandle}
        booted={booted}
        onOpenClick={onOpenClick}
        openMenu={openMenu}
        openMenuItems={openMenuItems}
        emptyOpenRef={emptyOpenRef}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        treeCollapsed={treeCollapsed}
        setTreeCollapsed={setTreeCollapsed}
        treeWidth={treeWidth}
        setTreeWidth={setTreeWidth}
        resizing={resizing}
        setResizing={setResizing}
      />
      {romName && romHandle != null && <footer className="statusbar">{romName}</footer>}
    </div>
  );
}

function HistoryButtons(props: {
  canUndo: boolean;
  canRedo: boolean;
  useEditorUndo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saving: boolean;
  dirty: boolean;
  saveRom: () => Promise<void>;
}) {
  const { canUndo, canRedo, useEditorUndo, undo, redo, saving, dirty, saveRom } = props;
  return (
    <>
      <button
        className="btn btn--icon"
        disabled={!canUndo}
        title={historyTitle("undo", useEditorUndo, canUndo)}
        onClick={() => void undo()}
      >
        <Icon name="undo" />
        <span className="btn-label">Undo</span>
      </button>
      <button
        className="btn btn--icon"
        disabled={!canRedo}
        title={historyTitle("redo", useEditorUndo, canRedo)}
        onClick={() => void redo()}
      >
        <Icon name="redo" />
        <span className="btn-label">Redo</span>
      </button>
      <button
        className="btn btn--save"
        disabled={saving || !dirty}
        title={saveTitle(dirty)}
        onClick={() => void saveRom()}
      >
        {saving ? (
          "Saving…"
        ) : (
          <>
            <span className="btn-label btn-label--wide">Save ROM</span>
            <span className="btn-label btn-label--narrow">Save</span>
          </>
        )}
      </button>
    </>
  );
}

function AppHeader(props: {
  romHandle: number | null;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  loading: boolean;
  status: string;
  dirty: boolean;
  editorDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  useEditorUndo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saving: boolean;
  saveRom: () => Promise<void>;
  booted: boolean;
  onOpenClick: (at: "top" | "empty") => Promise<void>;
  openMenu: null | "top" | "empty";
  openMenuItems: () => ReactNode;
  topOpenRef: RefObject<HTMLDivElement>;
  fileRef: RefObject<HTMLInputElement>;
  folderRef: RefObject<HTMLInputElement>;
  openRom: (file: File) => Promise<void>;
  openUnpackedFolder: (files: FileList | File[]) => Promise<void>;
}) {
  const {
    romHandle, navOpen, setNavOpen, loading, status, dirty, editorDirty, canUndo, canRedo,
    useEditorUndo, undo, redo, saving, saveRom, booted, onOpenClick, openMenu, openMenuItems,
    topOpenRef, fileRef, folderRef, openRom, openUnpackedFolder,
  } = props;
  return (
      <header className="topbar">
        {romHandle != null && (
          <button className="nav-toggle" aria-label="Toggle file list" onClick={() => setNavOpen(!navOpen)}>
            <Icon name="menu" />
          </button>
        )}
        <div className="brand">
          <span className="logo">◆</span>
          <span className="brand-name">NitroViewer</span>
          <span className="tagline">DS ROM viewer</span>
        </div>
        <div className="topbar-actions">
          <span className={"status" + (loading ? " status--busy" : "")}>{status}</span>
          {(dirty || editorDirty) && (
            <span
              className="badge badge--dirty"
              title={dirtyTitle(editorDirty)}
            >
              <span className="status-dot" />
              Unsaved
            </span>
          )}
          {romHandle != null && (
            <HistoryButtons
              canUndo={canUndo}
              canRedo={canRedo}
              useEditorUndo={useEditorUndo}
              undo={undo}
              redo={redo}
              saving={saving}
              dirty={dirty}
              saveRom={saveRom}
            />
          )}
          <div className="open-wrap" ref={topOpenRef}>
            <button
              className="btn"
              disabled={!booted || loading}
              title="Open a .nds ROM or an unpacked ROM folder"
              onClick={() => void onOpenClick("top")}
            >
              {romHandle == null ? (
                "Open ROM…"
              ) : (
                <>
                  <span className="btn-label btn-label--wide">Open another…</span>
                  <span className="btn-label btn-label--narrow">Open</span>
                </>
              )}
            </button>
            {openMenu === "top" && openMenuItems()}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".nds"
            hidden
            onChange={(e) => takeRomFile(e, openRom)}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            webkitdirectory=""
            directory=""
            onChange={(e) => takeFolder(e, openUnpackedFolder)}
          />
        </div>
      </header>
  );
}

/** Class names for the browser/inspector split. */
function splitClass(navOpen: boolean, collapsed: boolean): string {
  return "split" + (navOpen ? " nav-open" : "") + (collapsed ? " tree-collapsed" : "");
}

/** Label for the button that shows or hides the file browser. */
function browserLabel(collapsed: boolean): string {
  return collapsed ? "Show file browser" : "Hide file browser";
}

function RomWorkspace(props: {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  treeCollapsed: boolean;
  setTreeCollapsed: (collapsed: boolean) => void;
  treeWidth: number;
  setTreeWidth: (width: number) => void;
  resizing: boolean;
  setResizing: (resizing: boolean) => void;
}) {
  const { navOpen, setNavOpen, treeCollapsed, setTreeCollapsed, treeWidth, setTreeWidth, resizing, setResizing } = props;
  const label = browserLabel(treeCollapsed);
  return (
    <div className={splitClass(navOpen, treeCollapsed)} style={{ "--tree-w": `${treeWidth}px` } as CSSProperties}>
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
      <button className="tree-collapse-btn" aria-label={label} title={label} onClick={() => setTreeCollapsed(!treeCollapsed)}>
        {treeCollapsed ? <Icon name="chevron-right" /> : <Icon name="chevron-left" />}
      </button>
    </div>
  );
}

function AppMain(props: {
  loading: boolean;
  status: string;
  romHandle: number | null;
  booted: boolean;
  onOpenClick: (at: "top" | "empty") => Promise<void>;
  openMenu: null | "top" | "empty";
  openMenuItems: () => ReactNode;
  emptyOpenRef: RefObject<HTMLDivElement>;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  treeCollapsed: boolean;
  setTreeCollapsed: (collapsed: boolean) => void;
  treeWidth: number;
  setTreeWidth: (width: number) => void;
  resizing: boolean;
  setResizing: (resizing: boolean) => void;
}) {
  const {
    loading, status, romHandle, booted, onOpenClick, openMenu, openMenuItems, emptyOpenRef,
    navOpen, setNavOpen, treeCollapsed, setTreeCollapsed, treeWidth, setTreeWidth, resizing, setResizing,
  } = props;
  return (
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
                A replacement for Tinke. Open a Nintendo DS ROM file, or an unpacked ROM
                folder (Nds4j/PokEditor with header.bin, or a ds-rom extract with config.yaml).
              </p>
              <div className="empty-actions">
                <div className="open-wrap open-wrap--center" ref={emptyOpenRef}>
                  <button
                    className="btn btn--lg btn--primary"
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
          <RomWorkspace
            navOpen={navOpen}
            setNavOpen={setNavOpen}
            treeCollapsed={treeCollapsed}
            setTreeCollapsed={setTreeCollapsed}
            treeWidth={treeWidth}
            setTreeWidth={setTreeWidth}
            resizing={resizing}
            setResizing={setResizing}
          />
        )}
      </main>
  );
}
