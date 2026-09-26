import { readRef, resolveCode, resolveLLM, resolveRule, type CodeRegistry, type LLMProvider } from "./resolvers";
import type {
  JudgmentGraph,
  JudgmentNode,
  JudgmentValue,
  NodeState,
  Override,
  ResolverOutput,
  RunResult,
  TraceEntry,
} from "./types";
import { assertValidGraph } from "./validate";

export interface RunOptions {
  code: CodeRegistry;
  llm: LLMProvider;
  /** Called with a snapshot of all node states whenever any state changes. */
  onUpdate?: (states: Record<string, NodeState>) => void;
  /** UI pacing only: keep each node visibly RUNNING for at least this long. */
  minRunMs?: number;
  /** Judgments decided by a person. The node's resolver is not called. */
  overrides?: Record<string, Override>;
  /** Previous run: nodes whose inputs are unchanged reuse its results instead of re-evaluating. */
  previous?: RunResult | null;
}

/**
 * Executes the judgment DAG.
 * - A node becomes READY only when every dependency SUCCEEDED.
 * - If a dependency FAILED or is BLOCKED, the node is BLOCKED and never run.
 * - Independent READY nodes run concurrently.
 */
export async function runGraph(
  graph: JudgmentGraph,
  input: Record<string, unknown>,
  options: RunOptions,
): Promise<RunResult> {
  assertValidGraph(graph);

  const states: Record<string, NodeState> = Object.fromEntries(
    graph.nodes.map((n) => [n.id, { status: "PENDING" } as NodeState]),
  );
  const trace: TraceEntry[] = [];
  const results: Record<string, JudgmentValue> = {};
  const fingerprints: Record<string, string> = {};
  let llmCalls = 0;

  const emit = () => options.onUpdate?.(structuredClone(states));
  const set = (id: string, next: NodeState) => {
    states[id] = next;
    emit();
  };

  const record = (node: JudgmentNode, durationMs: number) => {
    const s = states[node.id];
    trace.push({
      order: trace.length + 1,
      nodeId: node.id,
      label: node.label,
      resolverType: node.resolver_type,
      status: s.status,
      dependencies: node.dependencies,
      inputs: s.output?.inputs,
      result: s.output?.result,
      explanation: s.output?.explanation,
      evidence: s.output?.evidence,
      llm: s.output?.llm,
      human: s.output?.human,
      reused: s.reused,
      error: s.error,
      blockedBy: s.blockedBy,
      durationMs,
    });
  };

  const execute = async (node: JudgmentNode): Promise<void> => {
    const ctx = { input, results: { ...results } };
    const override = options.overrides?.[node.id];
    const fp = fingerprint(node, ctx, override);
    fingerprints[node.id] = fp;

    const prev = options.previous;
    const prevState = prev?.states[node.id];
    if (prev && prev.fingerprints[node.id] === fp && prevState?.status === "SUCCEEDED" && prevState.output) {
      results[node.id] = prevState.output.result;
      set(node.id, { status: "SUCCEEDED", output: prevState.output, reused: true });
      record(node, 0);
      return;
    }

    set(node.id, { status: "RUNNING" });
    const started = Date.now();
    try {
      let work: Promise<ResolverOutput>;
      if (override) {
        work = Promise.resolve({
          result: override.result,
          explanation: override.note ?? "엔지니어가 직접 지정한 판단",
          inputs: {},
          human: { note: override.note ?? "엔지니어가 직접 지정" },
        });
      } else {
        if (node.resolver_type === "LLM") llmCalls++;
        work = resolve(node, ctx, options);
      }
      const [output] = await Promise.all([work, options.minRunMs ? delay(options.minRunMs) : undefined]);
      results[node.id] = output.result;
      set(node.id, { status: "SUCCEEDED", output });
    } catch (err) {
      set(node.id, { status: "FAILED", error: err instanceof Error ? err.message : String(err) });
    }
    record(node, Date.now() - started);
  };

  /** Moves PENDING nodes to READY or BLOCKED. Returns the newly READY nodes. */
  const advance = (): JudgmentNode[] => {
    const ready: JudgmentNode[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of graph.nodes) {
        if (states[node.id].status !== "PENDING") continue;
        const bad = node.dependencies.find((d) => ["FAILED", "BLOCKED"].includes(states[d].status));
        if (bad) {
          states[node.id] = { status: "BLOCKED", blockedBy: bad };
          record(node, 0);
          changed = true; // a new BLOCKED node may block its own dependents
        } else if (node.dependencies.every((d) => states[d].status === "SUCCEEDED")) {
          states[node.id] = { status: "READY" };
          ready.push(node);
        }
      }
    }
    emit();
    return ready;
  };

  const running = new Set<Promise<void>>();
  const launch = (nodes: JudgmentNode[]) => {
    for (const node of nodes) {
      const p: Promise<void> = execute(node).then(() => {
        running.delete(p);
      });
      running.add(p);
    }
  };

  launch(advance());
  while (running.size) {
    await Promise.race(running);
    launch(advance());
  }

  const decisionState = states[graph.decision_node];
  return {
    states,
    trace,
    decision: decisionState.status === "SUCCEEDED" ? decisionState.output?.result : undefined,
    decisionStatus: decisionState.status,
    llmCalls,
    fingerprints,
  };
}

/** Everything that can change a node's result: its method, what it reads, upstream results, and any override. */
function fingerprint(
  node: JudgmentNode,
  ctx: { input: Record<string, unknown>; results: Record<string, JudgmentValue> },
  override: Override | undefined,
): string {
  const refs =
    node.resolver_type === "LLM"
      ? node.resolver_config.evidence
      : node.resolver_type === "CODE"
        ? node.resolver_config.reads
        : node.resolver_config.kind === "compare"
          ? [node.resolver_config.left, ...(typeof node.resolver_config.right === "string" ? [node.resolver_config.right] : [])]
          : [];
  return JSON.stringify({
    type: node.resolver_type,
    config: node.resolver_config,
    reads: refs.map((r) => [r, readRef(r, ctx)]),
    upstream: node.dependencies.map((d) => [d, ctx.results[d]]),
    override: override ?? null,
  });
}

async function resolve(
  node: JudgmentNode,
  ctx: { input: Record<string, unknown>; results: Record<string, JudgmentValue> },
  options: RunOptions,
): Promise<ResolverOutput> {
  switch (node.resolver_type) {
    case "RULE":
      return resolveRule(node.resolver_config, ctx);
    case "CODE":
      return resolveCode(node.resolver_config, ctx, options.code);
    case "LLM":
      return resolveLLM(node, ctx, options.llm);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
