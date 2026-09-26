// Captures the portfolio screenshots into docs/screenshots/.
//
// Usage (server must be running):
//   npm run dev -- -p 3100
//   CHROME_PATH=/path/to/chrome npm run screenshots
//
// Uses playwright-core with an existing Chromium binary; nothing is downloaded.

import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH;

async function settle(page: Page) {
  // Wait until the run finished (the decision card shows a result).
  await page.waitForSelector("[class*=decisionValue]", { timeout: 20_000 });
  await page.waitForTimeout(400);
}

async function main() {
  if (!CHROME) throw new Error("Set CHROME_PATH to a Chromium/Chrome executable.");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1180 }, deviceScaleFactor: 2 });

  // 1. Overview: Input → Judgment DAG → Decision
  await page.goto(`${BASE}/?run=example`);
  await settle(page);
  await page.screenshot({ path: `${OUT}1-overview.png` });

  // 2. Judgment DAG + policy table (center panel)
  await page.locator("section").nth(1).screenshot({ path: `${OUT}2-dag-and-policy.png` });

  // 3. Node-level decision trace (right panel)
  await page.locator("section").nth(2).screenshot({ path: `${OUT}3-trace.png` });

  // 4. Failure example: FAILED node, BLOCKED decision
  await page.goto(`${BASE}/?run=failure`);
  await page.waitForFunction(() => document.body.innerText.includes("판단 불가"), null, { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll("[class*=st_SUCCEEDED]").length >= 2, null, { timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}4-failure-propagation.png` });

  // 5. Architecture comparison
  await page.goto(`${BASE}/?run=example`);
  await settle(page);
  const cmp = page.locator("section", { hasText: "두 방식의 구조 비교" });
  await cmp.screenshot({ path: `${OUT}5-comparison.png` });

  // 6–9. Missions: baseline → change → [다시 판단] → what changed, what was reused
  for (const [i, id] of ["pressure", "override", "policy", "note"].entries()) {
    await page.goto(`${BASE}/?run=mission-${id}`);
    const rerun = page.getByRole("button", { name: /다시 판단 \(변경/ });
    await rerun.waitFor({ timeout: 20_000 });
    await rerun.click();
    await page.waitForSelector("[class*=changeCard]", { timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${6 + i}-mission-${id}.png` });
  }

  await browser.close();
  console.log(`Saved screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
