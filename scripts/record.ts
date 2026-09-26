// Records real model answers so the deployed demo can show them when no live LLM is available
// (no key, provider limit reached, or an outage). Recorded answers are labelled "기록된 실제 AI 응답" with model and date.
//
// Usage (the dev server must be running with LLM_* set in .env.local):
//   npm run dev -- -p 3100
//   npm run record
//
// Only answers whose source is "live" are saved. Nothing is written if the server has no live LLM.

import { writeFileSync } from "node:fs";
import { DEFAULT_SETTINGS, EXAMPLE_INPUT, NOTE_PRESETS, type EquipmentInput, type PolicySettings } from "../src/scenario/equipment";
import { llmOnlyKey } from "../src/scenario/recorded";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  if (data.source !== "live") throw new Error(`${path}: expected a live answer, got "${data.source}". Set LLM_* in .env.local and restart the server.`);
  return data as { raw: unknown; model: string };
}

// LLM Only inputs worth having on record: the example and each mission's changed input.
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
  const recordedAt = new Date().toISOString();
  const judge = [];
  for (const p of NOTE_PRESETS) {
    const data = await post("/api/judge", { nodeId: "sensor_fault_evidence", evidence: { "input.maintenance_note": p.text } });
    judge.push({ note: p.text, raw: data.raw, model: data.model, recordedAt });
    console.log(`judge   · ${p.label}:`, JSON.stringify(data.raw).slice(0, 120));
  }

  const llmOnly = [];
  for (const c of LLM_ONLY_CASES) {
    const data = await post("/api/llm-only", { input: c.input, settings: c.settings });
    llmOnly.push({ key: llmOnlyKey(c.input, c.settings), name: c.name, raw: data.raw, model: data.model, recordedAt });
    console.log(`llmOnly · ${c.name}:`, JSON.stringify(data.raw).slice(0, 120));
  }

  writeFileSync(new URL("../src/scenario/recorded.json", import.meta.url), JSON.stringify({ judge, llmOnly }, null, 2) + "\n");
  console.log(`\nSaved ${judge.length} judgments and ${llmOnly.length} LLM-only answers (recorded ${recordedAt}).`);
  console.log("Review src/scenario/recorded.json before deploying — the answers are shown as recorded real AI responses.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
