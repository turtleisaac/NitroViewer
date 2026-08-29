import { useEffect, useRef } from "react";
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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> NitroViewer
          <span className="tagline">DS ROM viewer · runs in your browser · nothing is uploaded</span>
        </div>
        <div className="topbar-actions">
          <span className={"status" + (loading ? " status--busy" : "")}>{status}</span>
          <button className="btn" disabled={!booted || loading} onClick={() => fileRef.current?.click()}>
            {romHandle == null ? "Open ROM…" : "Open another…"}
          </button>
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
        </div>
      </header>

      <main className="body">
        {romHandle == null ? (
          <div className="empty">
            <div className="empty-card">
              <div className="empty-logo">◆</div>
              <h1>NitroViewer</h1>
              <p>
                A modern replacement for Tinke. Open a Nintendo DS ROM to browse its filesystem and
                view its graphics. Everything runs locally via CheerpJ — your ROM never leaves this tab.
              </p>
              <button className="btn btn--lg" disabled={!booted} onClick={() => fileRef.current?.click()}>
                {booted ? "Open a .nds ROM" : status}
              </button>
            </div>
          </div>
        ) : (
          <div className="split">
            <TreePane />
            <InspectorPane />
          </div>
        )}
      </main>
      {romName && romHandle != null && <footer className="statusbar">{romName}</footer>}
    </div>
  );
}
