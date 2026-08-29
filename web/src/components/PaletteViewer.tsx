import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { PaletteData } from "../transport";

export function PaletteViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [pal, setPal] = useState<PaletteData | null>(null);
  const [err, setErr] = useState<string>();

  const refId = selection.ref.id;
  const refContainer = selection.ref.container;
  useEffect(() => {
    let alive = true;
    setPal(null);
    setErr(undefined);
    client
      .decodePalette(romHandle, { container: refContainer, id: refId })
      .then((p) => alive && setPal(p))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, refContainer, refId]);

  if (err) return <div className="error">Could not decode palette: {err}</div>;
  if (!pal) return <div className="placeholder">Decoding palette…</div>;

  return (
    <div className="palette">
      <div className="palette-info">{pal.count} colors</div>
      <div className="swatches">
        {pal.colors.map((c, i) => (
          <div key={i} className="swatch" style={{ background: c }} title={`#${i} ${c}`} />
        ))}
      </div>
    </div>
  );
}
