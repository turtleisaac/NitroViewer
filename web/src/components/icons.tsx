import type { ReactNode } from "react";

export type IconName =
  | "menu"
  | "undo"
  | "redo"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "play"
  | "pause"
  | "stop"
  | "download"
  | "upload";

/** 16px line icon. Stroke follows currentColor so it takes the text role around it. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph(name)}
    </svg>
  );
}

const GLYPHS: Record<IconName, ReactNode> = {
  menu: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  undo: <path d="M6.5 4.5 3 8l3.5 3.5M3.5 8H10a2.75 2.75 0 1 1 0 5.5H8" />,
  redo: <path d="M9.5 4.5 13 8l-3.5 3.5M12.5 8H6a2.75 2.75 0 1 0 0 5.5H8" />,
  "chevron-left": <path d="M10 3.5 5.5 8 10 12.5" />,
  "chevron-right": <path d="M6 3.5 10.5 8 6 12.5" />,
  "chevron-down": <path d="M3.5 6 8 10.5 12.5 6" />,
  play: <path d="M6.25 4.25 12 8 6.25 11.75Z" />,
  pause: <path d="M6 4.5v7M10 4.5v7" />,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1" />,
  download: <path d="M8 3v6.5M5.25 7.25 8 10l2.75-2.75M3.5 13h9" />,
  upload: <path d="M8 10.5V4M5.25 6.75 8 4l2.75 2.75M3.5 13h9" />,
};

/** The mark or stroke path for one icon name. */
function glyph(name: IconName): ReactNode {
  return GLYPHS[name];
}
