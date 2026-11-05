import { chromium } from "/Users/to/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
const [, , mode = "stills", ...ts] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(new URL("index.html?t=0", import.meta.url).href);
await page.evaluate(() => window.__ready);
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
if (mode === "stills") {
  mkdirSync(new URL("stills/", import.meta.url), { recursive: true });
  for (const t of ts) {
    await page.evaluate((t) => window.render(t), +t);
    await page.screenshot({ path: new URL(`stills/t${t}.png`, import.meta.url).pathname });
  }
} else {
  mkdirSync(new URL("frames/", import.meta.url), { recursive: true });
  for (let i = 0; i < 210; i++) {
    await page.evaluate((t) => window.render(t), i / 30);
    await page.screenshot({ path: new URL(`frames/f${String(i).padStart(4, "0")}.png`, import.meta.url).pathname });
  }
}
console.log("errors:", errs.length ? errs : "none");
await browser.close();
