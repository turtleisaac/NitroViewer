import { useEffect, useState } from "react";
import { useStore } from "../state/store";

// SPA effects are rendered to frames server-side (Nds4j ParticleRenderer); the viewer just cycles
// the pre-rendered frames, so a simple interval is fine (no CheerpJ call during playback).
export function ParticleViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [data, setData] = useState<{ emitterCount: number; frames: string[] } | null>(null);
  const [err, setErr] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  const { container, id } = selection.ref;
  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(undefined);
    setFrame(0);
    setPlaying(true);
    client
      .renderParticles(romHandle, { container, id }, 256, 256, 48)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, container, id]);

  useEffect(() => {
    if (!data || !playing || data.frames.length <= 1) return;
    const iv = setInterval(() => setFrame((f) => (f + 1) % data.frames.length), 1000 / 30);
    return () => clearInterval(iv);
  }, [data, playing]);

  if (err) return <div className="error">Could not render effect: {err}</div>;
  if (!data) return <div className="placeholder">Rendering particle effect…</div>;

  return (
    <div className="particles">
      <div className="controls">
        <div className="ctrl">
          <span>Emitters</span>
          <div className="stepper"><span>{data.emitterCount}</span></div>
        </div>
        <label className="ctrl">
          <span>Playback</span>
          <button className="play-btn" onClick={() => setPlaying((p) => !p)}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
        </label>
        <div className="ctrl">
          <span>Frame</span>
          <div className="stepper"><span>{frame} / {data.frames.length - 1}</span></div>
        </div>
      </div>
      <div className="pviewport">
        {data.frames.length > 0 ? <img className="pframe" src={data.frames[frame]} alt="" /> : <div className="placeholder">no frames</div>}
      </div>
    </div>
  );
}
