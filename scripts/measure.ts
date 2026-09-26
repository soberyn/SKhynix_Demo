// Honest measurement: run the same input N times with LLM-only and with LLM + rules, and count the outcomes.
//
// Usage (the dev server must be running with a live LLM in .env.local):
//   npm run dev -- -p 3100
//   npm run measure -- --scenario equipment --case mission:policy --runs 10
//   npm run measure -- --scenario tax --case example --runs 10
//
// Results are appended to docs/measurements.md exactly as measured, including results unfavourable to LLM + rules.
// Mind the provider's free-tier quota: each run costs up to 2 LLM calls.

import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { runGraph } from "../src/core/engine";
import type { LLMProvider, LLMResponse } from "../src/core/resolvers";
import { getScenario } from "../src/scenario";
import { toInput, type Draft } from "../src/scenario/types";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const scenario = getScenario(arg("--scenario", "equipment"));
if (!scenario) throw new Error("Unknown --scenario");
const caseId = arg("--case", "example")!;
const RUNS = Number(arg("--runs", "10"));
const PAUSE_MS = Number(arg("--pause", "4000")); // stay under per-minute free-tier limits

const mission = scenario.missions.find((m) => caseId === `mission:${m.id}`);
if (caseId !== "example" && !mission) throw new Error(`Unknown --case ${caseId}`);
if (mission && Object.keys(mission.apply(scenario.exampleDraft).overrides ?? {}).length)
  throw new Error("Missions with a human override are not measured (the override is not part of the input).");
const draft: Draft = mission ? mission.apply(scenario.exampleDraft).draft : scenario.exampleDraft;
const input = toInput(scenario, draft);

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  if (data.source !== "live") throw new Error(`Expected a live answer, got "${data.source}" (quota or rate limit?)`);
  return data;
}

const liveLLM: LLMProvider = {
  async evaluate(req): Promise<LLMResponse> {
    return post("/api/judge", { scenario: scenario!.id, nodeId: req.nodeId, evidence: req.evidence });
  },
};

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));
const tally = (xs: string[]) => {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join("; ");
};

async function main() {
  const started = new Date().toISOString();
  const structured: string[] = [];
  const llmOnly: string[] = [];
  const llmReasons: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runGraph(scenario!.buildGraph(draft.settings), input, { functions: scenario!.functions, llm: liveLLM });
    structured.push(r.decisionStatus === "SUCCEEDED" ? String(r.decision) : `판단 불가 (${r.trace.find((t) => t.error)?.error})`);
    await pause();
    try {
      const d = await post("/api/llm-only", { scenario: scenario!.id, input, settings: draft.settings });
      llmOnly.push(String(d.raw?.action ?? "INVALID"));
      llmReasons.push(String(d.raw?.reason ?? ""));
    } catch (err) {
      llmOnly.push(`오류: ${(err as Error).message}`);
    }
    await pause();
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const file = new URL("../docs/measurements.md", import.meta.url);
  if (!existsSync(file)) writeFileSync(file, "# Measurements\n\nEach block is one measurement, recorded exactly as observed.\n");
  const block = [
    "",
    `## ${scenario!.name} — ${caseId}`,
    "",
    `- Measured: ${started} · runs: ${RUNS} · model: ${process.env.LLM_MODEL ?? "(server setting)"} · provider default sampling`,
    `- LLM + 규칙: ${tally(structured)}`,
    `- LLM 단독: ${tally(llmOnly)}`,
    "",
    "<details><summary>LLM 단독 설명 (전체)</summary>",
    "",
    ...llmReasons.map((r, i) => `${i + 1}. ${r}`),
    "",
    "</details>",
    "",
  ].join("\n");
  appendFileSync(file, block);
  console.log(block);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
