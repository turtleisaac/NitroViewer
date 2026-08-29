import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { refKey, type NarcEntry } from "../transport";

export function NarcBrowser() {
  const selection = useStore((s) => s.selection)!;
  const ensureNarc = useStore((s) => s.ensureNarc);
  const select = useStore((s) => s.select);
  const [state, setState] = useState<{ narcHandle: number; entries: NarcEntry[] } | null>(null);
  const [err, setErr] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);

  const selKey = refKey(selection.ref);
  useEffect(() => {
    let alive = true;
    setState(null);
    setErr(undefined);
    // Open by the selection's own (container,id) — works for a ROM-file NARC and a NARC-in-NARC alike.
    ensureNarc(selection.ref)
      .then((r) => alive && setState(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, ensureNarc]);

  // Preserve how far the user scrolled the file grid: restore on (re)open, save on scroll — so pressing
  // the breadcrumb to come back lands where they left off instead of at the top. The scroll happens on
  // the shared .inspector-body ancestor, keyed by narcHandle. Read/write the store imperatively so
  // scrolling doesn't re-render.
  useEffect(() => {
    if (!state) return;
    const scroller = rootRef.current?.closest(".inspector-body") as HTMLElement | null;
    if (!scroller) return;
    scroller.scrollTop = useStore.getState().narcScroll[state.narcHandle] ?? 0;
    const onScroll = () => useStore.getState().setNarcScroll(state.narcHandle, scroller.scrollTop);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [state]);

  if (err) return <div className="error">Could not open NARC: {err}</div>;
  if (!state) return <div className="placeholder">Opening NARC…</div>;

  return (
    <div className="narc" ref={rootRef}>
      <div className="narc-info">{state.entries.length} embedded files — click to inspect</div>
      <div className="narc-grid">
        {state.entries.map((e) => (
          <button
            key={e.index}
            className="narc-item"
            onClick={() =>
              void select({ container: state.narcHandle, id: e.index }, `${selection.name} : #${e.index}`)
            }
          >
            <span className="narc-idx">#{e.index}</span>
            <span className={"badge" + (e.format ? " badge--fmt" : "")}>{e.format || "raw"}</span>
            <span className="narc-size">{e.size}B</span>
          </button>
        ))}
      </div>
    </div>
  );
}
