import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { base64ToBytes, hexDump } from "../util";

export function InfoViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [dump, setDump] = useState<string>("");
  const [err, setErr] = useState<string>();

  const { container, id } = selection.ref;
  useEffect(() => {
    let alive = true;
    setDump("");
    setErr(undefined);
    client
      .exportRaw(romHandle, { container, id })
      .then((r) => alive && setDump(hexDump(base64ToBytes(r.base64))))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, container, id]);

  if (err) return <div className="error">{err}</div>;
  return (
    <div className="info">
      <p className="dim">
        {selection.format ? `${selection.format} — no dedicated viewer yet.` : "Unrecognised format."}{" "}
        Showing a raw hex preview.
      </p>
      <pre className="hex">{dump || "…"}</pre>
    </div>
  );
}
