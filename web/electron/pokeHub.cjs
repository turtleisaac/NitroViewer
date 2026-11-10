"use strict";

const { execFile } = require("child_process");

const NAMES = new Set(["pokehub", "pokehub.app", "pokehub.mcp"]);

const DONATION_DIALOG = {
  type: "info",
  buttons: ["OK"],
  title: "NitroViewer",
  message: "We do not ask for donations, and we do not support them.",
  detail:
    "Do not donate to any program that launches NitroViewer or that takes code from NitroViewer. " +
    "Any such program that asks for donations does so against our expressed wishes.",
};

function baseName(text) {
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));

  return text.slice(cut + 1);
}

function withoutExe(name) {
  const ext = name.slice(-4).toLowerCase();
  if (name.length > 4 && ext === ".exe") return name.slice(0, -4);

  return name;
}

function isPokeHub(command) {
  if (command == null || command === "") return false;
  const name = withoutExe(baseName(command.trim())).toLowerCase();

  return NAMES.has(name);
}

function commandToken(platform, line) {
  const trimmed = line.trim();
  if (platform !== "win32") return trimmed;
  const quoted = /^"([^"]*)"/.exec(trimmed);
  if (quoted) return quoted[1];

  return trimmed;
}

function commandsFromListing(platform, stdout) {
  const names = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const token = commandToken(platform, line);
    if (token) names.push(token);
  }

  return names;
}

function listingInvocation(platform) {
  if (platform === "win32") return ["tasklist", ["/FO", "CSV", "/NH"]];

  return ["ps", ["-A", "-o", "comm="]];
}

function readProcessListing(platform) {
  const spec = listingInvocation(platform);

  return new Promise((resolve, reject) => {
    execFile(
      spec[0],
      spec[1],
      { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      },
    );
  });
}

// PokeHub stays open when it launches NitroViewer, so a process check covers both cases.
async function pokeHubIsRunning(platform = process.platform) {
  try {
    const text = await readProcessListing(platform);

    return commandsFromListing(platform, text).some(isPokeHub);
  } catch {
    return false;
  }
}

async function showDonationNotice(showMessageBox, isRunning) {
  let running = false;
  try {
    running = await isRunning();
  } catch {
    return;
  }

  if (!running) return;

  try {
    await showMessageBox(DONATION_DIALOG);
  } catch {
    return;
  }
}

module.exports = {
  isPokeHub,
  commandsFromListing,
  pokeHubIsRunning,
  showDonationNotice,
};
