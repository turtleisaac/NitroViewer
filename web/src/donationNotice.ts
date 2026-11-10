export const DONATION_MESSAGE = "We do not ask for donations, and we do not support them.";

export const DONATION_DETAIL =
  "Do not donate to any program that launches NitroViewer or that takes code from NitroViewer. " +
  "Any such program that asks for donations does so against our expressed wishes.";

const DISMISS_KEY = "nitroviewer.donationNoticeDismissed";

// Search pages and places we already publish the project. Anything else is an unknown launcher.
const SEARCH_HOSTS = [
  "bing.com",
  "duckduckgo.com",
  "yahoo.com",
  "yahoo.co.jp",
  "baidu.com",
  "yandex.com",
  "yandex.ru",
  "ecosia.org",
  "brave.com",
  "startpage.com",
  "qwant.com",
  "kagi.com",
  "aol.com",
  "ask.com",
  "naver.com",
  "seznam.cz",
  "sogou.com",
  "swisscows.com",
  "mojeek.com",
];

const KNOWN_HOSTS = [
  "github.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "nitroviewer.com",
];

export function referrerHost(referrer: string): string | null {
  if (!referrer) return null;

  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isGoogleHost(host: string): boolean {
  return /(?:^|\.)google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
}

function listedHost(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

function isAllowedReferrer(host: string): boolean {
  if (isGoogleHost(host)) return true;
  if (listedHost(host, SEARCH_HOSTS)) return true;

  return listedHost(host, KNOWN_HOSTS);
}

export function shouldShowDonationNotice(referrer: string, dismissed: boolean): boolean {
  if (dismissed) return false;
  const host = referrerHost(referrer);
  if (!host) return false;

  return !isAllowedReferrer(host);
}

export function donationDismissed(storage: Storage): boolean {
  try {
    return storage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(storage: Storage) {
  try {
    storage.setItem(DISMISS_KEY, "1");
  } catch {
    // A private window can reject storage. Closing the notice still works.
  }
}

export function dismissDonationNotice(hideForever: boolean, storage: Storage, close: () => void) {
  if (hideForever) rememberDismissal(storage);
  close();
}
