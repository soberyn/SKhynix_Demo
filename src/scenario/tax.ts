// Simplified, public-law-level example of the 1세대1주택 양도소득세 비과세 decision.
// For demonstrating the architecture only: special cases (일시적 2주택, 상생임대 등) and detailed requirements
// are not modelled, and this is not tax advice. It is not the author's actual system or rule set.

import type { RuleFunctions } from "@/core/resolvers";
import type { JudgmentGraph } from "@/core/types";
import type { Draft, Mission, NotePreset, Scenario, Settings } from "./types";

export const TAX_DISCLAIMER =
  "공개된 1세대1주택 비과세 요건을 설명용으로 단순화한 가상 사례입니다. 일시적 2주택·상생임대 등 특례와 세부 요건은 반영하지 않았으며, 세무 자문이 아닙니다.";

export const TAX_ACTIONS = {
  NOT_ONE_HOUSE: "과세 — 1세대1주택 아님",
  HOLDING: "과세 — 보유기간 요건 미충족",
  RESIDENCE: "과세 — 거주요건 미충족",
  EXEMPT_PARTIAL: "비과세 (고가주택 기준 초과분은 과세)",
  EXEMPT: "비과세",
} as const;

export const TAX_DEFAULT_SETTINGS: Settings = { holdYears: 2, highPrice: 12 };

export const RESIDENCE_PRESETS: NotePreset[] = [
  {
    id: "lived",
    label: "계속 거주",
    text: [
      "[전입] 2022-03-20 전입신고, 이후 전출 기록 없음.",
      "[생활] 배우자·자녀와 함께 거주. 관리비·도시가스 요금 본인 명의로 매월 납부.",
      "[참고] 자녀가 2022~2025년 인근 초등학교 재학.",
    ].join("\n"),
    prepared: {
      decision: true,
      confidence: 0.9,
      reason:
        "2022-03-20 전입 후 전출 기록이 없고, 가족이 함께 거주하며 관리비·도시가스 요금을 본인 명의로 납부했습니다. 자녀도 인근 학교에 다녔습니다. 보유 기간 중 2년 이상 실제 거주했다고 볼 근거가 충분합니다.",
      evidence_quotes: ["2022-03-20 전입신고, 이후 전출 기록 없음.", "관리비·도시가스 요금 본인 명의로 매월 납부."],
    },
  },
  {
    id: "rented",
    label: "전출 후 전세 임대",
    text: [
      "[전입] 2022-03-20 전입신고, 2023-02-10 전출.",
      "[임대] 2023-03부터 이 주택을 전세로 임대, 임차인 거주 중.",
      "[생활] 전출 이후 소유자 가족은 다른 시의 직장 근처 아파트에서 거주.",
    ].join("\n"),
    prepared: {
      decision: false,
      confidence: 0.9,
      reason:
        "거주 기간은 2022-03-20부터 2023-02-10까지 약 11개월이고, 이후에는 전세로 임대되어 소유자 가족이 다른 곳에 거주했습니다. 통산 2년 이상 실제 거주했다고 볼 근거가 없습니다.",
      evidence_quotes: ["2022-03-20 전입신고, 2023-02-10 전출.", "2023-03부터 이 주택을 전세로 임대, 임차인 거주 중."],
    },
  },
  {
    id: "split",
    label: "해외 파견 후 재전입",
    text: [
      "[전입] 2022-03-20 전입, 2023-01-05 전출(해외 파견).",
      "[재전입] 2024-11-01 재전입, 2026-09 현재까지 계속 거주 중.",
      "[생활] 파견 기간 중 주택은 임대하지 않고 비워 둠.",
    ].join("\n"),
    prepared: {
      decision: true,
      confidence: 0.75,
      reason:
        "거주 기간은 2022-03-20~2023-01-05(약 9개월)와 2024-11-01~2026-09(약 22개월)로, 통산 2년을 넘습니다. 파견 기간에는 임대하지 않았습니다. 통산 2년 이상 거주 근거가 있다고 봅니다.",
      evidence_quotes: ["2022-03-20 전입, 2023-01-05 전출(해외 파견).", "2024-11-01 재전입, 2026-09 현재까지 계속 거주 중."],
    },
  },
];

export function buildTaxGraph({ holdYears, highPrice }: Settings): JudgmentGraph {
  return {
    decision_node: "tax_decision",
    nodes: [
      {
        id: "one_house",
        label: "1세대 1주택인가?",
        description: "양도일 현재 1세대가 보유한 주택 수를 확인합니다.",
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: { kind: "function", fn: "oneHouse", reads: ["input.house_count"] },
      },
      {
        id: "holding_ok",
        label: `보유기간 ${holdYears}년 이상인가?`,
        description: `취득일부터 양도일까지 ${holdYears}년 이상 보유했는지 날짜로 계산합니다.`,
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: {
          kind: "function",
          fn: "holdingPeriod",
          params: { years: holdYears },
          reads: ["input.acquired", "input.transferred"],
        },
      },
      {
        id: "residence_required",
        label: "거주요건 적용 대상인가?",
        description: "취득 당시 조정대상지역이면 거주요건이 적용됩니다.",
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: { kind: "function", fn: "residenceRequired", reads: ["input.adjusted_area"] },
      },
      {
        id: "residence_evidence",
        label: "2년 거주 근거가 있는가?",
        description: "거주 기록(글)을 읽고 통산 2년 이상 실제 거주 근거가 있는지 판단합니다.",
        dependencies: [],
        resolver_type: "LLM",
        resolver_config: {
          question:
            "제시된 거주 기록에 따르면, 소유자 세대가 이 주택 보유 기간 중 통산 2년 이상 이 주택에 실제로 거주했다고 볼 충분한 근거가 있습니까? " +
            "전입·전출 기간과 실제 거주 정황(임대 여부 등)을 함께 고려하십시오.",
          evidence: ["input.residence_note"],
        },
      },
      {
        id: "high_price",
        label: `${highPrice}억원 초과인가?`,
        description: `양도가액이 ${highPrice}억원을 넘는지 비교합니다.`,
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: { kind: "compare", left: "input.price", op: ">", right: highPrice },
      },
      {
        id: "residence_ok",
        label: "거주요건 충족인가?",
        description: "거주요건이 없거나, 있으면 거주 근거가 있어야 충족입니다.",
        dependencies: ["residence_required", "residence_evidence"],
        resolver_type: "RULE",
        resolver_config: {
          kind: "table",
          rows: [
            { when: { residence_required: false }, then: true },
            { when: { residence_required: true, residence_evidence: true }, then: true },
            { when: { residence_required: true, residence_evidence: false }, then: false },
          ],
        },
      },
      {
        id: "tax_decision",
        label: "과세 여부",
        description: "요건 판단 결과를 정책 표에 대입해 결론을 정합니다.",
        dependencies: ["one_house", "holding_ok", "residence_ok", "high_price"],
        resolver_type: "RULE",
        resolver_config: {
          kind: "table",
          rows: [
            { when: { one_house: false }, then: TAX_ACTIONS.NOT_ONE_HOUSE },
            { when: { holding_ok: false }, then: TAX_ACTIONS.HOLDING },
            { when: { residence_ok: false }, then: TAX_ACTIONS.RESIDENCE },
            { when: { high_price: true }, then: TAX_ACTIONS.EXEMPT_PARTIAL },
            { when: {}, then: TAX_ACTIONS.EXEMPT },
          ],
        },
      },
    ],
  };
}

export function taxPolicyText({ holdYears, highPrice }: Settings): string {
  return [
    `- 양도일 현재 1세대가 보유한 주택이 1채가 아니면: ${TAX_ACTIONS.NOT_ONE_HOUSE}`,
    `- 보유기간(취득일부터 양도일까지)이 ${holdYears}년 미만이면: ${TAX_ACTIONS.HOLDING}`,
    `- 취득 당시 조정대상지역이었고, 보유 기간 중 통산 2년 이상 실제 거주했다고 볼 근거가 없으면: ${TAX_ACTIONS.RESIDENCE}`,
    `- 위 요건을 모두 충족하고 양도가액이 ${highPrice}억원을 넘으면: ${TAX_ACTIONS.EXEMPT_PARTIAL}`,
    `- 그 외: ${TAX_ACTIONS.EXEMPT}`,
  ].join("\n");
}

// ---------- Rule functions ----------

function parseDate(text: string, name: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCMonth() !== +m![2] - 1) throw new Error(`${name} 형식이 올바르지 않습니다: "${text}" (YYYY-MM-DD 형식으로 입력)`);
  return d;
}

/** Whole months and remaining days between two dates. */
function span(from: Date, to: Date): { years: number; months: number; days: number } {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  let days = to.getUTCDate() - from.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
  }
  return { years: Math.floor(months / 12), months: months % 12, days };
}

export const TAX_FUNCTIONS: RuleFunctions = {
  oneHouse(_p, ctx) {
    const n = Number(ctx.input.house_count);
    if (!Number.isInteger(n) || n < 0) throw new Error(`보유 주택 수가 올바르지 않습니다: "${ctx.input.house_count}"`);
    const result = n === 1;
    return { result, explanation: `보유 주택 ${n}채 → ${result ? "예" : "아니오"}`, inputs: { house_count: n } };
  },

  holdingPeriod(params, ctx) {
    const years = Number(params.years);
    const acquired = parseDate(String(ctx.input.acquired), "취득일");
    const transferred = parseDate(String(ctx.input.transferred), "양도일");
    if (transferred < acquired) throw new Error("양도일이 취득일보다 앞섭니다.");
    const required = new Date(Date.UTC(acquired.getUTCFullYear() + years, acquired.getUTCMonth(), acquired.getUTCDate()));
    const result = transferred >= required;
    const p = span(acquired, transferred);
    return {
      result,
      explanation: `${ctx.input.acquired} ~ ${ctx.input.transferred}: ${p.years}년 ${p.months}개월 ${p.days}일 보유 (요건 ${years}년 이상) → ${result ? "예" : "아니오"}`,
      inputs: { acquired: ctx.input.acquired, transferred: ctx.input.transferred, required_years: years },
    };
  },

  residenceRequired(_p, ctx) {
    const v = String(ctx.input.adjusted_area).trim();
    if (v !== "예" && v !== "아니오") throw new Error(`조정대상지역 여부는 예/아니오여야 합니다: "${v}"`);
    const result = v === "예";
    return {
      result,
      explanation: result ? "취득 당시 조정대상지역 → 거주요건 적용" : "취득 당시 비조정지역 → 거주요건 없음",
      inputs: { adjusted_area: v },
    };
  },
};

// ---------- Scenario ----------

const EXAMPLE_DRAFT: Draft = {
  values: { house_count: "1", acquired: "2022-03-15", transferred: "2026-09-20", adjusted_area: "예", price: "9.5" },
  lines: {},
  notes: { residence_note: { presetId: "lived", custom: "" } },
  settings: TAX_DEFAULT_SETTINGS,
};

const MISSIONS: Mission[] = [
  {
    id: "transfer-date",
    title: "양도일을 앞당기면?",
    what: "양도일을 2026-09-20 → 2024-02-20으로 바꿨습니다 (보유 1년 11개월).",
    apply: (d) => ({ draft: { ...d, values: { ...d.values, transferred: "2024-02-20" } } }),
    benefit: "결론이 바뀐 이유가 ‘보유기간’ 한 단계로 추적됩니다. 날짜 계산은 규칙이 정확히 하고, 거주 기록은 그대로라 LLM은 다시 부르지 않았습니다.",
    llmOnly: "LLM 단독이라면 전체를 다시 묻고, 날짜 계산이 맞는지와 무엇이 바뀌었는지를 설명문에서 직접 확인해야 합니다.",
  },
  {
    id: "override",
    title: "세무 전문가가 거주 판단을 달리 본다면?",
    what: "‘2년 거주 근거가 있는가?’를 사람이 ‘아니오’로 지정했습니다.",
    apply: (d) => ({ draft: d, overrides: { residence_evidence: { result: false, note: "세무 전문가가 자료 검토 후 ‘아니오’로 지정" } } }),
    benefit: "LLM의 판단 하나만 사람이 고쳤고, 그 결과에 의존하는 거주요건과 결론만 다시 정해졌습니다. 누가 무엇을 고쳤는지 판단과정에 남습니다.",
    llmOnly: "LLM 단독이라면 결론 전체에 반박하고, 새 결론이 전문가 의견을 제대로 반영했는지 다시 읽어 확인해야 합니다.",
  },
  {
    id: "policy",
    title: "고가주택 기준이 9억이라면?",
    what: "규칙 값 ‘고가주택 기준’을 12억 → 9억원으로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, settings: { ...d.settings, highPrice: 9 } } }),
    benefit: "바뀐 기준은 그 기준을 쓰는 규칙 단계 하나에만 반영됩니다. 같은 입력이면 언제나 같은 결과이고, LLM은 부르지 않았습니다.",
    llmOnly: "LLM 단독이라면 정책 문장을 고쳐 다시 묻고, 새 기준을 정확히 적용했는지 설명문을 읽어 확인해야 합니다.",
  },
  {
    id: "note",
    title: "거주 기록이 다르면?",
    what: "거주 기록을 ‘전출 후 전세 임대’로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, notes: { ...d.notes, residence_note: { presetId: "rented", custom: "" } } } }),
    benefit: "LLM 단계는 바뀐 거주 기록을 읽는 그 한 단계만 다시 실행되었고, 주택 수·보유기간·가격 판단은 재사용되었습니다.",
    llmOnly: "LLM 단독이라면 기록 하나만 바뀌어도 모든 요건을 처음부터 다시 판단합니다.",
  },
];

export const TAX_SCENARIO: Scenario = {
  id: "tax",
  name: "세무: 1세대1주택 비과세 판단",
  role: "원래 문제 (단순화한 공개 법령 수준)",
  disclaimer: TAX_DISCLAIMER,
  fields: [
    { kind: "number", key: "house_count", label: "보유 주택 수", unit: "채 (양도일 현재, 1세대 기준)" },
    { kind: "text", key: "acquired", label: "취득일", hint: "YYYY-MM-DD" },
    { kind: "text", key: "transferred", label: "양도일", hint: "YYYY-MM-DD" },
    { kind: "toggle", key: "adjusted_area", label: "취득 당시 조정대상지역", hint: "예이면 거주요건 적용" },
    { kind: "number", key: "price", label: "양도가액", unit: "억원", slider: { min: 1, max: 30, step: 0.5 } },
    { kind: "note", key: "residence_note", label: "거주 기록", hint: "LLM이 읽는 유일한 입력", presets: RESIDENCE_PRESETS },
  ],
  settings: [
    { key: "holdYears", label: "보유기간 요건", unit: "년 이상", min: 1, max: 5, step: 1 },
    { key: "highPrice", label: "고가주택 기준", unit: "억원 초과", min: 5, max: 20, step: 1 },
  ],
  defaultSettings: TAX_DEFAULT_SETTINGS,
  buildGraph: buildTaxGraph,
  functions: TAX_FUNCTIONS,
  policyText: taxPolicyText,
  actions: Object.values(TAX_ACTIONS),
  llmOnlyRole: "You decide whether a home sale qualifies for the one-house capital gains tax exemption by applying the given simplified policy to the given data.",
  exampleDraft: EXAMPLE_DRAFT,
  missions: MISSIONS,
};
