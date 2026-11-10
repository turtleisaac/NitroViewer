import { Icon } from "./icons";

/** Play or pause label shared by the model and sprite transport controls. */
export function PlayPauseLabel({ playing }: { playing: boolean }) {
  if (playing) return <><Icon name="pause" /> Pause</>;
  return <><Icon name="play" /> Play</>;
}
