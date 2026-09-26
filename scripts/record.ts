// Records real model answers so the deployed demo can show them when no live LLM is available
// (no key, provider quota reached, rate limit, or an outage). Shown as "기록된 실제 LLM 응답" with model and date.
//
// Usage (the dev server must be running with LLM_* set in .env.local):
//   npm run dev -- -p 3100
//   npm run record                        # all scenarios; records only what is missing; saves after every item
//   npm run record -- --scenario tax      # one scenario
//   npm run record -- --fresh             # discard existing recordings of the selected scenarios first
//
// Only answers whose source is "live" are saved.

import { readFileSync, writeFileSync } from "node:fs";
import { SCENARIOS } from "../src/scenario";
import { llmOnlyKey, toInput, type Scenario } from "../src/scenario/types";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const FILE = new URL("../src/scenario/recorded.json", import.meta.url);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const selected = SCENARIOS.filter((s) => !arg("--scenario") || s.id === arg("--scenario"));

type Rec = { raw: unknown; model: string; recordedAt: string };
const store: { judge: (Rec & { scenario: string; note: string })[]; llmOnly: (Rec & { key: string; name: string })[] } = JSON.parse(
  readFileSync(FILE, "utf8"),
);
if (process.argv.includes("--fresh")) {
  const ids = new Set(selected.map((s) => s.id));
  store.judge = store.judge.filter((r) => !ids.has(r.scenario));
  store.llmOnly = store.llmOnly.filter((r) => !ids.has(JSON.parse(r.key).s));
}
const save = () => writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");

/** Retries brief overloads; stops at once when no live answer can be had (e.g. quota). */
async function post(path: string, body: unknown) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok && data.source === "live") return data as { raw: unknown; model: string };
    if (attempt >= 3 || res.status === 429)
      throw new Error(`${path}: no live answer (${data.error ?? `source "${data.source}"`}). Likely quota or rate limit — see the server log.`);
    console.log(`  no live answer, retrying in ${attempt * 10}s`);
    await new Promise((r) => setTimeout(r, attempt * 10_000));
  }
}

/** LLM-only inputs worth having on record: the example and each mission's changed input (deduplicated). */
function llmOnlyCases(sc: Scenario) {
  const cases = [
    { name: "example", draft: sc.exampleDraft },
    ...sc.missions.map((m) => ({ name: `mission: ${m.id}`, draft: m.apply(sc.exampleDraft).draft })),
    ...sc.cases.map((c) => ({ name: `problem: ${c.id}`, draft: c.apply(sc.exampleDraft) })),
  ];
  const seen = new Set<string>();
  return cases
    .map((c) => ({ ...c, input: toInput(sc, c.draft), settings: c.draft.settings }))
    .map((c) => ({ ...c, key: llmOnlyKey(sc, c.input, c.settings) }))
    .filter((c) => !seen.has(c.key) && seen.add(c.key));
}

async function main() {
  for (const sc of selected) {
    const graph = sc.buildGraph(sc.defaultSettings);
    for (const node of graph.nodes) {
      if (node.resolver_type !== "LLM") continue;
      const field = sc.fields.find((f) => `input.${f.key}` === node.resolver_config.evidence[0]);
      if (!field || field.kind !== "note") continue;
      for (const p of field.presets) {
        if (store.judge.some((r) => r.scenario === sc.id && r.note === p.text)) continue;
        const data = await post("/api/judge", { scenario: sc.id, nodeId: node.id, evidence: { [`input.${field.key}`]: p.text } });
        store.judge.push({ scenario: sc.id, note: p.text, raw: data.raw, model: data.model, recordedAt: new Date().toISOString() });
        save();
        console.log(`[${sc.id}] judge   · ${p.label}: saved`);
      }
    }
    for (const c of llmOnlyCases(sc)) {
      if (store.llmOnly.some((r) => r.key === c.key)) continue;
      const data = await post("/api/llm-only", { scenario: sc.id, input: c.input, settings: c.settings });
      store.llmOnly.push({ key: c.key, name: `${sc.id} ${c.name}`, raw: data.raw, model: data.model, recordedAt: new Date().toISOString() });
      save();
      console.log(`[${sc.id}] llmOnly · ${c.name}: saved`);
    }
  }
  console.log(`\nDone. Stored: ${store.judge.length} judgments, ${store.llmOnly.length} LLM-only answers.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  console.error(`Saved so far: ${store.judge.length} judgments, ${store.llmOnly.length} LLM-only answers. Run again later to record the rest.`);
  process.exit(1);
});
