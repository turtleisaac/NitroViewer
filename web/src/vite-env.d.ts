/// <reference types="vite/client" />

import "react";

declare module "react" {
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
    /** The picked directory's absolute path, only when it IS an unpacked-ROM root itself (see
     *  looksLikeUnpackedRomRoot in main.cjs) — enables Save ROM's write-in-place path. */
    path?: string;
    files: { path: string; data: Uint8Array }[];
  }
  interface Window {
    nitroviewer?: {
      pickOpen: () => Promise<{ canceled: true; error?: string } | NitroviewerPickFile | NitroviewerPickFolder>;
      /** Write an unzipped unpacked-ROM tree back into `dirPath` (create/overwrite only, no deletes). */
      writeUnpacked: (
        dirPath: string,
        files: { path: string; data: Uint8Array }[]
      ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
    };
  }
}

export {};
