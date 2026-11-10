// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DonationNotice } from "./DonationNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function mount(props: { referrer?: string; storage?: Storage } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(createElement(DonationNotice, props));
  });
  return host;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("DonationNotice", () => {
  it("shows the notice for an unknown referrer and hides it for a direct visit", () => {
    const shown = mount({ referrer: "https://example.com/launcher" });
    const dialog = shown.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("We do not ask for donations, and we do not support them.");
    expect(dialog?.textContent).toContain("Don't show this again");

    const quiet = mount();
    expect(quiet.querySelector("[role=dialog]")).toBeNull();
  });

  it("stays closed after OK, and the checkbox keeps it closed next time", () => {
    const storage = memoryStorage();
    const host = mount({ referrer: "https://example.com/launcher", storage });
    const button = host.querySelector("button");
    act(() => button?.click());
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(storage.getItem("nitroviewer.donationNoticeDismissed")).toBeNull();

    const again = mount({ referrer: "https://example.com/other", storage });
    const box = again.querySelector("input");
    act(() => box?.click());
    act(() => again.querySelector("button")?.click());
    expect(storage.getItem("nitroviewer.donationNoticeDismissed")).toBe("1");

    const later = mount({ referrer: "https://example.com/later", storage });
    expect(later.querySelector("[role=dialog]")).toBeNull();
  });
});
