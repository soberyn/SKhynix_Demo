// Honest measurement of Structured Judgment vs LLM Only (implementation_prompt §9-1).
//
// Usage (needs a running server with a live LLM configured in .env.local):
//   npm run dev -- -p 3100        # in another terminal
//   npm run measure -- --runs 10  # writes docs/measurements.md
//
// Results are written as measured, including results unfavourable to the structured mode.

import { writeFileSync } from "node:fs";
import { runGraph } from "../src/core/engine";
import type { LLMProvider, LLMResponse } from "../src/core/resolvers";
import { EQUIPMENT_CODE, EQUIPMENT_GRAPH, EXAMPLE_INPUT, type EquipmentInput } from "../src/scenario/equipment";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 10;

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const liveLLM: LLMProvider = {
  async evaluate(req): Promise<LLMResponse> {
    const data = await post("/api/judge", { nodeId: req.nodeId, evidence: req.evidence });
    if (data.source !== "live") throw new Error(`Expected a live LLM answer, got "${data.source}". Configure LLM_* in .env.local.`);
    return data;
  },
};

async function structured(input: EquipmentInput): Promise<string> {
  const r = await runGraph(EQUIPMENT_GRAPH, input, { code: EQUIPMENT_CODE, llm: liveLLM });
  return r.decisionStatus === "SUCCEEDED" ? String(r.decision) : `NO DECISION (${r.trace.find((t) => t.error)?.error})`;
}

async function llmOnly(input: EquipmentInput): Promise<string> {
  try {
    const data = await post("/api/llm-only", { input });
    return typeof data.raw?.action === "string" ? data.raw.action : `INVALID OUTPUT: ${JSON.stringify(data.raw).slice(0, 80)}`;
  } catch (err) {
    return `ERROR: ${(err as Error).message}`;
  }
}

const tally = (xs: string[]) => {
  const counts = new Map<string, number>();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const fmt = (xs: string[]) => tally(xs).map(([k, n]) => `${k} ×${n}`).join("<br>");
const modeShare = (xs: string[]) => `${tally(xs)[0][1]}/${xs.length}`;

const twoAlarms = EXAMPLE_INPUT.alarm_history.split("\n").filter((l) => !/14:08|17:21/.test(l)).join("\n");
const threeAlarms = EXAMPLE_INPUT.alarm_history.split("\n").filter((l) => !/17:21/.test(l)).join("\n");

const CASES: { name: string; input: EquipmentInput }[] = [
  { name: "Example input", input: EXAMPLE_INPUT },
  { name: "pressure 9.99 (below limit)", input: { ...EXAMPLE_INPUT, pressure: "9.99" } },
  { name: "pressure 10.0 (= limit, not above)", input: { ...EXAMPLE_INPUT, pressure: "10.0" } },
  { name: "pressure 10.01 (just above)", input: { ...EXAMPLE_INPUT, pressure: "10.01" } },
  { name: "2 warnings in 24h (below threshold)", input: { ...EXAMPLE_INPUT, alarm_history: twoAlarms } },
  { name: "3 warnings in 24h (= threshold)", input: { ...EXAMPLE_INPUT, alarm_history: threeAlarms } },
];

async function main() {
  const started = new Date().toISOString();
  const lines: string[] = [];
  for (const c of CASES) {
    const s: string[] = [];
    const l: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      s.push(await structured(c.input));
      l.push(await llmOnly(c.input));
      process.stdout.write(".");
    }
    lines.push(`| ${c.name} | ${fmt(s)} | ${modeShare(s)} | ${fmt(l)} | ${modeShare(l)} |`);
  }
  process.stdout.write("\n");

  const md = [
    "# Measurements",
    "",
    `- Measured: ${started}`,
    `- Runs per case per mode: ${RUNS}`,
    `- Model: ${process.env.LLM_MODEL ?? "(server default, see /api responses)"} via ${BASE}; provider default sampling settings`,
    "- Structured: only the `sensor_fault_evidence` node calls the LLM; RULE/CODE nodes are deterministic.",
    "- LLM Only: one call receives all inputs and the same policy text.",
    "",
    "| Case | Structured — results | Structured — most common | LLM Only — results | LLM Only — most common |",
    "|---|---|---|---|---|",
    ...lines,
    "",
    "Results are recorded as measured. This compares consistency on a small hypothetical scenario; it is not a general accuracy claim.",
    "",
  ].join("\n");
  writeFileSync(new URL("../docs/measurements.md", import.meta.url), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
