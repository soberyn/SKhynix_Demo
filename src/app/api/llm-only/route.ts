import { getScenario } from "@/scenario";
import { recordedLLMOnly } from "@/scenario/recorded";
import { clampSettings, fieldLabel, llmOnlyKey } from "@/scenario/types";
import { MAX_FIELD_CHARS, completeJSON, liveConfig, rateLimited } from "@/server/llm";

// LLM Only mode: the whole input and the same policy text go to one LLM call,
// which returns the final outcome. The prompt is not tuned to make it fail.

export async function POST(request: Request) {
  // The rate limit protects the API key. When it is hit, the live call is skipped but recorded answers still work.
  const limited = rateLimited(request);

  const body = (await request.json().catch(() => null)) as {
    scenario?: string;
    input?: Record<string, string>;
    settings?: Record<string, unknown>;
  } | null;
  const scenario = getScenario(body?.scenario);
  if (!scenario) return Response.json({ error: "알 수 없는 시나리오입니다." }, { status: 400 });

  const input: Record<string, string> = {};
  for (const f of scenario.fields) {
    const value = String(body?.input?.[f.key] ?? "");
    if (value.length > MAX_FIELD_CHARS) return Response.json({ error: `${f.label} 입력이 너무 깁니다.` }, { status: 400 });
    input[f.key] = value;
  }
  const settings = clampSettings(scenario, body?.settings);

  const recorded = recordedLLMOnly(llmOnlyKey(scenario, input, settings));
  const fromRecord = () =>
    recorded && Response.json({ raw: recorded.raw, source: "recorded", model: recorded.model, recordedAt: recorded.recordedAt });

  const config = limited ? null : liveConfig();
  if (!config) {
    return (
      fromRecord() ||
      Response.json(
        {
          error:
            "이 입력에 대한 LLM 단독 응답 기록이 없고, 지금은 실제 LLM을 호출할 수 없습니다. 예시 입력이나 미션 입력으로 실행하면 기록된 실제 LLM 응답을 볼 수 있습니다.",
        },
        { status: 503 },
      )
    );
  }

  // LLM-only also reports its answer to each step of the judgment graph, so the two approaches can be compared
  // step by step. It still reads the whole input and decides everything itself; the list only names the steps.
  const graph = scenario.buildGraph(settings);
  const steps = graph.nodes.filter((n) => n.id !== graph.decision_node).map((n) => n.label);
  const system = [
    scenario.llmOnlyRole,
    "Reply with a single JSON object and nothing else:",
    '{"checks": {"<each step question, copied verbatim>": "예" | "아니오"}, "action": string (exactly one of the outcomes named in the policy, copied verbatim), "reason": string (in Korean)}',
  ].join("\n");
  const user = [
    "정책:",
    scenario.policyText(settings),
    "",
    ...scenario.fields.map((f) => `${fieldLabel(scenario, f.key)}:\n${input[f.key]}`),
    "",
    "각 단계에 대한 판단도 checks에 함께 보고하십시오:",
    ...steps.map((q) => `- ${q}`),
  ].join("\n");

  try {
    const raw = await completeJSON(config, system, user);
    return Response.json({ raw, source: "live", model: config.model });
  } catch (err) {
    console.error("live LLM call failed:", err);
    return fromRecord() || Response.json({ error: "LLM 호출에 실패했습니다. 다시 시도해 주세요." }, { status: 502 });
  }
}
