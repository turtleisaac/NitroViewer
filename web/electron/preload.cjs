"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// A ROM path the OS wants opened in THIS window, passed in via webPreferences.additionalArguments at
// BrowserWindow construction (main.cjs) rather than pushed over IPC after load — additionalArguments
// land in this renderer's own process.argv before any script (including this one) runs, so there's no
// race against a listener not being registered yet. Static for the window's lifetime.
const OPEN_PATH_ARG_PREFIX = "--nitroviewer-open-path=";
const openPathArg = process.argv.find((a) => a.startsWith(OPEN_PATH_ARG_PREFIX));
const startupFilePath = openPathArg ? openPathArg.slice(OPEN_PATH_ARG_PREFIX.length) : null;

contextBridge.exposeInMainWorld("nitroviewer", {
  pickOpen: () => ipcRenderer.invoke("nitroviewer:pick-open"),
  newWindow: () => ipcRenderer.invoke("nitroviewer:new-window"),
  getWindowId: () => ipcRenderer.invoke("nitroviewer:get-window-id"),
  requestDraggedFile: (sourceWindowId, ref) =>
    ipcRenderer.invoke("nitroviewer:request-dragged-file", { sourceWindowId, ref }),
  onProvideDraggedFile: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("nitroviewer:provide-dragged-file", listener);
    return () => ipcRenderer.removeListener("nitroviewer:provide-dragged-file", listener);
  },
  replyDraggedFile: (payload) => ipcRenderer.send("nitroviewer:dragged-file-reply", payload),
  startupFilePath,
  readFile: (filePath) => ipcRenderer.invoke("nitroviewer:read-file", filePath),
});
