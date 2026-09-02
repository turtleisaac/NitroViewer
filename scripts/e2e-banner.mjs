// Headless E2E for the icon/title banner viewer: boots the SPA in real Chrome via CheerpJ, opens
// HeartGold, selects the pinned "Game icon & titles" entry, screenshots it, then edits a title +
// icon through the store and verifies via getBanner + a save→reopen round-trip.
// Requires playwright-core + a system Chrome; both paths are env-overridable.
//   NV_PLAYWRIGHT=/path/to/node_modules/playwright-core  NV_CHROME=/path/to/Chrome  node scripts/e2e-banner.mjs
const pw = await import(`${process.env.NV_PLAYWRIGHT || "playwright-core"}/index.js`);
const { chromium } = pw.default ?? pw;

const URL = process.env.NV_URL || "http://localhost:8092/";
const ROM = process.env.NV_ROM || "HeartGold.nds";
const OUT = process.env.NV_OUT || "nv_banner.png";
const CHROME = process.env.NV_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => console.log("[page]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // Wait for CheerpJ boot (store.booted).
  await page.waitForFunction(() => window.__store?.getState().booted === true, { timeout: 120000 });
  console.log("booted");

  // Open the ROM via the hidden file input (streams the file — a 128MB base64 through evaluate OOMs).
  await page.setInputFiles('input[type="file"][accept=".nds"]', ROM);
  await page.waitForFunction(() => window.__store?.getState().romHandle != null, { timeout: 180000 });
  console.log("rom open");

  // Click the pinned banner row.
  await page.click("text=Game icon & titles");
  await page.waitForSelector("img.banner-icon", { timeout: 60000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("img.banner-icon");
    return img && img.complete && img.naturalWidth > 0;
  });
  console.log("banner viewer shown");

  // Read the banner + the current English title.
  const before = await page.evaluate(async () => {
    const s = window.__store.getState();
    const b = await s.client.getBanner(s.romHandle);
    return { present: b.present, version: b.version, langs: b.titles.map((t) => t.language), english: b.titles[1]?.text };
  });
  console.log("banner:", JSON.stringify(before));

  await page.screenshot({ path: OUT });
  console.log("screenshot ->", OUT);

  // Edit English (ordinal 1) title through the store action, then verify + save→reopen.
  const verify = await page.evaluate(async () => {
    const s = window.__store.getState();
    await s.setBannerTitle(1, "NITROVIEWER\nBANNER E2E");
    const afterEdit = (await s.client.getBanner(s.romHandle)).titles[1].text;

    // Build a valid 32×32 icon (few colors + transparency) via a canvas → PNG bytes, import it.
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext("2d");
    const pal = ["#e53935", "#43a047", "#1e88e5", "#fdd835"];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if ((x + y) % 5 === 0) continue; // leave transparent
      ctx.fillStyle = pal[((x >> 3) + (y >> 3)) % pal.length];
      ctx.fillRect(x, y, 1, 1);
    }
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    const iconBytes = new Uint8Array(await blob.arrayBuffer());
    await s.setBannerIcon(iconBytes);

    // Round-trip: save the ROM, reopen it in a fresh handle, read the title back.
    const saved = await s.client.saveRom(s.romHandle);
    const { handle } = await s.client.openRom(saved);
    const reopened = (await s.client.getBanner(handle)).titles[1].text;
    return { afterEdit, reopened, dirty: window.__store.getState().dirty };
  });
  console.log("verify:", JSON.stringify(verify));

  // Re-screenshot after edits (new icon + title should be visible).
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT.replace(/\.png$/, "_edited.png") });
  console.log("edited screenshot ->", OUT.replace(/\.png$/, "_edited.png"));

  const ok =
    before.present &&
    verify.afterEdit === "NITROVIEWER\nBANNER E2E" &&
    verify.reopened === "NITROVIEWER\nBANNER E2E";
  console.log(ok ? "E2E PASS" : "E2E FAIL");
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
