import { expect, test } from "@playwright/test";

test("an unknown referrer shows the donation notice", async ({ page }) => {
  await page.goto("/", { referer: "https://example.com/launcher" });

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("We do not ask for donations, and we do not support them.");
  await expect(dialog).toContainText("Do not donate to any program that launches NitroViewer");
});

test("a search engine, GitHub, Discord, and a direct visit stay quiet", async ({ page }) => {
  for (const referer of [
    "https://www.google.com/search?q=nitroviewer",
    "https://github.com/turtleisaac/NitroViewer",
    "https://discord.com/channels/1",
  ]) {
    await page.goto("/", { referer });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Don't show this again keeps the notice closed", async ({ page }) => {
  await page.goto("/", { referer: "https://example.com/launcher" });
  await page.getByRole("checkbox", { name: "Don't show this again" }).check();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/", { referer: "https://other.example/wrap" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
