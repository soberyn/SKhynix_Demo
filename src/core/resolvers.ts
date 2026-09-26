import { z } from "zod";
import type {
  CompareOp,
  JudgmentNode,
  JudgmentValue,
  LLMConfig,
  LLMSource,
  Ref,
  ResolverOutput,
  RuleConfig,
} from "./types";

/** Everything a resolver may read: the scenario input and results of upstream nodes. */
export interface ResolveContext {
  input: Record<string, unknown>;
  results: Record<string, JudgmentValue>;
}

export function readRef(ref: Ref, ctx: ResolveContext): unknown {
  const [scope, key] = ref.split(".", 2);
  if (scope === "input") return ctx.input[key];
  if (scope === "node") return ctx.results[key];
  throw new Error(`잘못된 참조: ${ref}`);
}

/** Boolean shown to people: 예 / 아니오. */
export const yesNo = (v: boolean) => (v ? "예" : "아니오");

// ---------- RULE ----------

const COMPARE: Record<CompareOp, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

function toNumber(value: unknown, ref: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (value === "" || value === undefined || value === null || !Number.isFinite(n)) {
    throw new Error(`${ref.replace(/^(input|node)\./, "")} 값이 숫자가 아닙니다: ${JSON.stringify(value)}`);
  }
  return n;
}

export function resolveRule(config: RuleConfig, ctx: ResolveContext, functions: RuleFunctions): ResolverOutput {
  if (config.kind === "function") {
    const fn = functions[config.fn];
    if (!fn) throw new Error(`등록되지 않은 규칙 함수: ${config.fn}`);
    return fn(config.params ?? {}, ctx);
  }
  if (config.kind === "compare") {
    const left = toNumber(readRef(config.left, ctx), config.left);
    const right =
      typeof config.right === "number" ? config.right : toNumber(readRef(config.right, ctx), config.right);
    const result = COMPARE[config.op](left, right);
    return {
      result,
      explanation: `${left} ${config.op} ${right} → ${yesNo(result)}`,
      inputs: { [config.left]: left, ...(typeof config.right === "number" ? {} : { [config.right]: right }) },
    };
  }

  const inputs: Record<string, unknown> = {};
  for (const row of config.rows) for (const key of Object.keys(row.when)) inputs[key] = ctx.results[key];

  const index = config.rows.findIndex((row) =>
    Object.entries(row.when).every(([key, expected]) => ctx.results[key] === expected),
  );
  if (index < 0) throw new Error("앞 단계 결과와 일치하는 정책 행이 없습니다");

  const row = config.rows[index];
  return {
    result: row.then,
    explanation: `정책 표 ${index + 1}행과 일치 → ${row.then}`,
    inputs,
  };
}

/** Deterministic functions a RULE node of kind "function" can call. */
export type RuleFunction = (params: Record<string, unknown>, ctx: ResolveContext) => Omit<ResolverOutput, "llm">;

export type RuleFunctions = Record<string, RuleFunction>;

// ---------- LLM ----------

// Validation messages in Korean (the UI is Korean).
z.config(z.locales.ko());

/** Structured output every LLM judgment must return. */
export const LLMJudgmentSchema = z.object({
  decision: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().min(1),
  evidence_quotes: z.array(z.string()).default([]),
});
export type LLMJudgment = z.infer<typeof LLMJudgmentSchema>;

export interface LLMRequest {
  nodeId: string;
  question: string;
  evidence: Record<string, string>;
}

/** Raw provider answer. `raw` is untrusted and is validated by the LLM resolver. */
export interface LLMResponse {
  raw: unknown;
  source: LLMSource;
  model?: string;
  /** For recorded answers: when the real model call was made. */
  recordedAt?: string;
}

/** Swappable provider: a live API (via server route), a mock for tests, or a scripted failure. */
export interface LLMProvider {
  evaluate(request: LLMRequest): Promise<LLMResponse>;
}

export async function resolveLLM(
  node: JudgmentNode & { resolver_type: "LLM" },
  ctx: ResolveContext,
  provider: LLMProvider,
): Promise<ResolverOutput> {
  const config: LLMConfig = node.resolver_config;
  const evidence: Record<string, string> = {};
  for (const ref of config.evidence) evidence[ref] = String(readRef(ref, ctx) ?? "");

  const response = await provider.evaluate({ nodeId: node.id, question: config.question, evidence });
  const parsed = LLMJudgmentSchema.safeParse(response.raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`LLM 출력이 약속된 형식(schema)과 다릅니다 (${response.source}) — ${issues}`);
  }

  const out = parsed.data;
  return {
    result: out.decision,
    explanation: out.reason,
    inputs: { question: config.question, ...evidence },
    evidence: out.evidence_quotes,
    llm: { source: response.source, model: response.model, confidence: out.confidence, recordedAt: response.recordedAt },
  };
}
