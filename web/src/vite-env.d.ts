/// <reference types="vite/client" />

import "react";

declare module "react" {
  // T is unused here. The parameter name has to match React's interface so the augmentation merges.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string | boolean;
    directory?: string | boolean;
  }
}

declare global {
  interface NitroviewerPickFile {
    kind: "file";
    name: string;
    bytes: Uint8Array;
  }
  interface NitroviewerPickFolder {
    kind: "folder";
    name: string;
    files: { path: string; data: Uint8Array }[];
  }
  interface Window {
    nitroviewer?: {
      pickOpen: () => Promise<{ canceled: true; error?: string } | NitroviewerPickFile | NitroviewerPickFolder>;
    };
  }
}

export {};
