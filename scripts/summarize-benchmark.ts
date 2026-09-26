// Prints a short summary of src/scenario/benchmark.json: accuracy per problem and step, and sample wrong explanations.
//   npx tsx scripts/summarize-benchmark.ts
import data from "../src/scenario/benchmark.json";

type Side = { runs: number; correct: number; steps: Record<string, { correct: number; runs: number }>; wrong: { run: number; answer: string; finalCorrect: boolean; wrongSteps: string[]; reason: string }[] };
type Row = { scenario: string; caseId: string; title: string; expected: string; structured: Side; llmOnly: Side };

for (const r of (data as unknown as { results: Row[] }).results) {
  console.log(`\n[${r.scenario}] ${r.title}  (정답: ${r.expected})`);
  console.log(`  결론 — LLM+규칙 ${r.structured.correct}/${r.structured.runs} · LLM 단독 ${r.llmOnly.correct}/${r.llmOnly.runs}`);
  for (const [step, v] of Object.entries(r.llmOnly.steps)) if (v.correct < v.runs) console.log(`  LLM 단독 단계 오답: ${step} ${v.correct}/${v.runs}`);
  for (const [step, v] of Object.entries(r.structured.steps)) if (v.correct < v.runs) console.log(`  LLM+규칙 단계 오답: ${step} ${v.correct}/${v.runs}`);
  const w = r.llmOnly.wrong.find((x) => !x.finalCorrect);
  if (w) console.log(`  예) ${w.run}번째 → ${w.answer}\n      ${w.wrongSteps.join(" · ")}\n      "${w.reason.slice(0, 220)}"`);
}
