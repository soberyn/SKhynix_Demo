import { describe, expect, it } from "vitest";
import { ACTIONS, EQUIPMENT_SCENARIO } from "./equipment";
import { TAX_ACTIONS, TAX_SCENARIO } from "./tax";
import { groundTruth } from "./truth";
import type { Scenario } from "./types";

const truthOf = async (sc: Scenario, id: string) => {
  const c = sc.cases.find((x) => x.id === id)!;
  return (await groundTruth(sc, c.apply(sc.exampleDraft)))?.decision;
};

describe("correct outcomes of the benchmark cases", () => {
  it.each([
    ["p1", TAX_ACTIONS.EXEMPT_PARTIAL],
    ["p2", TAX_ACTIONS.RESIDENCE],
    ["p3", TAX_ACTIONS.NOT_ONE_HOUSE],
    ["p4", TAX_ACTIONS.EXEMPT],
  ])("tax · %s", async (id, expected) => {
    expect(await truthOf(TAX_SCENARIO, id)).toBe(expected);
  });

  it.each([
    ["p1", ACTIONS.HOLD],
    ["p2", ACTIONS.MONITOR],
    ["p3", ACTIONS.CONTINUE],
    ["p4", ACTIONS.CHECK_SENSOR],
  ])("equipment · %s", async (id, expected) => {
    expect(await truthOf(EQUIPMENT_SCENARIO, id)).toBe(expected);
  });

  it("is undefined for custom text (no intended reading)", async () => {
    const d = { ...TAX_SCENARIO.exampleDraft, notes: { residence_note: { presetId: "custom", custom: "직접 쓴 기록" } } };
    expect(await groundTruth(TAX_SCENARIO, d)).toBeUndefined();
  });
});
