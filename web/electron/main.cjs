"use strict";

// Electron shell around the Vite-built SPA. CheerpJ still runs the Java facade in
// Chromium; this process only hosts a Range-capable localhost server and a window.

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, net, shell } = require("electron");
const { startServer, cheerpjDir } = require("./serve.cjs");

let mainWindow = null;
let server = null;
let origin = null;

function webRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "web");
  return path.join(__dirname, "..", "dist");
}

function iconPath() {
  return path.join(__dirname, "icon.png");
}

async function createWindow() {
  const root = webRoot();
  if (!fs.existsSync(path.join(root, "index.html"))) {
    dialog.showErrorBox(
      "NitroViewer",
      "Web assets not found. From the repo root run `make build`, or `npm run build` in web/ then `npm run electron`."
    );
    app.quit();
    return;
  }
  if (!cheerpjDir(root)) {
    dialog.showErrorBox(
      "NitroViewer",
      "CheerpJ runtime is not vendored. From the repo root run `make build` (or `./scripts/vendor-cheerpj.sh`)."
    );
    app.quit();
    return;
  }

  if (!server) {
    const started = await startServer(root);
    server = started.server;
    origin = started.url;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: "NitroViewer",
    backgroundColor: "#0d0e12",
    icon: iconPath(),
    show: false,
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;

  win.once("ready-to-show", () => {
    win.show();
    if (app.isPackaged) {
      setTimeout(() => {
        checkForUpdate(win).catch(() => {});
      }, 8000);
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle("NitroViewer");
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!origin || url.startsWith(origin)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Offline: serve CheerpJ from the bundled tree. Redirect any leftover CDN
  // hits locally and drop other remote renderer requests.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    if (
      (origin && u.startsWith(origin)) ||
      u.startsWith("devtools://") ||
      u.startsWith("chrome://") ||
      u.startsWith("chrome-extension://") ||
      u.startsWith("about:") ||
      u.startsWith("blob:") ||
      u.startsWith("data:")
    ) {
      callback({});
      return;
    }
    const cdn = /^https?:\/\/cjrtnc\.leaningtech\.com\/[^/]+\/?(.*)$/.exec(u);
    if (cdn) {
      callback({ redirectURL: origin + "cheerpj/" + cdn[1] });
      return;
    }
    callback({ cancel: true });
  });

  await win.loadURL(origin);
}

function repoSlug() {
  try {
    const pkg = require("../package.json");
    const url = (pkg.repository && pkg.repository.url) || pkg.repository || "";
    const m = String(url).match(/github\.com[:/](.+?)(?:\.git)?$/i);
    if (m) return m[1];
  } catch {
    // packaged fallback
  }
  return "turtleisaac/NitroViewer";
}

function versionParts(v) {
  return String(v)
    .replace(/^v/, "")
    .split(/[.+-]/)
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = versionParts(remote);
  const l = versionParts(local);
  const n = Math.max(r.length, l.length);
  for (let i = 0; i < n; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function preferredExt() {
  if (process.platform === "darwin") return ".dmg";
  if (process.platform === "win32") return ".exe";
  return ".AppImage";
}

function builderOs() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "linux";
}

function builderArch() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function pickDownloadUrl(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const needle = `-${builderOs()}-${builderArch()}`;
  const ext = preferredExt();
  const exact = assets.find((a) => a.name && a.name.includes(needle) && a.name.endsWith(ext));
  if (exact && exact.browser_download_url) return exact.browser_download_url;
  const any = assets.find((a) => a.name && a.name.includes(needle) && a.browser_download_url);
  if (any) return any.browser_download_url;
  return release.html_url || `https://github.com/${repoSlug()}/releases/latest`;
}

async function checkForUpdate(win) {
  const res = await net.fetch(`https://api.github.com/repos/${repoSlug()}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "NitroViewer",
    },
  });
  if (!res.ok) return;
  const latest = await res.json();
  const latestVer = String(latest.tag_name || "").replace(/^v/, "");
  const current = app.getVersion();
  if (!latestVer || !isNewer(latestVer, current)) return;
  if (win.isDestroyed()) return;

  const choice = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "NitroViewer",
    message: `NitroViewer ${latestVer} is available`,
    detail: `You have ${current}. Download the new version from GitHub?`,
  });
  if (choice.response !== 0) return;
  await shell.openExternal(pickDownloadUrl(latest));
}

function isSkippableRel(rel) {
  const parts = String(rel).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some(
    (p) => p === "__MACOSX" || p === ".DS_Store" || p === "Thumbs.db" || p === ".git" || p.startsWith("._")
  );
}

function walkFolder(dir, prefix, out) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (!ent || ent.name === "." || ent.name === "..") continue;
    const rel = prefix ? prefix + "/" + ent.name : ent.name;
    if (isSkippableRel(rel)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFolder(full, rel, out);
    else if (ent.isFile()) out.push({ path: rel, data: fs.readFileSync(full) });
  }
}

function packPickedPath(picked) {
  const stat = fs.statSync(picked);
  if (stat.isDirectory()) {
    const files = [];
    walkFolder(picked, path.basename(picked), files);
    return { kind: "folder", name: path.basename(picked), files };
  }
  return { kind: "file", name: path.basename(picked), bytes: fs.readFileSync(picked) };
}

async function pickOpenDialog(win) {
  const filters = [
    { name: "Nintendo DS ROM", extensions: ["nds", "srl"] },
    { name: "All files", extensions: ["*"] },
  ];
  // macOS NSOpenPanel can choose a file or a directory in one sheet. Windows/Linux
  // cannot, so ask which kind first, then open the matching dialog.
  let filePaths;
  let canceled;
  if (process.platform === "darwin") {
    const result = await dialog.showOpenDialog(win, {
      title: "Open ROM or unpacked folder",
      message: "Select a .nds ROM file or an unpacked ROM folder",
      properties: ["openFile", "openDirectory"],
      filters,
    });
    canceled = result.canceled;
    filePaths = result.filePaths;
  } else {
    const choice = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["ROM file", "Unpacked folder", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Open",
      message: "What do you want to open?",
      detail: "A .nds ROM file, or an unpacked ROM folder (Nds4j / ds-rom extract).",
    });
    if (choice.response === 2) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: choice.response === 0 ? "Open ROM" : "Open unpacked folder",
      properties: choice.response === 0 ? ["openFile"] : ["openDirectory"],
      filters: choice.response === 0 ? filters : undefined,
    });
    canceled = result.canceled;
    filePaths = result.filePaths;
  }
  if (canceled || !filePaths || !filePaths[0]) return { canceled: true };
  return packPickedPath(filePaths[0]);
}

ipcMain.handle("nitroviewer:pick-open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    return await pickOpenDialog(win);
  } catch (err) {
    return { canceled: true, error: String(err && err.message ? err.message : err) };
  }
});

app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");
app.setName("NitroViewer");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => createWindow().catch((err) => {
    console.error(err);
    dialog.showErrorBox("NitroViewer", String(err && err.stack ? err.stack : err));
    app.quit();
  }));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => console.error(err));
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) {
    server.close();
    server = null;
  }
});
