// Screenshot the banner viewer at phone widths (before/after layout tweaks).
const pw = await import(`${process.env.NV_PLAYWRIGHT || "playwright-core"}/index.js`);
const { chromium } = pw.default ?? pw;

const URL = process.env.NV_URL || "http://localhost:8093/";
const ROM = process.env.NV_ROM || "/Users/danny/Documents/Apps/PokEditor-Stack/HeartGold.nds";
const OUT = process.env.NV_OUT || "/tmp/nv_banner_mobile.png";
const WIDTH = Number(process.env.NV_WIDTH || 375);
const HEIGHT = Number(process.env.NV_HEIGHT || 700);
const CHROME = process.env.NV_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__store?.getState().booted === true, { timeout: 120000 });
  await page.setInputFiles('input[type="file"][accept=".nds"]', ROM);
  await page.waitForFunction(() => window.__store?.getState().romHandle != null, { timeout: 180000 });

  // Open the nav drawer (mobile hides the tree), select the banner row, close the drawer.
  const navToggle = await page.$(".nav-toggle");
  if (navToggle) await navToggle.click();
  await page.click("text=Game icon & titles");
  await page.waitForSelector("img.banner-icon", { timeout: 60000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("img.banner-icon");
    return img && img.complete && img.naturalWidth > 0;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("screenshot ->", OUT);
} finally {
  await browser.close();
}
