import { describe, expect, it } from "vitest";
import { runGraph } from "./engine";
import { MockLLM } from "./mock-llm";
import type { RuleFunctions, LLMProvider } from "./resolvers";
import type { JudgmentGraph, JudgmentNode } from "./types";
import { GraphValidationError, validateGraph } from "./validate";

const rule = (id: string, deps: string[] = [], left = "input.a", right: number = 0): JudgmentNode => ({
  id,
  label: id,
  description: "",
  dependencies: deps,
  resolver_type: "RULE",
  resolver_config: { kind: "compare", left, op: ">", right },
});

const graph = (nodes: JudgmentNode[], decision = nodes[nodes.length - 1].id): JudgmentGraph => ({
  nodes,
  decision_node: decision,
});

const noCode: RuleFunctions = {};
const noLLM = new MockLLM(() => ({ decision: true, reason: "unused" }));

describe("graph validation", () => {
  it("accepts a valid DAG", () => {
    expect(validateGraph(graph([rule("a"), rule("b", ["a"])]))).toEqual([]);
  });

  it("detects duplicate nodes", () => {
    expect(validateGraph(graph([rule("a"), rule("a")]))).toContain("중복 노드: a");
  });

  it("detects missing dependencies", () => {
    expect(validateGraph(graph([rule("a", ["ghost"])]))).toContain(
      "누락된 의존관계: a → 존재하지 않는 노드 ghost",
    );
  });

  it("detects cycles and reports the path", () => {
    const errors = validateGraph(graph([rule("A", ["C"]), rule("B", ["A"]), rule("C", ["B"])]));
    expect(errors).toContain("의존관계 순환 감지: A → B → C → A");
  });

  it("detects unknown resolvers", () => {
    const bad = { ...rule("a"), resolver_type: "MAGIC" } as unknown as JudgmentNode;
    expect(validateGraph(graph([bad]))).toContain('알 수 없는 resolver "MAGIC" (노드 a)');
  });

  it("refuses to execute an invalid graph", async () => {
    const g = graph([rule("A", ["B"]), rule("B", ["A"])]);
    await expect(runGraph(g, { a: 1 }, { functions: noCode, llm: noLLM })).rejects.toBeInstanceOf(GraphValidationError);
  });
});

describe("execution model", () => {
  it("runs dependencies before dependents", async () => {
    const g = graph([rule("c", ["b"]), rule("b", ["a"]), rule("a")]);
    const run = await runGraph(g, { a: 1 }, { functions: noCode, llm: noLLM });
    expect(run.trace.map((t) => t.nodeId)).toEqual(["a", "b", "c"]);
    expect(Object.values(run.states).every((s) => s.status === "SUCCEEDED")).toBe(true);
  });

  it("runs independent nodes concurrently", async () => {
    const events: string[] = [];
    const code: RuleFunctions = {};
    const llm: LLMProvider = {
      async evaluate(req) {
        events.push(`start:${req.nodeId}`);
        await new Promise((r) => setTimeout(r, 20));
        events.push(`end:${req.nodeId}`);
        return { raw: { decision: true, reason: "ok" }, source: "mock" };
      },
    };
    const llmNode = (id: string, deps: string[] = []): JudgmentNode => ({
      id,
      label: id,
      description: "",
      dependencies: deps,
      resolver_type: "LLM",
      resolver_config: { question: "q", evidence: [] },
    });
    const g = graph([llmNode("x"), llmNode("y"), rule("z", ["x", "y"], "input.a")]);
    const run = await runGraph(g, { a: 1 }, { functions: code, llm });
    expect(events.slice(0, 2).sort()).toEqual(["start:x", "start:y"]);
    expect(run.states.z.status).toBe("SUCCEEDED");
  });

  it("keeps judgment result separate from execution status", async () => {
    const g = graph([rule("a", [], "input.a", 10)]);
    const run = await runGraph(g, { a: 1 }, { functions: noCode, llm: noLLM });
    expect(run.states.a.status).toBe("SUCCEEDED");
    expect(run.states.a.output?.result).toBe(false);
  });
});

describe("resolvers", () => {
  it("RULE compare reads input refs and explains the comparison", async () => {
    const g = graph([
      {
        id: "p",
        label: "p",
        description: "",
        dependencies: [],
        resolver_type: "RULE",
        resolver_config: { kind: "compare", left: "input.pressure", op: ">", right: "input.limit" },
      },
    ]);
    const run = await runGraph(g, { pressure: "12.7", limit: "10.0" }, { functions: noCode, llm: noLLM });
    expect(run.states.p.output?.result).toBe(true);
    expect(run.states.p.output?.explanation).toBe("12.7 > 10 → 예");
  });

  it("RULE fails on non-numeric input", async () => {
    const run = await runGraph(graph([rule("a")]), { a: "abc" }, { functions: noCode, llm: noLLM });
    expect(run.states.a.status).toBe("FAILED");
    expect(run.states.a.error).toMatch(/숫자가 아닙니다/);
  });

  it("RULE table picks the first matching row", async () => {
    const table: JudgmentNode = {
      id: "t",
      label: "t",
      description: "",
      dependencies: ["a"],
      resolver_type: "RULE",
      resolver_config: {
        kind: "table",
        rows: [
          { when: { a: false }, then: "NO" },
          { when: { a: true }, then: "YES" },
        ],
      },
    };
    const run = await runGraph(graph([rule("a"), table]), { a: 5 }, { functions: noCode, llm: noLLM });
    expect(run.decision).toBe("YES");
    expect(run.states.t.output?.explanation).toBe("정책 표 2행과 일치 → YES");
  });

  it("RULE function runs a registered deterministic function", async () => {
    const code: RuleFunctions = {
      double: (_p, ctx) => ({ result: Number(ctx.input.n) * 2, explanation: "n * 2", inputs: { n: ctx.input.n } }),
    };
    const node: JudgmentNode = {
      id: "d",
      label: "d",
      description: "",
      dependencies: [],
      resolver_type: "RULE",
      resolver_config: { kind: "function", fn: "double", reads: ["input.n"] },
    };
    const run = await runGraph(graph([node]), { n: 21 }, { functions: code, llm: noLLM });
    expect(run.decision).toBe(42);
  });

  it("RULE function fails on an unknown function", async () => {
    const node: JudgmentNode = {
      id: "d",
      label: "d",
      description: "",
      dependencies: [],
      resolver_type: "RULE",
      resolver_config: { kind: "function", fn: "missing", reads: [] },
    };
    const run = await runGraph(graph([node]), {}, { functions: noCode, llm: noLLM });
    expect(run.states.d.status).toBe("FAILED");
    expect(run.states.d.error).toBe("등록되지 않은 규칙 함수: missing");
  });

  const llmNode: JudgmentNode = {
    id: "l",
    label: "l",
    description: "",
    dependencies: [],
    resolver_type: "LLM",
    resolver_config: { question: "Is it broken?", evidence: ["input.note"] },
  };

  it("LLM returns validated structured output and receives only its evidence", async () => {
    const llm = new MockLLM(() => ({ decision: true, confidence: 0.9, reason: "because", evidence_quotes: ["x"] }));
    const run = await runGraph(graph([llmNode]), { note: "hello", secret: "no" }, { functions: noCode, llm });
    expect(run.states.l.output).toMatchObject({
      result: true,
      explanation: "because",
      evidence: ["x"],
      llm: { source: "mock", confidence: 0.9 },
    });
    expect(llm.calls[0].evidence).toEqual({ "input.note": "hello" });
  });

  it("LLM malformed output fails the node", async () => {
    const llm = new MockLLM(() => ({ decision: "probably", reason: "" }));
    const run = await runGraph(graph([llmNode]), { note: "hello" }, { functions: noCode, llm });
    expect(run.states.l.status).toBe("FAILED");
    expect(run.states.l.error).toMatch(/약속된 형식/);
    expect(run.states.l.error).toMatch(/decision/);
  });

  it("LLM provider exception fails the node", async () => {
    const llm: LLMProvider = {
      async evaluate() {
        throw new Error("LLM unavailable");
      },
    };
    const run = await runGraph(graph([llmNode]), { note: "hello" }, { functions: noCode, llm });
    expect(run.states.l.status).toBe("FAILED");
    expect(run.states.l.error).toBe("LLM unavailable");
  });
});

describe("failure propagation and trace", () => {
  it("blocks every transitive dependent of a failed node", async () => {
    const g = graph([rule("bad", [], "input.bad"), rule("mid", ["bad"], "input.good"), rule("end", ["mid"], "input.good")]);
    const run = await runGraph(g, { bad: "x", good: 1 }, { functions: noCode, llm: noLLM });
    expect(run.states.bad.status).toBe("FAILED");
    expect(run.states.mid).toMatchObject({ status: "BLOCKED", blockedBy: "bad" });
    expect(run.states.end).toMatchObject({ status: "BLOCKED", blockedBy: "mid" });
    expect(run.decision).toBeUndefined();
    expect(run.decisionStatus).toBe("BLOCKED");
  });

  it("independent branch still succeeds when another branch fails", async () => {
    const g = graph([rule("bad", [], "input.bad"), rule("ok", [], "input.good"), rule("side", ["ok"], "input.good"), rule("end", ["bad", "side"], "input.good")], "end");
    const run = await runGraph(g, { bad: "x", good: 1 }, { functions: noCode, llm: noLLM });
    expect(run.states.ok.status).toBe("SUCCEEDED");
    expect(run.states.side.status).toBe("SUCCEEDED");
    expect(run.states.end).toMatchObject({ status: "BLOCKED", blockedBy: "bad" });
  });

  it("records one trace entry per node with inputs, result and explanation", async () => {
    const g = graph([rule("a", [], "input.a", 0), rule("b", ["a"], "input.a", 5)]);
    const run = await runGraph(g, { a: 3 }, { functions: noCode, llm: noLLM });
    expect(run.trace).toHaveLength(2);
    expect(run.trace[1]).toMatchObject({
      order: 2,
      nodeId: "b",
      resolverType: "RULE",
      status: "SUCCEEDED",
      dependencies: ["a"],
      inputs: { "input.a": 3 },
      result: false,
      explanation: "3 > 5 → 아니오",
    });
  });

  it("emits state snapshots that pass through RUNNING", async () => {
    const seen: string[] = [];
    await runGraph(graph([rule("a")]), { a: 1 }, {
      functions: noCode,
      llm: noLLM,
      onUpdate: (s) => seen.push(s.a.status),
    });
    expect(seen).toContain("READY");
    expect(seen).toContain("RUNNING");
    expect(seen[seen.length - 1]).toBe("SUCCEEDED");
  });
});
