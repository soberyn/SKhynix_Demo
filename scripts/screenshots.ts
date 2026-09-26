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

/** Both approaches finished: no "판단 중…" left and the structured decision is shown. */
async function settle(page: Page) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("판단 중…") && !!document.querySelector("[class*=decisionValue]"),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

async function main() {
  if (!CHROME) throw new Error("Set CHROME_PATH to a Chromium/Chrome executable.");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });

  // 1. Overview: input · comparison · "LLM + 규칙" tab
  await page.goto(`${BASE}/?run=example`);
  await settle(page);
  await page.screenshot({ path: `${OUT}1-overview.png` });

  // 2. "LLM + 규칙" tab body (DAG, policy table, decision, trace)
  await page.locator('section[aria-label="LLM + 규칙"]').screenshot({ path: `${OUT}2-llm-rules-tab.png` });

  // 3. "LLM 단독" tab body
  await tab(page, "LLM 단독").click();
  await page.waitForTimeout(300);
  await page.locator('section[aria-label="LLM 단독"]').screenshot({ path: `${OUT}3-llm-only-tab.png` });

  // 4. Failure example: FAILED node, BLOCKED decision
  await page.goto(`${BASE}/?run=failure`);
  await page.waitForFunction(
    () => document.querySelectorAll("[class*=st_SUCCEEDED]").length >= 2 && document.body.innerText.includes("판단 불가"),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}4-failure-propagation.png` });

  // 5. Structural comparison table
  await page.goto(`${BASE}/?run=example`);
  await settle(page);
  await page.locator("section", { hasText: "두 방식의 구조 비교" }).screenshot({ path: `${OUT}5-comparison-table.png` });

  // 6–9. Missions: baseline → change → [다시 판단] → both approaches compared
  for (const [i, id] of ["pressure", "override", "policy", "note"].entries()) {
    await page.goto(`${BASE}/?run=mission-${id}`);
    const rerun = page.getByRole("button", { name: /다시 판단 \(변경/ });
    await rerun.waitFor({ timeout: 60_000 });
    await rerun.click();
    await page.waitForSelector("[class*=changeCard]", { timeout: 60_000 });
    await settle(page);
    await page.screenshot({ path: `${OUT}${6 + i}-mission-${id}.png` });
  }

  await browser.close();
  console.log(`Saved screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
