import { describe, expect, it } from "vitest";
import { runGraph } from "@/core/engine";
import { MockLLM } from "@/core/mock-llm";
import { validateGraph } from "@/core/validate";
import { RESIDENCE_PRESETS, TAX_ACTIONS, TAX_FUNCTIONS, TAX_SCENARIO, buildTaxGraph } from "./tax";
import { llmOnlyKey, preparedFor, toInput, type Draft } from "./types";

const residence = (lived: boolean) => new MockLLM(() => ({ decision: lived, reason: "mock", evidence_quotes: [] }));
const judge = (d: Draft, lived = true) =>
  runGraph(buildTaxGraph(d.settings), toInput(TAX_SCENARIO, d), { functions: TAX_FUNCTIONS, llm: residence(lived) });
const example = TAX_SCENARIO.exampleDraft;
const withValues = (v: Record<string, string>): Draft => ({ ...example, values: { ...example.values, ...v } });

describe("tax scenario (simplified 1세대1주택 비과세)", () => {
  it("is a valid DAG with three levels", () => {
    expect(validateGraph(buildTaxGraph(TAX_SCENARIO.defaultSettings))).toEqual([]);
  });

  it("example → 비과세, with node-level results", async () => {
    const r = await judge(example);
    expect(r.decision).toBe(TAX_ACTIONS.EXEMPT);
    expect(r.states.one_house.output?.explanation).toBe("보유 주택 1채 → 예");
    expect(r.states.holding_ok.output?.explanation).toBe("2022-03-15 ~ 2026-09-20: 4년 6개월 5일 보유 (요건 2년 이상) → 예");
    expect(r.states.residence_required.output?.explanation).toBe("취득 당시 조정대상지역 → 거주요건 적용");
    expect(r.states.high_price.output?.result).toBe(false);
  });

  describe("holding period boundary", () => {
    it.each([
      ["exactly 2 years", "2024-03-15", true],
      ["one day short", "2024-03-14", false],
      ["mission date (1y 11m)", "2024-02-20", false],
    ])("%s", async (_n, transferred, ok) => {
      const r = await judge(withValues({ transferred }));
      expect(r.states.holding_ok.output?.result).toBe(ok);
    });

    it("fails on an invalid date and blocks the decision", async () => {
      const r = await judge(withValues({ transferred: "2026-02-30" }));
      expect(r.states.holding_ok.status).toBe("FAILED");
      expect(r.states.tax_decision.status).toBe("BLOCKED");
    });

    it("fails when the transfer is before the acquisition", async () => {
      const r = await judge(withValues({ transferred: "2021-01-01" }));
      expect(r.states.holding_ok.error).toMatch(/앞섭니다/);
    });
  });

  describe("policy table", () => {
    it.each([
      ["two houses", withValues({ house_count: "2" }), true, TAX_ACTIONS.NOT_ONE_HOUSE],
      ["held too short", withValues({ transferred: "2024-02-20" }), true, TAX_ACTIONS.HOLDING],
      ["adjusted area, no residence evidence", example, false, TAX_ACTIONS.RESIDENCE],
      ["non-adjusted area, no residence evidence", withValues({ adjusted_area: "아니오" }), false, TAX_ACTIONS.EXEMPT],
      ["over the high-price threshold", withValues({ price: "15" }), true, TAX_ACTIONS.EXEMPT_PARTIAL],
      ["price equal to the threshold is not over it", withValues({ price: "12" }), true, TAX_ACTIONS.EXEMPT],
      ["all requirements met", example, true, TAX_ACTIONS.EXEMPT],
    ])("%s", async (_n, d, lived, expected) => {
      expect((await judge(d, lived)).decision).toBe(expected);
    });
  });

  it("the LLM only reads the residence records", async () => {
    const llm = residence(true);
    await runGraph(buildTaxGraph(example.settings), toInput(TAX_SCENARIO, example), { functions: TAX_FUNCTIONS, llm });
    expect(Object.keys(llm.calls[0].evidence)).toEqual(["input.residence_note"]);
  });

  describe("missions", () => {
    const outcome = async (id: string, lived = true) => {
      const m = TAX_SCENARIO.missions.find((x) => x.id === id)!;
      const { draft, overrides } = m.apply(example);
      const llm = residence(lived);
      const first = await runGraph(buildTaxGraph(example.settings), toInput(TAX_SCENARIO, example), { functions: TAX_FUNCTIONS, llm });
      const second = await runGraph(buildTaxGraph(draft.settings), toInput(TAX_SCENARIO, draft), {
        functions: TAX_FUNCTIONS,
        llm,
        previous: first,
        overrides,
      });
      return second;
    };

    it("earlier transfer date → 보유기간 미충족, no LLM call", async () => {
      const r = await outcome("transfer-date");
      expect(r.decision).toBe(TAX_ACTIONS.HOLDING);
      expect(r.llmCalls).toBe(0);
    });

    it("expert override on residence → 거주요건 미충족, no LLM call", async () => {
      const r = await outcome("override");
      expect(r.decision).toBe(TAX_ACTIONS.RESIDENCE);
      expect(r.llmCalls).toBe(0);
      expect(r.states.residence_evidence.output?.human).toBeDefined();
    });

    it("high-price threshold 9억 → 초과분 과세, only the price rule recomputed", async () => {
      const r = await outcome("policy");
      expect(r.decision).toBe(TAX_ACTIONS.EXEMPT_PARTIAL);
      expect(r.states.high_price.reused).toBeFalsy();
      expect(r.states.holding_ok.reused).toBe(true);
      expect(r.llmCalls).toBe(0);
    });

    it("different residence records → the LLM step runs again", async () => {
      const r = await outcome("note", false);
      expect(r.llmCalls).toBe(1);
      expect(r.states.one_house.reused).toBe(true);
    });
  });

  it("prepared answers exist for each residence preset and agree with the intended reading", () => {
    for (const p of RESIDENCE_PRESETS) expect(preparedFor(TAX_SCENARIO, p.text)).toBe(p.prepared);
    expect(RESIDENCE_PRESETS.map((p) => [p.id, p.prepared.decision])).toEqual([
      ["lived", true],
      ["rented", false],
      ["split", true],
    ]);
  });

  it("LLM-only keys differ by scenario and input", () => {
    const a = llmOnlyKey(TAX_SCENARIO, toInput(TAX_SCENARIO, example), example.settings);
    const b = llmOnlyKey(TAX_SCENARIO, toInput(TAX_SCENARIO, withValues({ price: "13" })), example.settings);
    expect(a).not.toBe(b);
    expect(JSON.parse(a).s).toBe("tax");
  });
});
