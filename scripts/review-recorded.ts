// Prints recorded answers next to the LLM + rules outcome for the same input (uses the recorded LLM-node answers).
import { runGraph } from "../src/core/engine";
import type { LLMProvider } from "../src/core/resolvers";
import { SCENARIOS } from "../src/scenario";
import data from "../src/scenario/recorded.json";
import { llmOnlyKey, toInput } from "../src/scenario/types";

type J = { scenario: string; note: string; raw: { decision: boolean; reason: string } };
type L = { key: string; name: string; raw: { action: string; reason: string } };

async function main() {
  for (const j of data.judge as J[]) console.log(`[${j.scenario}] LLM 판단 · ${j.note.split("\n")[0].slice(0, 40)}… → ${j.raw.decision}`);
  console.log("");
  for (const sc of SCENARIOS) {
    const recordedLLM: LLMProvider = {
      async evaluate(req) {
        const text = Object.values(req.evidence)[0];
        const r = (data.judge as J[]).find((x) => x.scenario === sc.id && x.note === text.trim());
        return { raw: r?.raw, source: "recorded" };
      },
    };
    const cases = [{ name: "example", draft: sc.exampleDraft }, ...sc.missions.map((m) => ({ name: m.id, draft: m.apply(sc.exampleDraft).draft, o: m.apply(sc.exampleDraft).overrides }))];
    for (const c of cases) {
      if ("o" in c && c.o && Object.keys(c.o).length) continue;
      const input = toInput(sc, c.draft);
      const rec = (data.llmOnly as L[]).find((x) => x.key === llmOnlyKey(sc, input, c.draft.settings));
      const r = await runGraph(sc.buildGraph(c.draft.settings), input, { functions: sc.functions, llm: recordedLLM });
      const hetero = String(r.decision);
      const llm = rec?.raw.action ?? "(기록 없음)";
      console.log(`[${sc.id}] ${c.name.padEnd(14)} LLM+규칙: ${hetero} | LLM단독: ${llm} ${hetero === llm ? "" : "  ⚠ 다름"}`);
      if (hetero !== llm) console.log(`    LLM 단독 설명: ${rec?.raw.reason}`);
    }
  }
}
main();
