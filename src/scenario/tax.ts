// Simplified, public-law-level example of the 1세대1주택 양도소득세 비과세 decision.
// For demonstrating the architecture only: special cases (일시적 2주택, 상생임대 등) and detailed requirements
// are not modelled, and this is not tax advice. It is not the author's actual system or rule set.
//
// The inputs are deliberately record-like (a household's house list, a move-in/move-out history), as in real work:
// rules count and compute exactly; the LLM only reads the free-text circumstances.

import type { RuleFunctions } from "@/core/resolvers";
import type { JudgmentGraph } from "@/core/types";
import type { BenchCase, Draft, Mission, NotePreset, Scenario, Settings } from "./types";

export const TAX_DISCLAIMER =
  "공개된 1세대1주택 비과세 요건을 설명용으로 단순화한 가상 사례입니다. 일시적 2주택·상생임대 등 특례와 세부 요건은 반영하지 않았으며, 세무 자문이 아닙니다.";

export const TAX_ACTIONS = {
  NOT_ONE_HOUSE: "과세 — 1세대1주택 아님",
  HOLDING: "과세 — 보유기간 요건 미충족",
  RESIDENCE: "과세 — 거주요건 미충족",
  EXEMPT_PARTIAL: "비과세 (고가주택 기준 초과분은 과세)",
  EXEMPT: "비과세",
} as const;

export const TAX_DEFAULT_SETTINGS: Settings = { holdYears: 2, resYears: 2, highPrice: 12 };

/** Other houses of the household (the house being sold is not listed). Unchecked lines are extra cases. */
export const HOUSEHOLD_LINES = [
  { text: "배우자 · B오피스텔(주거용) · 취득 2019-05-10 · 양도 2024-12-01", on: true },
  { text: "자녀(별도 세대) · C빌라 · 취득 2023-07-01 · 보유 중", on: true },
  { text: "배우자 · D주택 · 취득 2020-02-01 · 양도 2026-10-15", on: false },
  { text: "본인 · E아파트 · 취득 2026-08-01 · 보유 중", on: false },
];

/** Move-in / move-out history of the house being sold. */
export const MOVE_LINES = [
  { text: "2022-03-20 전입", on: true },
  { text: "2023-01-05 전출", on: true },
  { text: "2024-11-01 전입", on: true },
  { text: "2025-06-30 전출", on: true },
  { text: "2025-09-01 전입", on: true },
];

export const RESIDENCE_PRESETS: NotePreset[] = [
  {
    id: "lived",
    label: "가족 거주, 파견 중 비워 둠",
    text: [
      "[생활] 배우자·자녀와 함께 거주. 관리비·도시가스 요금 본인 명의로 매월 납부.",
      "[참고] 2023~2024년 해외 파견 기간에는 주택을 임대하지 않고 비워 둠.",
    ].join("\n"),
    prepared: {
      decision: false,
      confidence: 0.85,
      reason:
        "가족이 함께 거주하며 관리비·도시가스 요금을 본인 명의로 납부했고, 파견 기간에도 임대하지 않았습니다. 실거주를 부정하는 정황은 없습니다.",
      evidence_quotes: ["배우자·자녀와 함께 거주.", "해외 파견 기간에는 주택을 임대하지 않고 비워 둠."],
    },
  },
  {
    id: "rented",
    label: "전입 유지한 채 전세 임대",
    text: [
      "[임대] 2025-09부터 이 주택을 전세로 임대, 임차인이 거주 중.",
      "[생활] 그 기간 소유자 가족은 직장 근처 다른 도시에 거주. 주민등록은 이 주택에 유지.",
    ].join("\n"),
    prepared: {
      decision: true,
      confidence: 0.9,
      reason:
        "2025-09부터 전세로 임대되어 임차인이 거주하고, 소유자 가족은 다른 도시에 살았습니다. 주민등록만 유지한 것이어서 실거주를 부정하는 정황이 있습니다.",
      evidence_quotes: ["2025-09부터 이 주택을 전세로 임대, 임차인이 거주 중.", "주민등록은 이 주택에 유지."],
    },
  },
  {
    id: "weekday",
    label: "본인만 평일 타지 근무",
    text: [
      "[생활] 소유자는 평일 지방 근무로 회사 숙소 생활, 주말마다 귀가.",
      "[생활] 배우자·자녀는 이 주택에 계속 거주.",
    ].join("\n"),
    prepared: {
      decision: false,
      confidence: 0.75,
      reason: "소유자 본인만 평일에 타지에서 지내고 주말마다 귀가하며, 배우자·자녀는 계속 거주했습니다. 세대가 실제로 거주한 것으로 보여 실거주를 부정하는 정황은 없습니다.",
      evidence_quotes: ["주말마다 귀가.", "배우자·자녀는 이 주택에 계속 거주."],
    },
  },
];

export function buildTaxGraph({ holdYears, resYears, highPrice }: Settings): JudgmentGraph {
  return {
    decision_node: "tax_decision",
    nodes: [
      {
        id: "one_house",
        label: "1세대 1주택인가?",
        description: "양도일 현재 같은 세대가 보유한 다른 주택이 있는지 목록에서 셉니다.",
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: { kind: "function", fn: "householdHouses", reads: ["input.household", "input.transferred"] },
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
        id: "residence_period",
        label: `통산 거주 ${resYears}년 이상인가?`,
        description: "전입·전출 이력에서 보유 기간 중 거주 일수를 통산합니다.",
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: {
          kind: "function",
          fn: "residencePeriod",
          params: { years: resYears },
          reads: ["input.moves", "input.acquired", "input.transferred"],
        },
      },
      {
        id: "residence_doubt",
        label: "실거주를 부정하는 정황이 있는가?",
        description: "생활 기록(글)을 읽고 전입 기간 중 실제로 살지 않았다고 볼 정황이 있는지 판단합니다.",
        dependencies: [],
        resolver_type: "LLM",
        resolver_config: {
          question:
            "생활 기록에, 주민등록상 거주 기간 중 소유자 세대가 실제로는 이 주택에 살지 않았다고 볼 정황(임대, 세대 전체의 타지 거주 등)이 있습니까? " +
            "세대원 일부만 잠시 떨어져 지낸 경우는 해당하지 않습니다.",
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
        description: "거주요건 대상이면, 통산 거주기간을 채우고 실거주를 부정하는 정황이 없어야 충족입니다.",
        dependencies: ["residence_required", "residence_period", "residence_doubt"],
        resolver_type: "RULE",
        resolver_config: {
          kind: "table",
          rows: [
            { when: { residence_required: false }, then: true },
            { when: { residence_period: false }, then: false },
            { when: { residence_doubt: true }, then: false },
            { when: {}, then: true },
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

export function taxPolicyText({ holdYears, resYears, highPrice }: Settings): string {
  return [
    `- 양도일 현재 같은 세대(별도 세대는 제외)가 양도 대상 주택 외에 다른 주택을 보유하고 있으면: ${TAX_ACTIONS.NOT_ONE_HOUSE}`,
    "  (양도일 이전에 이미 양도한 주택은 보유 주택이 아니고, 양도일 이후에 양도하는 주택은 양도일 현재 보유 주택입니다.)",
    `- 보유기간(취득일부터 양도일까지)이 ${holdYears}년 미만이면: ${TAX_ACTIONS.HOLDING}`,
    `- 취득 당시 조정대상지역이었고, 보유 기간 중 전입~전출 기간을 통산한 거주기간이 ${resYears}년(${resYears * 365}일) 미만이거나, 실거주를 부정하는 정황(임대, 세대 전체의 타지 거주 등)이 있으면: ${TAX_ACTIONS.RESIDENCE}`,
    "  (마지막 전입 후 전출 기록이 없으면 양도일까지 거주한 것으로 봅니다.)",
    `- 위 요건을 모두 충족하고 양도가액이 ${highPrice}억원을 넘으면: ${TAX_ACTIONS.EXEMPT_PARTIAL}`,
    `- 그 외: ${TAX_ACTIONS.EXEMPT}`,
  ].join("\n");
}

// ---------- Rule functions ----------

const DAY = 86_400_000;

function parseDate(text: string, name: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCMonth() !== +m![2] - 1) throw new Error(`${name} 형식이 올바르지 않습니다: "${text}" (YYYY-MM-DD 형식으로 입력)`);
  return d;
}

const lines = (text: unknown) =>
  String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

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

const HOUSE_LINE = /^(.+?) · (.+?) · 취득 (\d{4}-\d{2}-\d{2}) · (보유 중|양도 (\d{4}-\d{2}-\d{2}))$/;

export const TAX_FUNCTIONS: RuleFunctions = {
  householdHouses(_p, ctx) {
    const transferred = parseDate(String(ctx.input.transferred), "양도일");
    const counted: string[] = [];
    const excluded: string[] = [];
    for (const line of lines(ctx.input.household)) {
      const m = HOUSE_LINE.exec(line);
      if (!m) throw new Error(`주택 목록 줄을 읽을 수 없습니다: "${line}" (소유자 · 주택 · 취득 YYYY-MM-DD · 보유 중|양도 YYYY-MM-DD)`);
      const acquired = parseDate(m[3], "주택 취득일");
      const sold = m[5] ? parseDate(m[5], "주택 양도일") : null;
      if (m[1].includes("별도 세대")) excluded.push(`${line}  (별도 세대)`);
      else if (acquired > transferred) excluded.push(`${line}  (양도일 이후 취득)`);
      else if (sold && sold <= transferred) excluded.push(`${line}  (양도일 전에 처분)`);
      else counted.push(line);
    }
    const result = counted.length === 0;
    return {
      result,
      explanation: `양도일 현재 같은 세대의 다른 주택 ${counted.length}채 → ${result ? "예 (1주택)" : "아니오"}`,
      inputs: { transferred: ctx.input.transferred, other_houses: counted.length },
      evidence: [...counted.map((l) => `보유: ${l}`), ...excluded.map((l) => `제외: ${l}`)],
    };
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

  residencePeriod(params, ctx) {
    const years = Number(params.years);
    const acquired = parseDate(String(ctx.input.acquired), "취득일");
    const transferred = parseDate(String(ctx.input.transferred), "양도일");
    const events = lines(ctx.input.moves).map((line) => {
      const m = /^(\d{4}-\d{2}-\d{2}) (전입|전출)$/.exec(line);
      if (!m) throw new Error(`전입·전출 줄을 읽을 수 없습니다: "${line}" (YYYY-MM-DD 전입|전출)`);
      return { date: parseDate(m[1], "전입·전출일"), kind: m[2], line };
    });
    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    const periods: string[] = [];
    let total = 0;
    let since: Date | null = null;
    const close = (end: Date, note: string) => {
      const from = since! < acquired ? acquired : since!;
      const to = end > transferred ? transferred : end;
      const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY));
      total += days;
      periods.push(`${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}${note}: ${days}일`);
      since = null;
    };
    for (const e of events) {
      if (e.kind === "전입" && !since) since = e.date;
      else if (e.kind === "전출" && since) close(e.date, "");
    }
    if (since) close(transferred, " (양도일까지)");

    const required = years * 365;
    const result = total >= required;
    const y = Math.floor(total / 365);
    return {
      result,
      explanation: `보유 기간 중 통산 거주 ${total}일 (약 ${y}년 ${Math.floor((total - y * 365) / 30.4)}개월, 요건 ${required}일 이상) → ${result ? "예" : "아니오"}`,
      inputs: { transferred: ctx.input.transferred, residence_days: total, required_days: required },
      evidence: periods,
    };
  },
};

// ---------- Scenario ----------

const EXAMPLE_DRAFT: Draft = {
  values: { acquired: "2022-03-15", transferred: "2026-09-20", adjusted_area: "예", price: "9.5" },
  lines: { household: HOUSEHOLD_LINES, moves: MOVE_LINES },
  notes: { residence_note: { presetId: "lived", custom: "" } },
  settings: TAX_DEFAULT_SETTINGS,
};

const withValues = (v: Record<string, string>) => (d: Draft): Draft => ({ ...d, values: { ...d.values, ...v } });
const withNote = (presetId: string) => (d: Draft): Draft => ({ ...d, notes: { ...d.notes, residence_note: { presetId, custom: "" } } });

const MISSIONS: Mission[] = [
  {
    id: "transfer-date",
    title: "양도일을 앞당기면?",
    what: "양도일을 2026-09-20 → 2025-12-01로 바꿨습니다.",
    apply: (d) => ({ draft: withValues({ transferred: "2025-12-01" })(d) }),
    benefit: "결론이 바뀐 이유가 ‘통산 거주기간’ 단계로 추적됩니다. 거주 일수는 규칙이 이력에서 정확히 통산하고, 생활 기록은 그대로라 LLM은 다시 부르지 않았습니다.",
    llmOnly: "LLM 단독이라면 전입·전출 이력을 스스로 다시 통산해야 하고, 그 계산이 맞는지는 설명문을 읽어 확인해야 합니다.",
  },
  {
    id: "override",
    title: "세무 전문가가 실거주 정황을 문제 삼는다면?",
    what: "‘실거주를 부정하는 정황이 있는가?’를 사람이 ‘예’로 지정했습니다.",
    apply: (d) => ({ draft: d, overrides: { residence_doubt: { result: true, note: "세무 전문가가 자료 검토 후 ‘예’로 지정" } } }),
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
    title: "생활 기록이 다르면?",
    what: "생활 기록을 ‘전입 유지한 채 전세 임대’로 바꿨습니다.",
    apply: (d) => ({ draft: withNote("rented")(d) }),
    benefit: "LLM 단계는 바뀐 생활 기록을 읽는 그 한 단계만 다시 실행되었고, 주택 수·보유기간·거주 일수 판단은 재사용되었습니다.",
    llmOnly: "LLM 단독이라면 기록 하나만 바뀌어도 모든 요건을 처음부터 다시 판단합니다.",
  },
];

const setLines = (key: string, texts: string[]) => (d: Draft): Draft => ({
  ...d,
  lines: { ...d.lines, [key]: texts.map((text) => ({ text, on: true })) },
});
const compose = (...fs: ((d: Draft) => Draft)[]) => (d: Draft) => fs.reduce((acc, f) => f(acc), d);

/** Problems in which several conditions interact. The correct outcome follows from the rules and the prepared readings. */
const CASES: BenchCase[] = [
  {
    id: "p1",
    title: "문제 1 · 처분 직전 주택 · 고가 · 평일 타지 근무",
    traps: [
      "배우자 D주택을 양도일 열흘 전(2026-09-10)에 처분 → 양도일 현재 보유 아님",
      "자녀 C빌라는 별도 세대 → 주택 수에서 제외",
      "전입·전출이 세 구간으로 끊겨 있음 → 통산 916일",
      "본인만 평일 타지 근무, 가족은 거주 → 실거주 부정 정황 아님",
      "양도가액 12.5억 → 고가주택 기준 초과",
    ],
    apply: compose(
      setLines("household", [
        "배우자 · B오피스텔(주거용) · 취득 2019-05-10 · 양도 2024-12-01",
        "자녀(별도 세대) · C빌라 · 취득 2023-07-01 · 보유 중",
        "배우자 · D주택 · 취득 2020-02-01 · 양도 2026-09-10",
      ]),
      withValues({ price: "12.5" }),
      withNote("weekday"),
    ),
  },
  {
    id: "p2",
    title: "문제 2 · 양도일 이후 취득 · 거주 기록 끊김",
    traps: [
      "본인 E아파트는 양도일 닷새 뒤(2026-09-25) 취득 → 양도일 현재 보유 아님",
      "2024-11 ~ 2025-06 거주 기록 없음 → 통산 675일로 2년(730일) 미달",
      "취득 당시 조정대상지역 → 거주요건 적용",
    ],
    apply: compose(
      setLines("household", [
        "배우자 · B오피스텔(주거용) · 취득 2019-05-10 · 양도 2024-12-01",
        "자녀(별도 세대) · C빌라 · 취득 2023-07-01 · 보유 중",
        "본인 · E아파트 · 취득 2026-09-25 · 보유 중",
      ]),
      setLines("moves", ["2022-03-20 전입", "2023-01-05 전출", "2025-09-01 전입"]),
    ),
  },
  {
    id: "p3",
    title: "문제 3 · 양도일 뒤에 처분하는 주택 · 고가",
    traps: [
      "배우자 D주택을 양도일 이후(2026-10-15)에 처분 → 양도일 현재 보유 중 → 1세대 1주택 아님",
      "거주요건·보유기간은 모두 충족하지만 결론에는 영향 없음",
      "양도가액 13억 (고가) → 1주택이 아니므로 무관",
    ],
    apply: compose(
      setLines("household", [
        "배우자 · B오피스텔(주거용) · 취득 2019-05-10 · 양도 2024-12-01",
        "자녀(별도 세대) · C빌라 · 취득 2023-07-01 · 보유 중",
        "배우자 · D주택 · 취득 2020-02-01 · 양도 2026-10-15",
      ]),
      withValues({ price: "13" }),
    ),
  },
  {
    id: "p4",
    title: "문제 4 · 비조정지역 · 짧은 거주 · 임대 정황",
    traps: [
      "취득 당시 비조정지역 → 거주요건 없음",
      "통산 거주 291일, 전세 임대 정황 → 거주요건이 없으므로 결론에 영향 없음",
      "양도가액 11.5억 → 12억 이하",
    ],
    apply: compose(
      withValues({ adjusted_area: "아니오", price: "11.5" }),
      setLines("moves", ["2022-03-20 전입", "2023-01-05 전출"]),
      withNote("rented"),
    ),
  },
];

export const TAX_SCENARIO: Scenario = {
  id: "tax",
  name: "세무: 1세대1주택 비과세 판단",
  role: "원래 문제 (단순화한 공개 법령 수준)",
  disclaimer: TAX_DISCLAIMER,
  fields: [
    {
      kind: "lines",
      key: "household",
      label: "세대 보유 주택 (양도 대상 외)",
      hint: "체크한 줄만 반영",
      add: {
        label: "+ 주택 추가",
        placeholder: "본인 · 새 주택 · 취득 2025-01-01 · 보유 중",
        template: (v) => v.trim(),
      },
    },
    { kind: "text", key: "acquired", label: "양도 대상 취득일", hint: "YYYY-MM-DD" },
    { kind: "text", key: "transferred", label: "양도일", hint: "YYYY-MM-DD" },
    { kind: "toggle", key: "adjusted_area", label: "취득 당시 조정대상지역", hint: "예이면 거주요건 적용" },
    {
      kind: "lines",
      key: "moves",
      label: "전입·전출 이력",
      hint: "체크한 줄만 반영",
      add: { label: "+ 이력 추가", placeholder: "2026-01-10 전출", template: (v) => v.trim() },
    },
    { kind: "number", key: "price", label: "양도가액", unit: "억원", slider: { min: 1, max: 30, step: 0.5 } },
    { kind: "note", key: "residence_note", label: "생활 기록", hint: "LLM이 읽는 유일한 입력", presets: RESIDENCE_PRESETS },
  ],
  settings: [
    { key: "holdYears", label: "보유기간 요건", unit: "년 이상", min: 1, max: 5, step: 1 },
    { key: "resYears", label: "거주기간 요건", unit: "년 이상", min: 1, max: 5, step: 1 },
    { key: "highPrice", label: "고가주택 기준", unit: "억원 초과", min: 5, max: 20, step: 1 },
  ],
  defaultSettings: TAX_DEFAULT_SETTINGS,
  buildGraph: buildTaxGraph,
  functions: TAX_FUNCTIONS,
  policyText: taxPolicyText,
  actions: Object.values(TAX_ACTIONS),
  llmOnlyRole:
    "You decide whether a home sale qualifies for the one-house capital gains tax exemption by applying the given simplified policy to the given data.",
  exampleDraft: EXAMPLE_DRAFT,
  missions: MISSIONS,
  cases: CASES,
};
