// Simplified hypothetical manufacturing scenario for demonstrating the architecture.
// It does not represent an actual SK hynix process or SOP.

import type { LLMJudgment, RuleFunctions } from "@/core/resolvers";
import type { JudgmentGraph } from "@/core/types";

export const DISCLAIMER =
  "구조를 보여주기 위해 단순화한 가상의 설비 시나리오입니다. 실제 SK하이닉스의 공정이나 SOP를 나타내지 않습니다.";

export interface EquipmentInput {
  pressure: string;
  pressure_limit: string;
  evaluation_time: string;
  alarm_history: string;
  maintenance_note: string;
  [key: string]: string;
}

export const EXAMPLE_INPUT: EquipmentInput = {
  pressure: "12.7",
  pressure_limit: "10.0",
  evaluation_time: "2026-09-26 18:00",
  alarm_history: [
    "2026-09-24 22:05 압력 경고",
    "2026-09-26 09:13 압력 경고",
    "2026-09-26 11:42 압력 경고",
    "2026-09-26 12:30 펌프 온도 경고",
    "2026-09-26 14:08 압력 경고",
    "2026-09-26 17:21 압력 경고",
  ].join("\n"),
  maintenance_note: "", // set below from NOTE_PRESETS[0]
};

/**
 * Maintenance record variants the user can switch between. Each carries a prepared answer for the LLM node,
 * used only when no live LLM is available and only for this exact text. The prepared answers were written for
 * the demo (not recorded from a model) and are always labelled "준비된 예시 답변" in the UI.
 */
export interface NotePreset {
  id: string;
  label: string;
  text: string;
  prepared: LLMJudgment;
}

export const NOTE_PRESETS: NotePreset[] = [
  {
    id: "calibrated",
    label: "보정 완료, 일시적 튐 1회",
    text: [
      "[주간 근무, 09/25] 압력 센서 보정 완료. 보정 후 점검에서 이상 drift 없음.",
      "[야간 근무, 09/26] 02:00경 몇 초간 표시값이 튀었다가 스스로 안정됨. 그 외 시간대 표시값 정상. 알람으로 기록하지 않음.",
      "[부품 요청, 09/26] 교체용 게이지는 다른 챔버 건으로 요청됨. 이 챔버에 대한 요청은 철회됨.",
    ].join("\n"),
    prepared: {
      decision: false,
      confidence: 0.8,
      reason:
        "센서는 전날 보정되었고 drift도 없었습니다. 이상 표시는 02:00경 몇 초간 한 번뿐이었고 스스로 안정되었으며, " +
        "그 외 시간대에는 정상이었습니다. 게이지 교체 요청은 다른 챔버 건입니다. 따라서 반복된 압력 경고를 센서 고장으로 " +
        "설명할 충분한 근거는 없습니다.",
      evidence_quotes: [
        "압력 센서 보정 완료. 보정 후 점검에서 이상 drift 없음.",
        "그 외 시간대 표시값 정상.",
        "교체용 게이지는 다른 챔버 건으로 요청됨.",
      ],
    },
  },
  {
    id: "suspect",
    label: "센서 이상 정황 있음",
    text: [
      "[야간 근무, 09/26] 압력 표시값이 수 분 간격으로 반복해서 급변함. 휴대용 기준 게이지로 대조했을 때 실제 챔버 압력은 정상 범위.",
      "[주간 근무, 09/26] 센서 커넥터 접촉 불량 의심. 재체결했으나 1시간 뒤 같은 증상 재발.",
    ].join("\n"),
    prepared: {
      decision: true,
      confidence: 0.85,
      reason:
        "기준 게이지 대조에서 실제 챔버 압력은 정상이었는데 센서 표시값만 반복해서 급변했습니다. 커넥터를 재체결한 뒤에도 " +
        "증상이 재발했습니다. 압력 경고가 실제 챔버 상태가 아니라 센서 이상 때문일 가능성을 뒷받침하는 근거가 충분합니다.",
      evidence_quotes: [
        "휴대용 기준 게이지로 대조했을 때 실제 챔버 압력은 정상 범위.",
        "재체결했으나 1시간 뒤 같은 증상 재발.",
      ],
    },
  },
  {
    id: "none",
    label: "특이사항 없음",
    text: "[주간 근무, 09/26] 정기 점검 수행. 특이사항 없음.",
    prepared: {
      decision: false,
      confidence: 0.7,
      reason: "정비 기록에 센서 이상을 시사하는 내용이 없습니다. 센서 고장이라고 판단할 근거가 없습니다.",
      evidence_quotes: ["정기 점검 수행. 특이사항 없음."],
    },
  },
];

EXAMPLE_INPUT.maintenance_note = NOTE_PRESETS[0].text;

export const ACTIONS = {
  CONTINUE: "계속 운전",
  MONITOR: "모니터링 강화",
  CHECK_SENSOR: "엔지니어 검토 — 센서 점검",
  HOLD: "설비 보류 — 엔지니어 검토 필요",
} as const;

/** Rule values a user can change in the demo (policy change experience). */
export interface PolicySettings {
  threshold: number;
  windowHours: number;
}

export const DEFAULT_SETTINGS: PolicySettings = { threshold: 3, windowHours: 24 };

export function buildEquipmentGraph({ threshold, windowHours }: PolicySettings): JudgmentGraph {
  return {
  decision_node: "equipment_action",
  nodes: [
    {
      id: "pressure_abnormal",
      label: "압력 이상인가?",
      description: "챔버 압력이 기준값을 넘는지 비교합니다.",
      dependencies: [],
      resolver_type: "RULE",
      resolver_config: { kind: "compare", left: "input.pressure", op: ">", right: "input.pressure_limit" },
    },
    {
      id: "repeated_alarm",
      label: "알람이 반복되는가?",
      description: `최근 ${windowHours}시간 압력 경고가 ${threshold}회 이상인지 집계합니다.`,
      dependencies: [],
      resolver_type: "RULE",
      resolver_config: {
        kind: "function",
        fn: "countAlarmsInWindow",
        params: { type: "압력 경고", windowHours, threshold },
        reads: ["input.evaluation_time", "input.alarm_history"],
      },
    },
    {
      id: "sensor_fault_evidence",
      label: "센서 고장 근거가 있는가?",
      description: "정비 기록을 읽고, 압력 경고가 센서 고장 때문일 근거가 있는지 판단합니다.",
      dependencies: [],
      resolver_type: "LLM",
      resolver_config: {
        question:
          "이 챔버에서 압력 경고가 반복되고 있습니다. 정비 기록에, 그 경고가 실제 챔버 상태가 아니라 " +
          "압력 센서 자체의 고장·오작동 때문일 가능성이 높다고 볼 만한 충분한 근거가 있습니까?",
        evidence: ["input.maintenance_note"],
      },
    },
    {
      id: "equipment_action",
      label: "설비 조치",
      description: "세 판단 결과를 데모 정책 표에 대입해 조치를 정합니다.",
      dependencies: ["pressure_abnormal", "repeated_alarm", "sensor_fault_evidence"],
      resolver_type: "RULE",
      resolver_config: {
        kind: "table",
        rows: [
          { when: { pressure_abnormal: false }, then: ACTIONS.CONTINUE },
          { when: { pressure_abnormal: true, repeated_alarm: false }, then: ACTIONS.MONITOR },
          { when: { pressure_abnormal: true, repeated_alarm: true, sensor_fault_evidence: true }, then: ACTIONS.CHECK_SENSOR },
          { when: { pressure_abnormal: true, repeated_alarm: true, sensor_fault_evidence: false }, then: ACTIONS.HOLD },
        ],
      },
    },
  ],
  };
}

export const EQUIPMENT_GRAPH = buildEquipmentGraph(DEFAULT_SETTINGS);

/** The demo policy in plain language. Given verbatim to the LLM-only mode so both modes see the same rules. */
export function policyText({ threshold, windowHours }: PolicySettings): string {
  return [
    `- 챔버 압력이 기준값을 넘지 않으면: ${ACTIONS.CONTINUE}`,
    `- 압력이 기준값을 넘지만, 판단 시각 이전 ${windowHours}시간 동안 압력 경고가 ${threshold}회 미만이면: ${ACTIONS.MONITOR}`,
    `- 압력이 기준값을 넘고, 압력 경고가 ${threshold}회 이상이며, 정비 기록에 압력 센서 고장의 충분한 근거가 있으면: ${ACTIONS.CHECK_SENSOR}`,
    `- 압력이 기준값을 넘고, 압력 경고가 ${threshold}회 이상이며, 센서 고장의 충분한 근거가 없으면: ${ACTIONS.HOLD}`,
  ].join("\n");
}

/** Keeps user-entered rule values in a sane range. */
export function clampSettings(raw: Partial<Record<keyof PolicySettings, unknown>> | undefined): PolicySettings {
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    threshold: int(raw?.threshold, 1, 20, DEFAULT_SETTINGS.threshold),
    windowHours: int(raw?.windowHours, 1, 168, DEFAULT_SETTINGS.windowHours),
  };
}

// ---------- Rule functions (deterministic) ----------

const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) (.+)$/;

function parseTime(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`판단 시각 형식이 올바르지 않습니다: "${text}" (YYYY-MM-DD HH:MM 형식으로 입력)`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

export const EQUIPMENT_FUNCTIONS: RuleFunctions = {
  countAlarmsInWindow(params, ctx) {
    const type = String(params.type);
    const windowHours = Number(params.windowHours);
    const threshold = Number(params.threshold);
    const end = parseTime(String(ctx.input.evaluation_time ?? ""));
    const start = end - windowHours * 3600_000;

    const counted: string[] = [];
    const excluded: string[] = [];
    const lines = String(ctx.input.alarm_history ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const m = LINE.exec(line);
      if (!m) throw new Error(`알람 줄을 읽을 수 없습니다: "${line}" (YYYY-MM-DD HH:MM 유형 형식으로 입력)`);
      const t = parseTime(`${m[1]} ${m[2]}:${m[3]}`);
      const inWindow = t > start && t <= end;
      if (m[4].trim().toLowerCase() !== type) excluded.push(`${line}  (다른 유형)`);
      else if (!inWindow) excluded.push(`${line}  (${windowHours}시간 범위 밖)`);
      else counted.push(line);
    }

    const result = counted.length >= threshold;
    return {
      result,
      explanation: `최근 ${windowHours}시간 "${type}" ${counted.length}회 (기준 ${threshold}회 이상) → ${result ? "예" : "아니오"}`,
      inputs: { evaluation_time: ctx.input.evaluation_time, window_hours: windowHours, threshold, count: counted.length },
      evidence: [...counted.map((l) => `집계: ${l}`), ...excluded.map((l) => `제외: ${l}`)],
    };
  },
};

// ---------- Fallback ----------

/** The prepared answer for exactly this maintenance text, if one exists. */
export function preparedAnswer(evidence: Record<string, string>): LLMJudgment | undefined {
  const note = evidence["input.maintenance_note"]?.trim();
  return NOTE_PRESETS.find((p) => p.text === note)?.prepared;
}
