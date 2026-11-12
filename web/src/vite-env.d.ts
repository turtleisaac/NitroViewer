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
    files: { path: string; data: Uint8Array }[];
  }
  interface NitroviewerResourceRef {
    container: number;
    id: number;
  }
  interface NitroviewerDraggedFileRequest {
    requestId: string;
    ref: NitroviewerResourceRef;
  }
  interface NitroviewerDraggedFileReply {
    requestId: string;
    ok: boolean;
    base64?: string;
    error?: string;
  }
  interface Window {
    nitroviewer?: {
      pickOpen: () => Promise<{ canceled: true; error?: string } | NitroviewerPickFile | NitroviewerPickFolder>;
      newWindow: () => Promise<{ ok: true } | { ok: false; error: string }>;
      getWindowId: () => Promise<number | null>;
      requestDraggedFile: (
        sourceWindowId: number,
        ref: NitroviewerResourceRef
      ) => Promise<{ ok: true; base64: string } | { ok: false; error: string }>;
      onProvideDraggedFile: (handler: (payload: NitroviewerDraggedFileRequest) => void) => () => void;
      replyDraggedFile: (payload: NitroviewerDraggedFileReply) => void;
      startupFilePath: string | null;
      readFile: (
        filePath: string
      ) => Promise<{ ok: true; name: string; bytes: Uint8Array } | { ok: false; error: string }>;
    };
  }
}

export {};
