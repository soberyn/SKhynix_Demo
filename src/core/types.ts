// Core types for the judgment runtime.
//
// Judgment Structure (the DAG: what must be judged, and what it depends on)
// is kept separate from Judgment Method (the resolver: how each judgment is evaluated).

/** RULE: deterministic (same input → same result). LLM: reads unstructured text. */
export type ResolverType = "RULE" | "LLM";

/** Execution status of a node. Never mixed with the judgment result. */
export type ExecutionStatus =
  | "PENDING" // waiting for dependencies
  | "READY" // all dependencies SUCCEEDED
  | "RUNNING"
  | "SUCCEEDED" // resolver returned a valid result (the result itself may be FALSE)
  | "FAILED" // resolver itself failed (exception, invalid LLM output, ...)
  | "BLOCKED"; // an upstream node FAILED or was BLOCKED, so this node was not run

export type JudgmentValue = boolean | number | string;

// ---------- Resolver configs ----------

/** Reference to a scenario input field ("input.pressure") or an upstream node result ("node.pressure_check"). */
export type Ref = string;

export type CompareOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface RuleCompareConfig {
  kind: "compare";
  left: Ref;
  op: CompareOp;
  right: Ref | number;
}

/** Decision table. The first row whose `when` matches wins. Omitted keys mean "any". */
export interface RuleTableConfig {
  kind: "table";
  rows: { when: Record<string, JudgmentValue>; then: JudgmentValue }[];
}

/** A deterministic rule that is easier to write as a function (parsing, time windows, counting). */
export interface RuleFunctionConfig {
  kind: "function";
  /** Name of a registered deterministic function. */
  fn: string;
  params?: Record<string, unknown>;
  /** Input fields the function reads. Declared so unchanged nodes can be reused between runs. */
  reads: Ref[];
}

export type RuleConfig = RuleCompareConfig | RuleTableConfig | RuleFunctionConfig;

export interface LLMConfig {
  /** The single question this node asks the LLM. */
  question: string;
  /** Input fields passed to the LLM as evidence. */
  evidence: Ref[];
}

export type JudgmentNode = NodeBase<"RULE", RuleConfig> | NodeBase<"LLM", LLMConfig>;

interface NodeBase<T extends ResolverType, C> {
  id: string;
  label: string;
  description: string;
  dependencies: string[];
  resolver_type: T;
  resolver_config: C;
}

export interface JudgmentGraph {
  nodes: JudgmentNode[];
  /** The node whose result is the final decision. */
  decision_node: string;
}

// ---------- Resolver output ----------

/** Where an LLM answer came from. Shown in the UI so a fallback is never presented as a live call. */
/** live: called now · recorded: a real model answer saved earlier · fallback: written for the demo · mock: simulated. */
export type LLMSource = "live" | "recorded" | "fallback" | "mock";

export interface ResolverOutput {
  result: JudgmentValue;
  /** Human-readable account of how the result was obtained, e.g. "12.7 > 10.0". */
  explanation: string;
  /** Values the resolver actually read. */
  inputs: Record<string, unknown>;
  /** Supporting evidence (LLM quotes, matched alarms, ...). */
  evidence?: string[];
  llm?: { source: LLMSource; model?: string; confidence?: number; recordedAt?: string };
  /** Set when a person decided this judgment instead of the resolver. */
  human?: { note: string };
}

/** A person's decision for one node, replacing its resolver for this run. */
export interface Override {
  result: JudgmentValue;
  note?: string;
}

// ---------- Execution state and trace ----------

export interface NodeState {
  status: ExecutionStatus;
  output?: ResolverOutput;
  error?: string;
  /** For BLOCKED nodes: the upstream node that caused the block. */
  blockedBy?: string;
  /** Result reused from the previous run because everything this node reads is unchanged. */
  reused?: boolean;
}

export interface TraceEntry {
  order: number;
  nodeId: string;
  label: string;
  resolverType: ResolverType;
  status: ExecutionStatus;
  dependencies: string[];
  inputs?: Record<string, unknown>;
  result?: JudgmentValue;
  explanation?: string;
  evidence?: string[];
  error?: string;
  blockedBy?: string;
  llm?: ResolverOutput["llm"];
  human?: ResolverOutput["human"];
  reused?: boolean;
  durationMs: number;
}

export interface RunResult {
  states: Record<string, NodeState>;
  trace: TraceEntry[];
  /** undefined when the decision node did not succeed. */
  decision?: JudgmentValue;
  decisionStatus: ExecutionStatus;
  /** Number of LLM calls actually made in this run (not counting reused or human-decided nodes). */
  llmCalls: number;
  /** What each node read in this run; equal fingerprints mean the node can be reused. */
  fingerprints: Record<string, string>;
}
