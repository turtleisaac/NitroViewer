"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nitroviewer", {
  pickOpen: () => ipcRenderer.invoke("nitroviewer:pick-open"),
});
