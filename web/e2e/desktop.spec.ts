import { expect, test, type Page } from "@playwright/test";
import { writeTinyRom } from "./tiny-rom.mjs";

/** Open the synthetic ROM from the empty-state menu. */
async function openRom(page: Page, romPath: string) {
  await page.goto("/");
  const open = page.getByRole("main").getByRole("button", { name: "Open ROM…" });
  await expect(open).toBeEnabled({ timeout: 180_000 });

  await open.click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /ROM file/ }).click();
  await (await chooser).setFiles(romPath);

  await expect(page.getByPlaceholder("Search")).toBeVisible({ timeout: 120_000 });
}

/** Open one file from the filesystem search. */
async function openFile(page: Page, name: string) {
  await page.getByPlaceholder("Search").fill(name);
  await page.getByRole("button", { name }).click();
}

/** The header buttons stay in the top right and the page does not grow sideways. */
async function inspectorFits(page: Page) {
  const head = page.locator(".inspector-head");
  const importing = head.getByRole("button", { name: "Import…", exact: true });
  const exporting = head.getByRole("button", { name: "Export", exact: true });
  await expect(importing).toBeVisible();
  await expect(exporting).toBeVisible();

  const imported = await importing.boundingBox();
  const exported = await exporting.boundingBox();
  const inspector = await page.locator(".inspector").boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);

  expect(imported).not.toBeNull();
  expect(exported).not.toBeNull();
  expect(inspector).not.toBeNull();
  expect(scroll).toBeLessThanOrEqual(width);
  expect(imported!.x).toBeGreaterThanOrEqual(0);
  expect(exported!.x + exported!.width).toBeLessThanOrEqual(width);
  expect(exported!.x).toBeGreaterThan(width / 2);
  expect(inspector!.x + inspector!.width).toBeLessThanOrEqual(width);
}

test.describe("desktop width", () => {
  let romPath: string;

  test.beforeAll(async () => {
    romPath = await writeTinyRom();
  });

  test("a sound view and a model view stay inside a 1280px window", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRom(page, romPath);

    await openFile(page, "wide-desktop-sound.SDAT");
    const sequence = page.getByRole("button", { name: "SEQ_SE_SW_CHAMPIRIS_01" });
    await expect(sequence).toBeVisible({ timeout: 60_000 });
    await sequence.click();
    await expect(page.locator(".note-roll canvas")).toBeVisible({ timeout: 60_000 });
    await inspectorFits(page);

    await openFile(page, "wide-phone-model.NSBMD");
    await expect(page.locator(".viewport canvas")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Capture PNG" })).toBeVisible();
    await inspectorFits(page);
  });
});
