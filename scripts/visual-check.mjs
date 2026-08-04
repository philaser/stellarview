#!/usr/bin/env node
// Visual verification harness for the satellite tracker.
// Usage: node scripts/visual-check.mjs [baseUrl] [outDir]
// Produces a JSON report + screenshots; captures console errors verbatim.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";
const OUT_DIR = process.argv[3] ?? "/tmp/ft-visual";
mkdirSync(OUT_DIR, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(OUT_DIR, `${name}.png`) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  }
});
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("requestfailed", (req) => {
  const f = req.failure();
  if (f) failedRequests.push(`${req.url()} :: ${f.errorText}`);
});

const report = { baseUrl: BASE_URL, steps: [], consoleMessages, pageErrors, failedRequests };

const step = (name, pass, note) => report.steps.push({ name, pass, note });

await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(15000); // catalog + TLE load

// 1. World view
await shot(page, "01-world");
const banner = await page
  .locator(".banner")
  .first()
  .textContent()
  .catch(() => "");
step("world view", true, `banner: ${banner?.trim()}`);

// Helper: screen coords of a satellite dot in the CENTER region of the viewport
// (avoids overlays like the controls panel / banners), via the exposed map handle
const firstDot = () =>
  page.evaluate(() => {
    const map = window.__ftMap;
    if (!map) return { error: "no __ftMap handle" };
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const features = map.queryRenderedFeatures({ layers: ["satellites-layer"] });
    if (features.length === 0) return { error: "no satellite features rendered" };
    for (const f of features) {
      const p = map.project(f.geometry.coordinates);
      if (p.x > w * 0.3 && p.x < w * 0.7 && p.y > h * 0.2 && p.y < h * 0.7) {
        return { x: p.x, y: p.y, catnr: f.properties?.catnr ?? null, rendered: features.length };
      }
    }
    return { error: "no satellite in center region", rendered: features.length };
  });

const dot = await firstDot();
step("satellite features rendered", !dot.error, dot.error ? String(dot.error) : `found catnr ${dot.catnr}, rendered=${dot.rendered}`);

if (!dot.error) {
  // 2. Zoom to z6 (current center)
  await page.evaluate(() => {
    const map = window.__ftMap;
    map.easeTo({ zoom: 6, duration: 800 });
  });
  await page.waitForTimeout(2500);
  await shot(page, "02-zoomed");

  // 3. Hover the dot
  const dot2 = await firstDot();
  if (dot2 && !dot2.error) {
    await page.mouse.move(dot2.x, dot2.y);
    await page.waitForTimeout(700);
    await shot(page, "03-hover");
    const cursor = await page.evaluate(() => window.__ftMap?.getCanvas().style.cursor ?? "no-map");
    step("hover reveals", cursor === "pointer", `canvas cursor: ${cursor}`);
  } else {
    step("hover reveals", false, "no dot at z6 to hover");
  }

  // 4. Click select + trajectory, two frames for dash animation
  const dot3 = await firstDot();
  if (dot3 && !dot3.error) {
    await page.mouse.click(dot3.x, dot3.y);
    await page.waitForTimeout(1500);
    await shot(page, "04-selected");
    await page.waitForTimeout(1000);
    await shot(page, "05-selected-t1");
    const hasPanel = await page.locator(".panel").count();
    step("select opens panel", hasPanel > 0, `panels: ${hasPanel}`);
  } else {
    step("select opens panel", false, "no dot to select");
  }
} else {
  step("zoom + hover + select", false, "skipped: no rendered satellites");
}

// 5. Day/night toggle + search sanity (panel is open by default — do this BEFORE the gear test)
const dn = page.locator('input[aria-label="Day/Night"]');
if ((await dn.count()) > 0 && (await dn.isChecked())) {
  await dn.click();
  await page.waitForTimeout(400);
  await shot(page, "06-daynight-off");
  await dn.click();
  await page.waitForTimeout(400);
  await shot(page, "07-daynight-on");
  step("day/night toggle", true, "toggled off and on");
} else {
  step("day/night toggle", false, "checkbox not found or not checked");
}

await page.locator('input[placeholder="Search satellites…"]').fill("ISS");
await page.waitForTimeout(700);
await shot(page, "08-search");
const results = await page.locator(".results-list .result-row").count();
step("search results list", results > 0, `results: ${results}`);
// clear the search so it doesn't affect later steps
await page.locator('input[placeholder="Search satellites…"]').fill("");
await page.waitForTimeout(500);

// 6. Gear collapse / expand
const gear = page.locator(".gear-button");
if ((await gear.count()) > 0) {
  await gear.click();
  await page.waitForTimeout(500);
  await shot(page, "09-gear-collapsed");
  const closed = await page.evaluate(() => document.querySelector(".controls")?.classList.contains("closed"));
  step("gear collapse", closed === true, `controls closed: ${closed}`);
  await gear.click();
  await page.waitForTimeout(500);
  await shot(page, "10-gear-expanded");
  const open = await page.evaluate(() => document.querySelector(".controls")?.classList.contains("open"));
  step("gear expand", open === true, `controls open: ${open}`);
} else {
  step("gear collapse/expand", false, "gear button not found");
}

await browser.close();

writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
