// Repeated measurement against the correct outcome.
// Every benchmark case is judged N times by LLM-only and by LLM + rules with a live LLM; results are stored in
// src/scenario/benchmark.json and shown in the demo. Everything is recorded as observed.
//
// Usage (dev server running with a live LLM in .env.local):
//   npm run dev -- -p 3100
//   npm run benchmark -- --runs 10                 # all scenarios; resumes where it stopped
//   npm run benchmark -- --runs 10 --scenario tax  # one scenario
//   npm run benchmark -- --fresh ...               # discard stored results of the selected scenarios first
//
// Each run costs 2 LLM calls (the LLM node, and LLM-only). --pause (ms) keeps under free-tier per-minute limits.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runGraph } from "../src/core/engine";
import type { LLMProvider, LLMResponse } from "../src/core/resolvers";
import { SCENARIOS } from "../src/scenario";
import { groundTruth } from "../src/scenario/truth";
import { toInput } from "../src/scenario/types";

const yn = (v: unknown) => (typeof v === "boolean" ? (v ? "예" : "아니오") : String(v));

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";
const FILE = new URL("../src/scenario/benchmark.json", import.meta.url);
const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const RUNS = Number(arg("--runs", "10"));
const PAUSE = Number(arg("--pause", "8000"));
const selected = SCENARIOS.filter((s) => !arg("--scenario") || s.id === arg("--scenario"));

type StepStats = Record<string, { correct: number; runs: number }>;
interface WrongRun {
  run: number;
  /** The final outcome of this run. */
  answer: string;
  finalCorrect: boolean;
  /** Steps whose result differed from the correct one: "단계 → 보고/결과 (정답 …)". */
  wrongSteps: string[];
  reason: string;
}

export interface CaseResult {
  scenario: string;
  caseId: string;
  title: string;
  expected: string;
  /** Correct result of every step, by step question. */
  expectedSteps: Record<string, string>;
  structured: { runs: number; correct: number; outcomes: Record<string, number>; steps: StepStats; wrong: WrongRun[] };
  llmOnly: { runs: number; correct: number; outcomes: Record<string, number>; steps: StepStats; wrong: WrongRun[] };
}
interface Store {
  model: string;
  updatedAt: string;
  results: CaseResult[];
}

const store: Store = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { model: "", updatedAt: "", results: [] };
if (process.argv.includes("--fresh")) store.results = store.results.filter((r) => !selected.some((s) => s.id === r.scenario));
const save = () => {
  store.updatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");
};
const pause = () => new Promise((r) => setTimeout(r, PAUSE));

class NoLiveAnswer extends Error {}

/** Free tiers limit requests per minute: on a miss, wait a full minute and try again (a few times). */
async function post(path: string, body: unknown) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok && data.source === "live") return data;
    if (attempt >= 6) throw new NoLiveAnswer(`${path}: no live answer (${data.error ?? data.source}) — daily quota? see the server log`);
    process.stdout.write(` [한도 대기 ${attempt}] `);
    await new Promise((r) => setTimeout(r, 65_000));
  }
}

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

async function main() {
  for (const sc of selected) {
    for (const c of sc.cases) {
      const draft = c.apply(sc.exampleDraft);
      const truth = await groundTruth(sc, draft);
      if (!truth) throw new Error(`No correct outcome for ${sc.id}/${c.id}`);
      let r = store.results.find((x) => x.scenario === sc.id && x.caseId === c.id);
      if (!r) {
        const g0 = sc.buildGraph(draft.settings);
        r = {
          scenario: sc.id,
          caseId: c.id,
          title: c.title,
          expected: String(truth.decision),
          expectedSteps: Object.fromEntries(
            g0.nodes.filter((n) => n.id !== g0.decision_node).map((n) => [n.label, yn(truth.nodes[n.id])]),
          ),
          structured: { runs: 0, correct: 0, outcomes: {}, steps: {}, wrong: [] },
          llmOnly: { runs: 0, correct: 0, outcomes: {}, steps: {}, wrong: [] },
        };
        store.results.push(r);
      }
      const input = toInput(sc, draft);
      const graph = sc.buildGraph(draft.settings);
      const stepNodes = graph.nodes.filter((n) => n.id !== graph.decision_node);
      const tallyStep = (stats: StepStats, label: string, ok: boolean) => {
        stats[label] ??= { correct: 0, runs: 0 };
        stats[label].runs++;
        if (ok) stats[label].correct++;
      };

      while (r.structured.runs < RUNS || r.llmOnly.runs < RUNS) {
        if (r.structured.runs < RUNS) {
          let model = "";
          const live: LLMProvider = {
            async evaluate(req): Promise<LLMResponse> {
              const d = await post("/api/judge", { scenario: sc.id, nodeId: req.nodeId, evidence: req.evidence });
              model = d.model;
              return d;
            },
          };
          const run = await runGraph(graph, input, { functions: sc.functions, llm: live });
          const outcome = run.decisionStatus === "SUCCEEDED" ? String(run.decision) : "판단 불가";
          r.structured.runs++;
          bump(r.structured.outcomes, outcome);
          const finalOk = outcome === r.expected;
          if (finalOk) r.structured.correct++;
          const wrongSteps: string[] = [];
          const reasons: string[] = [];
          for (const n of stepNodes) {
            const got = run.states[n.id]?.output ? yn(run.states[n.id].output!.result) : "판단 불가";
            const ok = got === r.expectedSteps[n.label];
            tallyStep(r.structured.steps, n.label, ok);
            if (!ok) {
              wrongSteps.push(`${n.label} → ${got} (정답 ${r.expectedSteps[n.label]})`);
              if (run.states[n.id]?.output?.llm) reasons.push(run.states[n.id].output!.explanation);
            }
          }
          if (!finalOk || wrongSteps.length)
            r.structured.wrong.push({ run: r.structured.runs, answer: outcome, finalCorrect: finalOk, wrongSteps, reason: reasons.join(" / ") });
          if (model) store.model = model;
          await pause();
        }
        if (r.llmOnly.runs < RUNS) {
          const d = await post("/api/llm-only", { scenario: sc.id, input, settings: draft.settings });
          const action = String(d.raw?.action ?? "형식 오류");
          const checks: Record<string, string> = d.raw?.checks ?? {};
          r.llmOnly.runs++;
          bump(r.llmOnly.outcomes, action);
          const finalOk = action === r.expected;
          if (finalOk) r.llmOnly.correct++;
          const wrongSteps: string[] = [];
          for (const n of stepNodes) {
            const got = checks[n.label] ?? "보고 없음";
            const ok = got === r.expectedSteps[n.label];
            tallyStep(r.llmOnly.steps, n.label, ok);
            if (!ok) wrongSteps.push(`${n.label} → ${got} (정답 ${r.expectedSteps[n.label]})`);
          }
          if (!finalOk || wrongSteps.length)
            r.llmOnly.wrong.push({ run: r.llmOnly.runs, answer: action, finalCorrect: finalOk, wrongSteps, reason: String(d.raw?.reason ?? "") });
          store.model = d.model;
          await pause();
        }
        save();
        process.stdout.write(`\r[${sc.id}] ${c.id}: LLM+규칙 ${r.structured.correct}/${r.structured.runs} · LLM 단독 ${r.llmOnly.correct}/${r.llmOnly.runs}   `);
      }
      process.stdout.write("\n");
    }
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(`\n${err.message ?? err}`);
  console.error("Progress is saved; run the same command again later to continue.");
  process.exit(1);
});
