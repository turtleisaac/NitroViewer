import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useChangedKey } from "../useChangedKey";
import { holdParticleClock, loadParticles, type ParticleFrames } from "./particlePlayback";
import { Icon } from "./icons";

/** Pause or play label. */
function playPause(playing: boolean) {
  if (playing) return <><Icon name="pause" /> Pause</>;
  return <><Icon name="play" /> Play</>;
}

/** The current particle frame, or a note when the effect has none. */
function frameView(frames: string[], frame: number) {
  if (frames.length === 0) return <div className="placeholder">no frames</div>;
  return <img className="pframe" src={frames[frame]} alt="" />;
}

// SPA effects are rendered to frames server-side. A unit playback rate comes back as per-frame
// delays; the viewer only advances those frames, with no further preview call.
export function ParticleViewer() {
  const selection = useStore((s) => s.selection)!;
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const [data, setData] = useState<ParticleFrames | null>(null);
  const [err, setErr] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frameRef = useRef(0);

  const { container, id } = selection.ref;

  if (useChangedKey(`${romHandle}:${container}:${id}`)) {
    setData(null);
    setErr(undefined);
    setFrame(0);
    setPlaying(true);
  }

  useEffect(() => {
    return loadParticles(client, romHandle, container, id, setData, setErr);
  }, [client, romHandle, container, id]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    return holdParticleClock(data, playing, frameRef, setFrame);
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
            {playPause(playing)}
          </button>
        </label>
        <div className="ctrl">
          <span>Frame</span>
          <div className="stepper"><span>{frame} / {data.frames.length - 1}</span></div>
        </div>
      </div>
      <div className="pviewport">
        {frameView(data.frames, frame)}
      </div>
    </div>
  );
}
