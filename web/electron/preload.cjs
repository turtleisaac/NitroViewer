"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nitroviewer", {
  pickOpen: () => ipcRenderer.invoke("nitroviewer:pick-open"),
  writeUnpacked: (dirPath, files) => ipcRenderer.invoke("nitroviewer:write-unpacked", { dirPath, files }),
});
