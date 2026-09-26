// Simplified hypothetical manufacturing scenario for demonstrating the architecture.
// It does not represent an actual SK hynix process or SOP.

import type { RuleFunctions } from "@/core/resolvers";
import type { JudgmentGraph } from "@/core/types";
import type { BenchCase, Draft, Mission, NotePreset, Scenario, Settings } from "./types";

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
  // Three days of alarms, as an operator would see them: similar-looking types, alarms just outside
  // the window, and one after the evaluation time. Pressure warnings inside the 24h window: 5.
  alarm_history: [
    "2026-09-25 09:40 압력 경고",
    "2026-09-25 17:55 압력 경고",
    "2026-09-25 18:10 압력 경고",
    "2026-09-25 23:32 펌프 온도 경고",
    "2026-09-26 02:03 압력 경고",
    "2026-09-26 02:04 압력 경고 해제",
    "2026-09-26 09:13 압력 경고",
    "2026-09-26 11:42 압력 경고",
    "2026-09-26 12:30 펌프 온도 경고",
    "2026-09-26 14:08 압력 센서 통신 경고",
    "2026-09-26 17:21 압력 경고",
    "2026-09-26 18:05 압력 경고",
  ].join("\n"),
  maintenance_note: "", // set below from NOTE_PRESETS[0]
};

/**
 * Maintenance record variants the user can switch between. Each carries a prepared answer for the LLM node,
 * used only when no live LLM is available and only for this exact text. The prepared answers were written for
 * the demo (not recorded from a model) and are always labelled "준비된 예시 답변" in the UI.
 */
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
export interface PolicySettings extends Settings {
  threshold: number;
  windowHours: number;
}

export const DEFAULT_SETTINGS: PolicySettings = { threshold: 5, windowHours: 24 };

export function buildEquipmentGraph({ threshold, windowHours }: Settings): JudgmentGraph {
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
export function policyText({ threshold, windowHours }: Settings): string {
  return [
    `- 챔버 압력이 기준값을 넘지 않으면: ${ACTIONS.CONTINUE}`,
    `- 압력이 기준값을 넘지만, 판단 시각 이전 ${windowHours}시간 동안 압력 경고가 ${threshold}회 미만이면: ${ACTIONS.MONITOR}`,
    `- 압력이 기준값을 넘고, 압력 경고가 ${threshold}회 이상이며, 정비 기록에 압력 센서 고장의 충분한 근거가 있으면: ${ACTIONS.CHECK_SENSOR}`,
    `- 압력이 기준값을 넘고, 압력 경고가 ${threshold}회 이상이며, 센서 고장의 충분한 근거가 없으면: ${ACTIONS.HOLD}`,
  ].join("\n");
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

// ---------- Scenario ----------

const EXAMPLE_DRAFT: Draft = {
  values: {
    pressure: EXAMPLE_INPUT.pressure,
    pressure_limit: EXAMPLE_INPUT.pressure_limit,
    evaluation_time: EXAMPLE_INPUT.evaluation_time,
  },
  lines: { alarm_history: EXAMPLE_INPUT.alarm_history.split("\n").map((text) => ({ text, on: true })) },
  notes: { maintenance_note: { presetId: NOTE_PRESETS[0].id, custom: "" } },
  settings: DEFAULT_SETTINGS,
};

const MISSIONS: Mission[] = [
  {
    id: "pressure",
    title: "압력이 정상으로 돌아오면?",
    what: "챔버 압력을 9.5 Pa로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, values: { ...d.values, pressure: "9.5" } } }),
    benefit: "결론이 왜 바뀌었는지 ‘압력 이상’ 한 단계로 바로 추적됩니다.",
    llmOnly: "LLM 단독이라면 전체를 다시 묻고, 새 설명문을 이전 설명과 비교해 무엇이 바뀌었는지 직접 찾아야 합니다.",
  },
  {
    id: "override",
    title: "엔지니어가 센서를 의심한다면?",
    what: "‘센서 고장 근거가 있는가?’를 사람이 ‘예’로 지정했습니다.",
    apply: (d) => ({ draft: d, overrides: { sensor_fault_evidence: { result: true, note: "엔지니어가 현장 확인 후 ‘예’로 지정" } } }),
    benefit: "LLM의 판단 하나만 사람이 고쳤고, 그 결과에 의존하는 조치만 다시 정해졌습니다. 누가 무엇을 고쳤는지 판단과정에 남습니다.",
    llmOnly: "LLM 단독이라면 LLM의 결론 전체에 반박하고, 새 결론이 내 의견을 제대로 반영했는지 다시 읽어 확인해야 합니다.",
  },
  {
    id: "policy",
    title: "알람 기준이 6회로 바뀌면?",
    what: "규칙 값 ‘알람 기준 횟수’를 5회 → 6회로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, settings: { ...d.settings, threshold: 6 } } }),
    benefit: "바뀐 규칙 값은 그 값을 쓰는 규칙 단계 하나에만 반영됩니다. 같은 입력이면 언제나 같은 결과이고, LLM은 부르지 않았습니다.",
    llmOnly: "LLM 단독이라면 정책 문장을 고쳐 다시 묻고, 알람 횟수를 정확히 세어 새 기준을 적용했는지 설명문을 읽어 확인해야 합니다.",
  },
  {
    id: "note",
    title: "정비 기록 내용이 다르면?",
    what: "정비 기록을 ‘센서 이상 정황 있음’으로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, notes: { ...d.notes, maintenance_note: { presetId: "suspect", custom: "" } } } }),
    benefit: "LLM 단계는 바뀐 정비 기록을 읽는 그 한 단계만 다시 실행되었고, 압력·알람 판단은 재사용되었습니다.",
    llmOnly: "LLM 단독이라면 기록 하나만 바뀌어도 모든 조건을 처음부터 다시 판단합니다.",
  },
];

const withValues = (v: Record<string, string>) => (d: Draft): Draft => ({ ...d, values: { ...d.values, ...v } });
const withSettings = (v: Partial<PolicySettings>) => (d: Draft): Draft => ({ ...d, settings: { ...d.settings, ...v } as Settings });

const withNote = (presetId: string) => (d: Draft): Draft => ({ ...d, notes: { ...d.notes, maintenance_note: { presetId, custom: "" } } });
const compose = (...fs: ((d: Draft) => Draft)[]) => (d: Draft) => fs.reduce((acc, f) => f(acc), d);

/** Problems in which several conditions interact. The correct outcome follows from the rules and the prepared readings. */
const CASES: BenchCase[] = [
  {
    id: "p1",
    title: "문제 1 · 기준을 살짝 넘는 압력 · 경계에 걸린 알람",
    traps: [
      "압력 10.4 > 기준 10.0 → 압력 이상",
      "24시간 범위 시작(전날 18:00) 5분 전 알람과 판단 시각 뒤 알람은 제외 → 압력 경고 5회 = 기준 5회",
      "‘압력 경고 해제’, ‘압력 센서 통신 경고’는 다른 유형",
      "정비 기록: 보정 완료, 일시적 튐 1회 → 센서 고장 근거 부족",
    ],
    apply: withValues({ pressure: "10.4" }),
  },
  {
    id: "p2",
    title: "문제 2 · 이른 판단 시각 · 센서 의심 기록",
    traps: [
      "판단 시각 10:00 → 범위는 전날 10:00부터 → 압력 경고 4회로 기준 5회 미달",
      "정비 기록은 센서 이상 정황이 있지만, 알람 반복이 아니므로 결론에 영향 없음",
    ],
    apply: compose(withValues({ evaluation_time: "2026-09-26 10:00" }), withNote("suspect")),
  },
  {
    id: "p3",
    title: "문제 3 · 기준과 같은 압력 · 많은 알람 · 센서 의심",
    traps: ["압력 10.0 = 기준 → 초과가 아니므로 압력 이상 아님", "알람 반복과 센서 이상 정황이 있어도 결론에 영향 없음"],
    apply: compose(withValues({ pressure: "10.0" }), withNote("suspect")),
  },
  {
    id: "p4",
    title: "문제 4 · 좁은 집계 범위 · 낮은 기준 · 센서 의심",
    traps: [
      "집계 범위 16시간 → 02:00 이후만 → 압력 경고 4회",
      "알람 기준 4회 → 반복으로 봄",
      "정비 기록에 센서 이상 정황 → 센서 점검",
    ],
    apply: compose(withSettings({ windowHours: 16, threshold: 4 }), withNote("suspect")),
  },
];

export const EQUIPMENT_SCENARIO: Scenario = {
  id: "equipment",
  name: "설비: 챔버 압력 판단",
  role: "같은 구조를 다른 도메인에 적용",
  disclaimer: DISCLAIMER,
  fields: [
    { kind: "number", key: "pressure", label: "챔버 압력", unit: "Pa", slider: { min: 5, max: 15, step: 0.1 } },
    { kind: "number", key: "pressure_limit", label: "압력 기준값", unit: "Pa" },
    { kind: "text", key: "evaluation_time", label: "판단 시각", hint: "YYYY-MM-DD HH:MM" },
    {
      kind: "lines",
      key: "alarm_history",
      label: "알람 이력",
      hint: "체크한 알람만 반영",
      add: { label: "+ 압력 경고 추가", placeholder: "2026-09-26 16:30", template: (v) => `${v.trim()} 압력 경고` },
    },
    { kind: "note", key: "maintenance_note", label: "정비 기록", hint: "LLM이 읽는 유일한 입력", presets: NOTE_PRESETS },
  ],
  settings: [
    { key: "threshold", label: "알람 기준 횟수", unit: "회 이상", min: 1, max: 20, step: 1 },
    { key: "windowHours", label: "알람 집계 범위", unit: "시간", min: 1, max: 168, step: 1 },
  ],
  defaultSettings: DEFAULT_SETTINGS,
  buildGraph: buildEquipmentGraph,
  functions: EQUIPMENT_FUNCTIONS,
  policyText,
  actions: Object.values(ACTIONS),
  llmOnlyRole: "You decide the action for a piece of equipment by applying the given policy to the given data.",
  exampleDraft: EXAMPLE_DRAFT,
  missions: MISSIONS,
  cases: CASES,
};
