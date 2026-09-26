import { getScenario } from "@/scenario";
import { recordedJudgment } from "@/scenario/recorded";
import { preparedFor } from "@/scenario/types";
import { MAX_FIELD_CHARS, completeJSON, liveConfig, rateLimited } from "@/server/llm";

// Allow a slow LLM reply (and one retry) to finish on the deployment platform.
export const maxDuration = 30;

// Evaluates ONE LLM node of a scenario's judgment DAG.
// The question is taken from the server-side graph, not from the client, so this endpoint
// cannot be used as a general-purpose LLM proxy.

const SYSTEM = [
  "You evaluate exactly one judgment inside a larger, explicitly structured decision process.",
  "Answer only the question you are given, using only the evidence provided. Do not decide the overall outcome.",
  "Reply with a single JSON object and nothing else:",
  '{"decision": boolean, "confidence": number between 0 and 1, "reason": string, "evidence_quotes": string[]}',
  "evidence_quotes must be verbatim sentences copied from the evidence.",
  "Write reason in Korean.",
].join("\n");

export async function POST(request: Request) {
  // The rate limit protects the API key. When it is hit, the live call is skipped but recorded answers still work.
  const limited = rateLimited(request);

  const body = (await request.json().catch(() => null)) as {
    scenario?: string;
    nodeId?: string;
    evidence?: Record<string, string>;
  } | null;
  const scenario = getScenario(body?.scenario);
  if (!scenario) return Response.json({ error: "알 수 없는 시나리오입니다." }, { status: 400 });
  const graph = scenario.buildGraph(scenario.defaultSettings);
  const node = graph.nodes.find((n) => n.id === body?.nodeId);
  if (!node || node.resolver_type !== "LLM") return Response.json({ error: "알 수 없는 LLM 노드입니다." }, { status: 400 });

  const evidence: Record<string, string> = {};
  for (const ref of node.resolver_config.evidence) {
    const value = String(body?.evidence?.[ref] ?? "");
    if (value.length > MAX_FIELD_CHARS) return Response.json({ error: `${ref} 입력이 너무 깁니다.` }, { status: 400 });
    evidence[ref] = value;
  }
  // The LLM node reads one free-text field; recorded and prepared answers are keyed by that text.
  const text = Object.values(evidence)[0] ?? "";

  const config = limited ? null : liveConfig();
  if (config) {
    try {
      const user = [
        `Question: ${node.resolver_config.question}`,
        ...Object.entries(evidence).map(([ref, t]) => `\n[${ref.replace("input.", "")}]\n${t}`),
      ].join("\n");
      const raw = await completeJSON(config, SYSTEM, user);
      return Response.json({ raw, source: "live", model: config.model });
    } catch (err) {
      console.error("live LLM call failed:", err);
    }
  }

  // No live LLM (or it failed / was rate limited). Prefer a recorded real answer, then the prepared (written) one.
  const recorded = recordedJudgment(scenario.id, text);
  if (recorded) {
    return Response.json({ raw: recorded.raw, source: "recorded", model: recorded.model, recordedAt: recorded.recordedAt });
  }
  const prepared = preparedFor(scenario, text);
  if (prepared) return Response.json({ raw: prepared, source: "fallback" });
  return Response.json(
    {
      error:
        "이 배포에서는 지금 실제 LLM을 호출할 수 없고, 직접 입력한 기록에는 준비된 답변이 없습니다. 준비된 예시 기록을 고르면 체험할 수 있습니다.",
    },
    { status: 503 },
  );
}
