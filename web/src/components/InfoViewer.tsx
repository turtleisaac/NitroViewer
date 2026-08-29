import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { base64ToBytes, hexDump } from "../util";

const PREVIEW_BYTES = 8192; // enough to identify a file; the whole file is one click away via Export

export function InfoViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const editVersion = useStore((s) => s.editVersion);
  const [info, setInfo] = useState<{ dump: string; size: number; format: string; compressed: boolean } | null>(null);
  const [err, setErr] = useState<string>();

  const { container, id } = selection.ref;
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setErr(undefined);
    // exportFile gives the DECOMPRESSED bytes — the real content — so the hex reflects the file itself,
    // not its LZ container.
    client
      .exportFile(romHandle, { container, id })
      .then((r) => {
        if (!alive) return;
        const bytes = base64ToBytes(r.base64);
        setInfo({ dump: hexDump(bytes, PREVIEW_BYTES), size: bytes.length, format: r.format, compressed: r.compressed });
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, container, id, editVersion]);

  if (err) return <div className="error">{err}</div>;
  if (!info) return <div className="placeholder">Reading…</div>;

  return (
    <div className="info">
      <p className="dim">
        {info.format ? `${info.format} — no dedicated viewer yet.` : "Unrecognised format."}{" "}
        {info.compressed && "Stored LZ-compressed; "}
        {info.size.toLocaleString()} B{info.size > PREVIEW_BYTES ? ` (hex preview of the first ${PREVIEW_BYTES.toLocaleString()})` : ""}.
        Use <strong>Export</strong> to save the whole file.
      </p>
      <pre className="hex">{info.dump}</pre>
    </div>
  );
}
