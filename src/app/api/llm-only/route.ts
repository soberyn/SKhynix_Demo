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
  // The rate limit protects the API key. When it is hit, the live call is skipped but recorded answers still work.
  const limited = rateLimited(request);

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

  const config = limited ? null : liveConfig();
  if (!config) {
    const r = fromRecord();
    if (r) return r;
    return Response.json(
      { error: "이 입력에 대한 LLM 단독 응답 기록이 없고, 지금은 실제 LLM을 호출할 수 없습니다. 미션 입력(또는 예시 입력)으로 실행하면 기록된 실제 LLM 응답을 볼 수 있습니다." },
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
    return fromRecord() || Response.json({ error: "LLM 호출에 실패했습니다. 다시 시도해 주세요." }, { status: 502 });
  }
}
