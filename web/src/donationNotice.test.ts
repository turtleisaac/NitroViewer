import { describe, expect, it } from "vitest";
import {
  dismissDonationNotice,
  donationDismissed,
  referrerHost,
  shouldShowDonationNotice,
} from "./donationNotice";

const quiet = [
  "",
  "not a url",
  "https://www.google.com/search?q=nitroviewer",
  "https://google.co.uk/search?q=nitroviewer",
  "https://www.google.com.au/search?q=nitroviewer",
  "https://google.de/search?q=nitro",
  "https://www.bing.com/search?q=nitroviewer",
  "https://duckduckgo.com/?q=nitroviewer",
  "https://search.yahoo.com/search?p=nitroviewer",
  "https://www.baidu.com/s?wd=nitroviewer",
  "https://yandex.ru/search/?text=nitroviewer",
  "https://www.ecosia.org/search?q=nitroviewer",
  "https://search.brave.com/search?q=nitroviewer",
  "https://kagi.com/search?q=nitroviewer",
  "https://github.com/turtleisaac/NitroViewer",
  "https://gist.github.com/turtleisaac",
  "https://discord.com/channels/1/2",
  "https://discord.gg/nitroviewer",
  "https://nitroviewer.com/",
  "https://www.nitroviewer.com/tools",
];

describe("shouldShowDonationNotice", () => {
  it.each(quiet)("stays quiet for %s", (referrer) => {
    expect(shouldShowDonationNotice(referrer, false)).toBe(false);
  });

  it.each([
    "https://example.com/launcher",
    "https://reddit.com/r/pokemon",
    "https://pokehub.github.io/",
    "https://google.com.evil.example/out",
    "https://notgithub.com/",
  ])("shows the notice for %s", (referrer) => {
    expect(shouldShowDonationNotice(referrer, true)).toBe(false);
    expect(shouldShowDonationNotice(referrer, false)).toBe(true);
  });

  it("ignores a referrer that is not a url", () => {
    expect(referrerHost("http://")).toBeNull();
    expect(shouldShowDonationNotice("http://", false)).toBe(false);
  });
});

/** In-memory Storage backed by a map. */
function memoryStorage(): Storage {
  // Values written with setItem.
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

/** Storage that throws from every read and write. */
function deniedStorage(): Storage {
  /** Error raised when the browser has blocked local storage. */
  function deny(): never {
    throw new Error("denied");
  }

  return {
    get length() {
      return deny();
    },
    clear() {
      deny();
    },
    getItem() {
      return deny();
    },
    key() {
      return deny();
    },
    removeItem() {
      deny();
    },
    setItem() {
      deny();
    },
  };
}

describe("donation dismissal", () => {
  it("remembers the checkbox and ignores a storage failure", () => {
    // A working store, plus a record of close() calls.
    const storage = memoryStorage();
    const closed: boolean[] = [];

    dismissDonationNotice(false, storage, () => closed.push(true));

    expect(donationDismissed(storage)).toBe(false);

    dismissDonationNotice(true, storage, () => closed.push(true));

    expect(donationDismissed(storage)).toBe(true);
    expect(closed).toEqual([true, true]);

    // Reads and writes that throw count as not dismissed.
    const blocked = deniedStorage();

    expect(donationDismissed(blocked)).toBe(false);
    expect(() => dismissDonationNotice(true, blocked, () => undefined)).not.toThrow();
  });
});
