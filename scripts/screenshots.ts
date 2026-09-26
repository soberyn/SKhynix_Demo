// Captures the portfolio screenshots into docs/screenshots/.
//
// Usage (server must be running):
//   npm run dev -- -p 3100
//   CHROME_PATH=/path/to/chrome npm run screenshots
//
// Uses playwright-core with an existing Chromium binary; nothing is downloaded.
// Tip: run without a live LLM (or after the rate limit is reached) so recorded answers make the captures reproducible.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
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

async function mission(page: Page, scenario: string, id: string, file: string) {
  await page.goto(`${BASE}/?s=${scenario}&run=mission-${id}`);
  const rerun = page.getByRole("button", { name: /다시 판단 \(변경/ });
  await rerun.waitFor({ timeout: 60_000 });
  await rerun.click();
  await page.waitForSelector("[class*=changeCard]", { timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: `${OUT}${file}` });
}

async function main() {
  if (!CHROME) throw new Error("Set CHROME_PATH to a Chromium/Chrome executable.");
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(`${OUT}${f}`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });

  // Scenario 1 — tax (the original problem)
  await page.goto(`${BASE}/?s=tax&run=example`);
  await settle(page);
  await page.screenshot({ path: `${OUT}01-tax-overview.png` });

  // A problem where LLM-only fails: comparison bar with the step table
  await page.goto(`${BASE}/?s=tax&run=problem-p1`);
  await settle(page);
  await page.locator("[class*=rightArea] > [class*=compareWrap]").screenshot({ path: `${OUT}02-tax-problem1-steps.png` });
  await page.screenshot({ path: `${OUT}03-tax-problem1-full.png` });
  await page.locator('section[aria-label="LLM + 규칙"]').screenshot({ path: `${OUT}04-tax-llm-rules-tab.png` });
  await tab(page, "LLM 단독").click();
  await page.waitForTimeout(300);
  await page.locator('section[aria-label="LLM 단독"]').screenshot({ path: `${OUT}05-tax-llm-only-tab.png` });

  // Accuracy over repeated runs
  await page.locator("section[aria-labelledby=bench-h]").screenshot({ path: `${OUT}06-tax-benchmark.png` });

  await mission(page, "tax", "transfer-date", "07-tax-mission-transfer-date.png");
  await mission(page, "tax", "override", "08-tax-mission-override.png");

  // Failure example (tax)
  await page.goto(`${BASE}/?s=tax&run=failure`);
  await page.waitForFunction(() => document.body.innerText.includes("판단 불가") && !!document.querySelector("[class*=st_BLOCKED]"), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}09-tax-failure-propagation.png` });

  // Scenario 2 — equipment (another domain)
  await page.goto(`${BASE}/?s=equipment&run=problem-p2`);
  await settle(page);
  await page.screenshot({ path: `${OUT}10-equipment-problem2.png` });
  await page.locator("section[aria-labelledby=bench-h]").screenshot({ path: `${OUT}11-equipment-benchmark.png` });

  // Structural comparison table
  await page.locator("section", { hasText: "두 방식의 구조 비교" }).screenshot({ path: `${OUT}12-comparison-table.png` });

  await browser.close();
  console.log(`Saved screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
