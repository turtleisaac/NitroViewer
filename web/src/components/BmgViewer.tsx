import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { BmgData } from "../transport";

const ENCODING_NAMES: Record<number, string> = { 1: "Windows-1252", 2: "UTF-16", 3: "Shift-JIS", 4: "UTF-8" };

export function BmgViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const setBmgMessage = useStore((s) => s.setBmgMessage);
  const editVersion = useStore((s) => s.editVersion);

  const [bmg, setBmg] = useState<BmgData | null>(null);
  const [err, setErr] = useState<string>();
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  useEffect(() => {
    let alive = true;
    setBmg(null);
    setErr(undefined);
    setSelected(null);
    client
      .decodeBmg(romHandle, { container: refContainer, id: refId })
      .then((d) => alive && setBmg(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, refContainer, refId, editVersion]);

  const select = (i: number, text: string) => {
    setSelected(i);
    setDraft(text);
  };

  const dirty = selected != null && bmg && draft !== bmg.messages[selected].text;

  const onSave = async () => {
    if (selected == null) return;
    setBusy(true);
    try {
      await setBmgMessage(selection.ref, selected, draft);
    } catch (e) {
      alert("Saving message failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div className="error">Could not decode BMG: {err}</div>;
  if (!bmg) return <div className="placeholder">Decoding messages…</div>;

  const filtered = bmg.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => !filter || m.text.toLowerCase().includes(filter.toLowerCase()) || String(i).includes(filter));

  return (
    <div className="bmg">
      <div className="palette-bar">
        <div className="palette-info">
          {bmg.count} messages · {ENCODING_NAMES[bmg.encoding] ?? `encoding ${bmg.encoding}`}
          {bmg.bigEndian ? " · big-endian" : ""}
          {(bmg.hasFlw1 || bmg.hasFli1) && <span className="dim"> · has script-flow data (preserved, not editable)</span>}
        </div>
        <input
          className="bmg-filter"
          type="text"
          placeholder="Filter messages…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="bmg-body">
        <div className="bmg-list">
          {filtered.map(({ m, i }) => (
            <button
              key={i}
              type="button"
              className={"bmg-row" + (selected === i ? " bmg-row--selected" : "")}
              onClick={() => select(i, m.text)}
            >
              <span className="bmg-row-idx">#{i}</span>
              <span className="bmg-row-text">
                {m.isNull ? <em className="dim">(no text)</em> : m.text.slice(0, 80).replace(/\n/g, " ⏎ ") || <em className="dim">(empty)</em>}
              </span>
              {m.hasEscapes && <span className="badge badge--lz" title="Contains formatting/escape codes, shown as [type:hexdata]">FX</span>}
            </button>
          ))}
        </div>
        {selected != null && (
          <div className="bmg-editor">
            <div className="bmg-editor-head">
              <span>Message #{selected}</span>
              {bmg.messages[selected].hasEscapes && (
                <span className="dim">
                  This message contains formatting/escape codes, shown as [type:hexdata] tokens (e.g. a
                  player-name insert or an icon glyph) — keep them intact when editing the surrounding text,
                  or edit a token's hex data directly. Saving parses them back into real escape sequences.
                </span>
              )}
            </div>
            <textarea
              className="bmg-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
            />
            <div className="bmg-editor-actions">
              <button className="btn btn--save btn--sm" disabled={busy || !dirty} onClick={() => void onSave()}>
                {busy ? "…" : "Save"}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                disabled={busy || !dirty}
                onClick={() => setDraft(bmg.messages[selected].text)}
              >
                Revert
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
