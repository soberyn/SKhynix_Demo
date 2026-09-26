import { describe, expect, it } from "vitest";
import { runGraph } from "@/core/engine";
import { MockLLM } from "@/core/mock-llm";
import { validateGraph } from "@/core/validate";
import {
  ACTIONS,
  DEFAULT_SETTINGS,
  EQUIPMENT_CODE,
  EQUIPMENT_GRAPH,
  EXAMPLE_INPUT,
  buildEquipmentGraph,
  clampSettings,
  NOTE_PRESETS,
  preparedAnswer,
} from "./equipment";

const llmSays = (decision: boolean) => new MockLLM(() => ({ decision, reason: "mock reason", evidence_quotes: [] }));
const run = (input: Record<string, string>, sensorFault = false) =>
  runGraph(EQUIPMENT_GRAPH, input, { code: EQUIPMENT_CODE, llm: llmSays(sensorFault) });

describe("equipment scenario", () => {
  it("is a valid DAG", () => {
    expect(validateGraph(EQUIPMENT_GRAPH)).toEqual([]);
  });

  it("example input → HOLD with a node-level trace", async () => {
    const r = await run(EXAMPLE_INPUT);
    expect(r.decision).toBe(ACTIONS.HOLD);
    const byNode = Object.fromEntries(r.trace.map((t) => [t.nodeId, t]));
    expect(byNode.pressure_abnormal).toMatchObject({ resolverType: "RULE", result: true, explanation: "12.7 > 10 → 예" });
    expect(byNode.repeated_alarm).toMatchObject({ resolverType: "CODE", result: true });
    expect(byNode.repeated_alarm.explanation).toBe('최근 24시간 "압력 경고" 4회 (기준 3회 이상) → 예');
    expect(byNode.sensor_fault_evidence).toMatchObject({ resolverType: "LLM", result: false });
    expect(r.trace[r.trace.length - 1].nodeId).toBe("equipment_action");
  });

  it("CODE excludes other alarm types and alarms outside the window", async () => {
    const r = await run(EXAMPLE_INPUT);
    const ev = r.states.repeated_alarm.output?.evidence ?? [];
    expect(ev.filter((e) => e.startsWith("집계:"))).toHaveLength(4);
    expect(ev).toContain("제외: 2026-09-26 12:30 펌프 온도 경고  (다른 유형)");
    expect(ev).toContain("제외: 2026-09-24 22:05 압력 경고  (24시간 범위 밖)");
  });

  it("the LLM only sees the maintenance records", async () => {
    const llm = llmSays(false);
    await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    expect(llm.calls).toHaveLength(1);
    expect(Object.keys(llm.calls[0].evidence)).toEqual(["input.maintenance_note"]);
  });

  describe("demo policy table", () => {
    const twoAlarms = "2026-09-26 09:13 압력 경고\n2026-09-26 11:42 압력 경고";
    it.each([
      ["pressure not abnormal", { pressure: "9.5" }, false, ACTIONS.CONTINUE],
      ["pressure at limit is not abnormal", { pressure: "10.0" }, false, ACTIONS.CONTINUE],
      ["abnormal, alarms below threshold", { alarm_history: twoAlarms }, false, ACTIONS.MONITOR],
      ["abnormal, repeated, sensor fault", {}, true, ACTIONS.CHECK_SENSOR],
      ["abnormal, repeated, no sensor fault", {}, false, ACTIONS.HOLD],
    ])("%s", async (_name, override, sensorFault, expected) => {
      const r = await run({ ...EXAMPLE_INPUT, ...override }, sensorFault);
      expect(r.decision).toBe(expected);
    });
  });

  it("invalid evaluation time fails the CODE node and blocks the decision", async () => {
    const r = await run({ ...EXAMPLE_INPUT, evaluation_time: "yesterday" });
    expect(r.states.repeated_alarm.status).toBe("FAILED");
    expect(r.states.pressure_abnormal.status).toBe("SUCCEEDED");
    expect(r.states.equipment_action).toMatchObject({ status: "BLOCKED", blockedBy: "repeated_alarm" });
  });

  it("prepared answers exist only for the prepared maintenance texts", () => {
    for (const p of NOTE_PRESETS) expect(preparedAnswer({ "input.maintenance_note": p.text })).toBe(p.prepared);
    expect(preparedAnswer({ "input.maintenance_note": "직접 쓴 기록" })).toBeUndefined();
    expect(NOTE_PRESETS.map((p) => p.prepared.decision)).toEqual([false, true, false]);
  });

  it("toggling alarms recomputes only the CODE node — the LLM input did not change", async () => {
    const llm = new MockLLM(() => ({ decision: false, reason: "mock", evidence_quotes: [] }));
    const first = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    const fewer = EXAMPLE_INPUT.alarm_history.split("\n").slice(0, 3).join("\n");
    const second = await runGraph(EQUIPMENT_GRAPH, { ...EXAMPLE_INPUT, alarm_history: fewer }, { code: EQUIPMENT_CODE, llm, previous: first });
    expect(second.states.repeated_alarm.reused).toBeFalsy();
    expect(second.states.sensor_fault_evidence.reused).toBe(true);
    expect(second.llmCalls).toBe(0);
    expect(second.decision).toBe(ACTIONS.MONITOR);
  });
});

describe("user benefits: change tracking, human override, policy change", () => {
  const counting = () => {
    let calls = 0;
    const llm = new MockLLM(() => {
      calls++;
      return { decision: false, reason: "mock", evidence_quotes: [] };
    });
    return { llm, calls: () => calls };
  };

  it("re-running with changed pressure reuses unchanged nodes and makes no LLM call", async () => {
    const { llm, calls } = counting();
    const first = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    expect(first.llmCalls).toBe(1);

    const second = await runGraph(EQUIPMENT_GRAPH, { ...EXAMPLE_INPUT, pressure: "9.5" }, { code: EQUIPMENT_CODE, llm, previous: first });
    expect(second.decision).toBe(ACTIONS.CONTINUE);
    expect(second.llmCalls).toBe(0);
    expect(calls()).toBe(1);
    expect(second.states.pressure_abnormal.reused).toBeFalsy();
    expect(second.states.repeated_alarm.reused).toBe(true);
    expect(second.states.sensor_fault_evidence.reused).toBe(true);
    expect(second.states.equipment_action.reused).toBeFalsy(); // an upstream result changed
  });

  it("an identical re-run reuses every node", async () => {
    const { llm } = counting();
    const first = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    const second = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm, previous: first });
    expect(Object.values(second.states).every((st) => st.reused)).toBe(true);
    expect(second.decision).toBe(first.decision);
  });

  it("a person can decide one judgment; only its dependents are recomputed", async () => {
    const { llm, calls } = counting();
    const first = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    const second = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, {
      code: EQUIPMENT_CODE,
      llm,
      previous: first,
      overrides: { sensor_fault_evidence: { result: true } },
    });
    expect(second.decision).toBe(ACTIONS.CHECK_SENSOR);
    expect(calls()).toBe(1);
    expect(second.llmCalls).toBe(0);
    expect(second.states.sensor_fault_evidence.output?.human).toBeDefined();
    expect(second.states.pressure_abnormal.reused).toBe(true);
    expect(second.states.repeated_alarm.reused).toBe(true);
    const entry = second.trace.find((t) => t.nodeId === "sensor_fault_evidence");
    expect(entry?.human?.note).toMatch(/엔지니어/);
  });

  it("changing a rule value recomputes only the node that uses it", async () => {
    const { llm } = counting();
    const first = await runGraph(EQUIPMENT_GRAPH, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm });
    const stricter = buildEquipmentGraph({ ...DEFAULT_SETTINGS, threshold: 5 });
    const second = await runGraph(stricter, EXAMPLE_INPUT, { code: EQUIPMENT_CODE, llm, previous: first });
    expect(second.states.repeated_alarm.reused).toBeFalsy();
    expect(second.states.repeated_alarm.output?.result).toBe(false);
    expect(second.states.pressure_abnormal.reused).toBe(true);
    expect(second.states.sensor_fault_evidence.reused).toBe(true);
    expect(second.llmCalls).toBe(0);
    expect(second.decision).toBe(ACTIONS.MONITOR);
  });

  it("clamps user-entered rule values", () => {
    expect(clampSettings({ threshold: "0", windowHours: 999 })).toEqual({ threshold: 1, windowHours: 168 });
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
