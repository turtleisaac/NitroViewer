import { expect, test, type Page } from "@playwright/test";
import { writeTinyRom } from "./tiny-rom.mjs";

const FILES = [
  "wide-phone-sprite.NCGR",
  "wide-phone-texture.NSBTX",
  "wide-phone-model.NSBMD",
];

/** Open the synthetic ROM from the empty-state menu. */
async function openRom(page: Page, romPath: string) {
  await page.goto("/");
  const open = page.getByRole("main").getByRole("button", { name: "Open ROM…" });
  await expect(open).toBeEnabled({ timeout: 180_000 });

  await open.click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /ROM file/ }).click();
  await (await chooser).setFiles(romPath);

  await expect(page.getByRole("button", { name: "Toggle file list" })).toBeVisible({ timeout: 120_000 });
}

/** Open one file from the phone file list and wait until its viewer has real pixels. */
async function openFile(page: Page, name: string) {
  await page.getByRole("button", { name: "Toggle file list" }).click();
  await page.getByPlaceholder("Search").fill(name);
  await page.getByRole("button", { name }).click();

  if (name.endsWith("NCGR")) {
    await expect(page.locator(".sprite-img")).toBeVisible({ timeout: 60_000 });
  } else if (name.endsWith("NSBTX")) {
    await expect(page.locator(".texcard img")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.locator(".viewport canvas")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Capture PNG" })).toBeVisible();
    await expect(page.locator(".error")).toHaveCount(0);
  }
}

test.describe("phone width", () => {
  let romPath: string;

  test.beforeAll(async () => {
    romPath = await writeTinyRom();
  });

  for (const width of [390, 360, 320]) {
    test(`sprite, texture, and model fit ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openRom(page, romPath);

      for (const name of FILES) {
        await openFile(page, name);

        await expect(page.getByRole("button", { name: "Import…", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();

        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(fits).toBe(true);
      }
    });
  }
});
