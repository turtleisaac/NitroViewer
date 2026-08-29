import { useEffect, useState } from "react";
import { useStore } from "../state/store";

interface Tex {
  name: string;
  width: number;
  height: number;
  png: string;
}

export function TextureViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [textures, setTextures] = useState<Tex[] | null>(null);
  const [err, setErr] = useState<string>();

  const { container, id } = selection.ref;
  useEffect(() => {
    let alive = true;
    setTextures(null);
    setErr(undefined);
    client
      .getTextureSet(romHandle, { container, id })
      .then((d) => alive && setTextures(d.textures))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, container, id]);

  if (err) return <div className="error">Could not decode textures: {err}</div>;
  if (!textures) return <div className="placeholder">Decoding textures…</div>;
  if (textures.length === 0) return <div className="placeholder">No textures in this NSBTX.</div>;

  return (
    <div className="texset">
      <div className="narc-info">{textures.length} textures</div>
      <div className="texgrid">
        {textures.map((t, i) => (
          <div key={i} className="texcard">
            <div className="texframe">
              <img className="teximg" src={t.png} alt={t.name} />
            </div>
            <div className="texname" title={t.name}>{t.name}</div>
            <div className="texdim">{t.width}×{t.height}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
