import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const nodeRequire = createRequire(import.meta.url);

interface DonationDialog {
  type: string;
  buttons: string[];
  title: string;
  message: string;
  detail: string;
}

interface PokeHubModule {
  isPokeHub: (command: string | null | undefined) => boolean;
  commandsFromListing: (platform: string, stdout: string) => string[];
  pokeHubIsRunning: (platform?: string) => Promise<boolean>;
  showDonationNotice: (
    showMessageBox: (dialog: DonationDialog) => Promise<unknown>,
    isRunning: () => Promise<boolean>,
  ) => Promise<void>;
}

function loadPokeHub(): PokeHubModule {
  const loaded: unknown = nodeRequire("../electron/pokeHub.cjs") as unknown;
  if (!loaded || typeof loaded !== "object") throw new Error("pokeHub module");
  return loaded as PokeHubModule;
}

const { isPokeHub, commandsFromListing, pokeHubIsRunning, showDonationNotice } = loadPokeHub();

const NOTICE = {
  message: "We do not ask for donations, and we do not support them.",
  detail:
    "Do not donate to any program that launches NitroViewer or that takes code from NitroViewer. " +
    "Any such program that asks for donations does so against our expressed wishes.",
};

describe("isPokeHub", () => {
  it.each([
    "C:\\Program Files\\PokeHub\\PokeHub.exe",
    "C:\\Program Files\\PokeHub\\PokeHub.App.exe",
    "C:\\Program Files\\PokeHub\\pokehub.mcp.EXE",
    "D:\\tools\\pokehub.exe",
    "\\\\server\\share\\PokeHub.App.exe",
    "/Applications/PokeHub.app/Contents/MacOS/PokeHub",
    "/usr/local/bin/PokeHub.App",
    "/opt/pokehub/PokeHub.Mcp",
    "PokeHub",
    "PokeHub.App",
    "PokeHub.Mcp",
  ])("matches %s by executable base name", (command) => {
    expect(isPokeHub(command)).toBe(true);
  });

  it.each([
    "C:\\Windows\\System32\\notepad.exe",
    "C:\\PokeHub\\notepad.exe",
    "/Applications/PokeHub.app/Contents/MacOS/java",
    "/usr/bin/java",
    "PokeHubEditor",
    "NotPokeHub",
    "PokeHub.Mcp.Worker",
    ".exe",
    "",
  ])("rejects %s", (command) => {
    expect(isPokeHub(command)).toBe(false);
  });

  it("rejects a missing command", () => {
    expect(isPokeHub(null)).toBe(false);
    expect(isPokeHub(undefined)).toBe(false);
  });
});

describe("commandsFromListing", () => {
  it("reads Windows tasklist image names, including .exe", () => {
    const csv = [
      '"PokeHub.exe","1234","Console","1","10,000 K"',
      '"notepad.exe","5","Console","1","1,000 K"',
      '"PokeHub.App.exe","9","Console","1","2,000 K"',
      "PokeHub.Mcp",
      "",
    ].join("\r\n");

    const names = commandsFromListing("win32", csv);

    expect(names.filter(isPokeHub)).toEqual(["PokeHub.exe", "PokeHub.App.exe", "PokeHub.Mcp"]);
  });

  it("reads ps comm names and skips blanks", () => {
    const text = "systemd\n\n/usr/local/bin/PokeHub.Mcp\n  pokehub.app  \n";

    const names = commandsFromListing("linux", text);

    expect(names.filter(isPokeHub)).toEqual(["/usr/local/bin/PokeHub.Mcp", "pokehub.app"]);
  });
});

describe("pokeHubIsRunning", () => {
  it("reads this machine and does not throw when the listing command is missing", async () => {
    await expect(pokeHubIsRunning()).resolves.toBe(false);
    await expect(pokeHubIsRunning("win32")).resolves.toBe(false);
  });
});

describe("showDonationNotice", () => {
  it("shows the NitroViewer notice when PokeHub is running", async () => {
    const shown: DonationDialog[] = [];

    await showDonationNotice(
      (dialog) => {
        shown.push(dialog);
        return Promise.resolve(undefined);
      },
      () => Promise.resolve(true),
    );

    expect(shown).toEqual([
      {
        type: "info",
        buttons: ["OK"],
        title: "NitroViewer",
        message: NOTICE.message,
        detail: NOTICE.detail,
      },
    ]);
  });

  it("stays quiet when PokeHub is not running", async () => {
    let called = false;

    await showDonationNotice(
      () => {
        called = true;
        return Promise.resolve(undefined);
      },
      () => Promise.resolve(false),
    );

    expect(called).toBe(false);
  });

  it("swallows a process-list error and a dialog error", async () => {
    await expect(
      showDonationNotice(
        () => Promise.resolve(undefined),
        () => Promise.reject(new Error("ps failed")),
      ),
    ).resolves.toBeUndefined();

    await expect(
      showDonationNotice(
        () => Promise.reject(new Error("dialog failed")),
        () => Promise.resolve(true),
      ),
    ).resolves.toBeUndefined();
  });
});
