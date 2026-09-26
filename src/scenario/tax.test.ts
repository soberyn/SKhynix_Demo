import { describe, expect, it } from "vitest";
import { runGraph } from "@/core/engine";
import { MockLLM } from "@/core/mock-llm";
import { validateGraph } from "@/core/validate";
import { RESIDENCE_PRESETS, TAX_ACTIONS, TAX_FUNCTIONS, TAX_SCENARIO, buildTaxGraph } from "./tax";
import { llmOnlyKey, preparedFor, toInput, type Draft } from "./types";

/** The LLM node answers "is there evidence against actual residence?" */
const doubt = (yes: boolean) => new MockLLM(() => ({ decision: yes, reason: "mock", evidence_quotes: [] }));
const judge = (d: Draft, doubtful = false) =>
  runGraph(buildTaxGraph(d.settings), toInput(TAX_SCENARIO, d), { functions: TAX_FUNCTIONS, llm: doubt(doubtful) });
const example = TAX_SCENARIO.exampleDraft;
const withValues = (v: Record<string, string>): Draft => ({ ...example, values: { ...example.values, ...v } });
const withLines = (key: string, lines: string[]): Draft => ({ ...example, lines: { ...example.lines, [key]: lines.map((text) => ({ text, on: true })) } });

describe("tax scenario (simplified 1세대1주택 비과세, record-heavy inputs)", () => {
  it("is a valid DAG", () => {
    expect(validateGraph(buildTaxGraph(TAX_SCENARIO.defaultSettings))).toEqual([]);
  });

  it("example → 비과세, with node-level results", async () => {
    const r = await judge(example);
    expect(r.decision).toBe(TAX_ACTIONS.EXEMPT);
    expect(r.states.one_house.output?.explanation).toBe("양도일 현재 같은 세대의 다른 주택 0채 → 예 (1주택)");
    expect(r.states.residence_period.output?.explanation).toBe("보유 기간 중 통산 거주 916일 (약 2년 6개월, 요건 730일 이상) → 예");
  });

  describe("household houses on the transfer date", () => {
    it("excludes a separate household and houses sold before the transfer", async () => {
      const ev = (await judge(example)).states.one_house.output?.evidence ?? [];
      expect(ev).toContain("제외: 자녀(별도 세대) · C빌라 · 취득 2023-07-01 · 보유 중  (별도 세대)");
      expect(ev).toContain("제외: 배우자 · B오피스텔(주거용) · 취득 2019-05-10 · 양도 2024-12-01  (양도일 전에 처분)");
    });

    it.each([
      ["sold after the transfer date counts", ["배우자 · D주택 · 취득 2020-02-01 · 양도 2026-10-15"], false],
      ["sold on the transfer date does not count", ["배우자 · D주택 · 취득 2020-02-01 · 양도 2026-09-20"], true],
      ["bought after the transfer date does not count", ["본인 · E아파트 · 취득 2026-10-01 · 보유 중"], true],
    ])("%s", async (_n, lines, oneHouse) => {
      expect((await judge(withLines("household", lines))).states.one_house.output?.result).toBe(oneHouse);
    });

    it("fails on an unreadable line", async () => {
      const r = await judge(withLines("household", ["배우자 D주택 2020"]));
      expect(r.states.one_house.status).toBe("FAILED");
      expect(r.states.tax_decision.status).toBe("BLOCKED");
    });
  });

  describe("residence period from the move history", () => {
    it("sums stays inside the holding period; an open stay runs to the transfer date", async () => {
      const ev = (await judge(example)).states.residence_period.output?.evidence ?? [];
      expect(ev).toEqual([
        "2022-03-20 ~ 2023-01-05: 291일",
        "2024-11-01 ~ 2025-06-30: 241일",
        "2025-09-01 ~ 2026-09-20 (양도일까지): 384일",
      ]);
    });

    it("clips a stay that started before the acquisition", async () => {
      const r = await judge(withLines("moves", ["2021-01-01 전입"]));
      expect(r.states.residence_period.output?.evidence).toEqual(["2022-03-15 ~ 2026-09-20 (양도일까지): 1650일"]);
    });

    it.each([
      ["exactly 730 days", ["2024-09-20 전입"], true],
      ["729 days", ["2024-09-21 전입"], false],
    ])("%s", async (_n, moves, ok) => {
      expect((await judge(withLines("moves", moves))).states.residence_period.output?.result).toBe(ok);
    });
  });

  it("holding period boundary: exactly 2 years vs one day short", async () => {
    const noOthers = (t: string) => ({ ...withValues({ transferred: t }), lines: { ...example.lines, household: [] } });
    expect((await judge(noOthers("2024-03-15"))).states.holding_ok.output?.result).toBe(true);
    expect((await judge(noOthers("2024-03-14"))).decision).toBe(TAX_ACTIONS.HOLDING);
  });

  describe("residence requirement", () => {
    it("evidence against actual residence fails it", async () => {
      expect((await judge(example, true)).decision).toBe(TAX_ACTIONS.RESIDENCE);
    });
    it("is not applied outside an adjusted area", async () => {
      expect((await judge(withValues({ adjusted_area: "아니오" }), true)).decision).toBe(TAX_ACTIONS.EXEMPT);
    });
  });

  it("the LLM only reads the circumstances text", async () => {
    const llm = doubt(false);
    await runGraph(buildTaxGraph(example.settings), toInput(TAX_SCENARIO, example), { functions: TAX_FUNCTIONS, llm });
    expect(Object.keys(llm.calls[0].evidence)).toEqual(["input.residence_note"]);
  });

  describe("missions", () => {
    const outcome = async (id: string, doubtful = false) => {
      const m = TAX_SCENARIO.missions.find((x) => x.id === id)!;
      const { draft, overrides } = m.apply(example);
      const llm = doubt(doubtful);
      const first = await runGraph(buildTaxGraph(example.settings), toInput(TAX_SCENARIO, example), { functions: TAX_FUNCTIONS, llm });
      return runGraph(buildTaxGraph(draft.settings), toInput(TAX_SCENARIO, draft), { functions: TAX_FUNCTIONS, llm, previous: first, overrides });
    };

    it("earlier transfer date → 거주요건 미충족 (623 days), no LLM call", async () => {
      const r = await outcome("transfer-date");
      expect(r.decision).toBe(TAX_ACTIONS.RESIDENCE);
      expect(r.llmCalls).toBe(0);
    });

    it("expert override → 거주요건 미충족, no LLM call", async () => {
      const r = await outcome("override");
      expect(r.decision).toBe(TAX_ACTIONS.RESIDENCE);
      expect(r.llmCalls).toBe(0);
    });

    it("high-price threshold 9억 → 초과분 과세, only the price rule recomputed", async () => {
      const r = await outcome("policy");
      expect(r.decision).toBe(TAX_ACTIONS.EXEMPT_PARTIAL);
      expect(r.states.high_price.reused).toBeFalsy();
      expect(r.states.residence_period.reused).toBe(true);
      expect(r.llmCalls).toBe(0);
    });

    it("different circumstances → the LLM step runs again", async () => {
      const r = await outcome("note", true);
      expect(r.llmCalls).toBe(1);
      expect(r.states.one_house.reused).toBe(true);
      expect(r.decision).toBe(TAX_ACTIONS.RESIDENCE);
    });
  });

  it("prepared readings of the circumstances texts", () => {
    for (const p of RESIDENCE_PRESETS) expect(preparedFor(TAX_SCENARIO, p.text)).toBe(p.prepared);
    expect(RESIDENCE_PRESETS.map((p) => [p.id, p.prepared.decision])).toEqual([
      ["lived", false],
      ["rented", true],
      ["weekday", false],
    ]);
  });

  it("LLM-only keys differ by scenario and input", () => {
    const a = llmOnlyKey(TAX_SCENARIO, toInput(TAX_SCENARIO, example), example.settings);
    const b = llmOnlyKey(TAX_SCENARIO, toInput(TAX_SCENARIO, withValues({ price: "13" })), example.settings);
    expect(a).not.toBe(b);
    expect(JSON.parse(a).s).toBe("tax");
  });
});
