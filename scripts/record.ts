// Records real model answers so the deployed demo can show them when no live LLM is available
// (no key, provider quota reached, or an outage). Recorded answers are labelled "기록된 실제 AI 응답" with model and date.
//
// Usage (the dev server must be running with LLM_* set in .env.local):
//   npm run dev -- -p 3100
//   npm run record              # records only what is missing; saves after every item
//   npm run record -- --fresh   # discards existing recordings first
//
// Only answers whose source is "live" are saved.

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_SETTINGS, EXAMPLE_INPUT, NOTE_PRESETS, type EquipmentInput, type PolicySettings } from "../src/scenario/equipment";
import { llmOnlyKey } from "../src/scenario/recorded";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const FILE = new URL("../src/scenario/recorded.json", import.meta.url);

type Rec = { raw: unknown; model: string; recordedAt: string };
const store: { judge: (Rec & { note: string })[]; llmOnly: (Rec & { key: string; name: string })[] } = process.argv.includes("--fresh")
  ? { judge: [], llmOnly: [] }
  : JSON.parse(readFileSync(FILE, "utf8"));
const save = () => writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");

class QuotaError extends Error {}

/** Retries brief overloads; stops at once on a quota error. */
async function post(path: string, body: unknown) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok && data.source === "live") return data as { raw: unknown; model: string };
    if (res.ok) {
      // The server fell back (recorded/prepared) because the live call failed; we cannot tell quota from overload here,
      // so check the server log. Try a couple of times in case it was an overload.
      if (attempt >= 3) throw new QuotaError(`${path}: no live answer after ${attempt} tries (server fell back to "${data.source}"). Likely quota exhausted — see server log.`);
    } else if (res.status === 429 || attempt >= 3) {
      throw new QuotaError(`${path}: ${data.error ?? res.status}`);
    }
    console.log(`  no live answer, retrying in ${attempt * 10}s`);
    await new Promise((r) => setTimeout(r, attempt * 10_000));
  }
}

const LLM_ONLY_CASES: { name: string; input: EquipmentInput; settings: PolicySettings }[] = [
  { name: "example", input: EXAMPLE_INPUT, settings: DEFAULT_SETTINGS },
  { name: "pressure 9.5", input: { ...EXAMPLE_INPUT, pressure: "9.5" }, settings: DEFAULT_SETTINGS },
  { name: "threshold 5", input: EXAMPLE_INPUT, settings: { ...DEFAULT_SETTINGS, threshold: 5 } },
  ...NOTE_PRESETS.slice(1).map((p) => ({
    name: `note: ${p.label}`,
    input: { ...EXAMPLE_INPUT, maintenance_note: p.text },
    settings: DEFAULT_SETTINGS,
  })),
];

async function main() {
  for (const p of NOTE_PRESETS) {
    if (store.judge.some((r) => r.note === p.text)) continue;
    const data = await post("/api/judge", { nodeId: "sensor_fault_evidence", evidence: { "input.maintenance_note": p.text } });
    store.judge.push({ note: p.text, raw: data.raw, model: data.model, recordedAt: new Date().toISOString() });
    save();
    console.log(`judge   · ${p.label}: saved`);
  }
  for (const c of LLM_ONLY_CASES) {
    const key = llmOnlyKey(c.input, c.settings);
    if (store.llmOnly.some((r) => r.key === key)) continue;
    const data = await post("/api/llm-only", { input: c.input, settings: c.settings });
    store.llmOnly.push({ key, name: c.name, raw: data.raw, model: data.model, recordedAt: new Date().toISOString() });
    save();
    console.log(`llmOnly · ${c.name}: saved`);
  }
  console.log(`\nDone: ${store.judge.length}/${NOTE_PRESETS.length} judgments, ${store.llmOnly.length}/${LLM_ONLY_CASES.length} LLM-only answers.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  console.error(`Saved so far: ${store.judge.length} judgments, ${store.llmOnly.length} LLM-only answers. Run again later to record the rest.`);
  process.exit(1);
});
