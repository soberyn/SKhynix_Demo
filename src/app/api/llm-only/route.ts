import { clampSettings, policyText, type EquipmentInput } from "@/scenario/equipment";
import { llmOnlyKey, recordedLLMOnly } from "@/scenario/recorded";
import { MAX_FIELD_CHARS, completeJSON, liveConfig, rateLimited } from "@/server/llm";

// LLM Only mode: the whole input and the same demo policy go to one LLM call,
// which returns the final action. The prompt is not tuned to make it fail.

const SYSTEM = [
  "You decide the action for a piece of equipment by applying the given policy to the given data.",
  "Reply with a single JSON object and nothing else:",
  '{"action": string (exactly one of the actions named in the policy, copied verbatim), "reason": string (in Korean)}',
].join("\n");

const FIELDS: (keyof EquipmentInput)[] = ["pressure", "pressure_limit", "evaluation_time", "alarm_history", "maintenance_note"];

export async function POST(request: Request) {
  if (rateLimited(request)) return Response.json({ error: "요청이 너무 많습니다. 몇 분 후 다시 시도해 주세요." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { input?: Record<string, string>; settings?: Record<string, unknown> } | null;
  const input: Record<string, string> = {};
  for (const f of FIELDS) {
    const value = String(body?.input?.[f] ?? "");
    if (value.length > MAX_FIELD_CHARS) return Response.json({ error: `${f} 입력이 너무 깁니다.` }, { status: 400 });
    input[f] = value;
  }

  const settings = clampSettings(body?.settings);
  const recorded = recordedLLMOnly(llmOnlyKey(input, settings));
  const fromRecord = () =>
    recorded && Response.json({ raw: recorded.raw, source: "recorded", model: recorded.model, recordedAt: recorded.recordedAt });

  const config = liveConfig();
  if (!config) {
    const r = fromRecord();
    if (r) return r;
    return Response.json(
      { error: "LLM 단독 모드는 실제 AI(LLM) 연결이 필요한데, 이 배포에는 연결되어 있지 않습니다. 아래 구조 비교표는 그대로 참고하실 수 있습니다." },
      { status: 503 },
    );
  }

  const user = [
    "정책:",
    policyText(settings),
    "",
    `챔버 압력: ${input.pressure} Pa`,
    `압력 기준값: ${input.pressure_limit} Pa`,
    `판단 시각: ${input.evaluation_time}`,
    "",
    "알람 이력:",
    input.alarm_history,
    "",
    "정비 기록:",
    input.maintenance_note,
  ].join("\n");

  try {
    const raw = await completeJSON(config, SYSTEM, user);
    return Response.json({ raw, source: "live", model: config.model });
  } catch (err) {
    console.error("live LLM call failed:", err);
    return fromRecord() || Response.json({ error: "AI 호출에 실패했습니다. 다시 시도해 주세요." }, { status: 502 });
  }
}
