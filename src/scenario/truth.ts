// The correct outcome for an input: the same graph, with each LLM node answered by the intended reading
// of its prepared text (NotePreset.prepared). Undefined when a text is not a prepared one (custom input).

import { runGraph } from "@/core/engine";
import type { LLMProvider } from "@/core/resolvers";
import type { JudgmentValue } from "@/core/types";
import { preparedFor, toInput, type Draft, type Scenario } from "./types";

export interface Truth {
  decision: JudgmentValue;
  /** Correct result of every node, for locating which step went wrong. */
  nodes: Record<string, JudgmentValue>;
}

export async function groundTruth(sc: Scenario, d: Draft): Promise<Truth | undefined> {
  let unknown = false;
  const intended: LLMProvider = {
    async evaluate(req) {
      const answer = preparedFor(sc, Object.values(req.evidence)[0] ?? "");
      if (!answer) unknown = true;
      return { raw: answer ?? { decision: false, reason: "unknown" }, source: "mock" };
    },
  };
  const r = await runGraph(sc.buildGraph(d.settings), toInput(sc, d), { functions: sc.functions, llm: intended });
  if (unknown || r.decisionStatus !== "SUCCEEDED" || r.decision === undefined) return undefined;
  const nodes: Record<string, JudgmentValue> = {};
  for (const [id, st] of Object.entries(r.states)) if (st.output) nodes[id] = st.output.result;
  return { decision: r.decision, nodes };
}
