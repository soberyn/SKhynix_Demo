# 판단구조 실행 데모 (Heterogeneous Judgment Runtime)

A minimal demonstration of explicit judgment structure with Rule, Code and LLM resolvers. The UI is in Korean.

> Simplified hypothetical manufacturing scenario for demonstrating the architecture. It does not represent an actual SK hynix process or SOP.

## Purpose

An interactive proof-of-concept for one hypothesis, built for an application portfolio. It is not a product or a general workflow framework.

## Hypothesis

Instead of leaving a complex decision to an LLM's implicit reasoning, make the judgment structure and its dependencies explicit in the system, and give each judgment a suitable resolver. Deterministic computation and LLM reasoning then combine into one reviewable judgment process.

It demonstrates three conditions:

1. **Explicit Judgment Structure** — required judgments and dependencies are declared in a DAG.
2. **Deterministic / LLM Separation** — rules and calculations are not delegated to the LLM; the LLM handles only unstructured evidence.
3. **Traceability** — every node records its input, method, result and evidence.

## Architecture

```
Input → Judgment DAG → Resolver dispatch → RULE / CODE / LLM → Structured node result → Final decision → Execution trace
```

**Judgment Structure ≠ Judgment Method.** The DAG defines *what* must be judged and what it depends on; the resolver defines *how* each judgment is evaluated. The LLM is one resolver, not the controller.

| Path | Role |
|---|---|
| `src/core/` | Engine: graph validation, execution (READY/BLOCKED propagation, concurrent independent nodes), resolvers, trace |
| `src/scenario/equipment.ts` | Demo DAG, policy table, CODE functions, example input |
| `src/app/api/judge` | Evaluates one LLM node server-side (API key never reaches the browser) |
| `src/app/api/llm-only` | LLM Only comparison mode |
| `src/components/` | UI |

## Demo scenario

| Node | Resolver | Judgment |
|---|---|---|
| Pressure abnormal? | RULE | `pressure > pressure_limit` |
| Repeated alarm? | CODE | ≥ 3 pressure warnings within 24 h (filters type and time window) |
| Sensor fault evidence? | LLM | Do the maintenance records show the sensor is faulty? (structured output: decision, confidence, reason, evidence quotes) |
| Equipment action | RULE | Policy table over the three results → CONTINUE / MONITOR / ENGINEER REVIEW — CHECK SENSOR / HOLD |

Example result: **설비 보류 — 엔지니어 검토 필요** (HOLD). A failure example (simulated schema-violating LLM output) shows the failing node and the BLOCKED decision.

## How to run

```bash
npm install
cp .env.example .env.local   # optional: add an LLM key for live LLM and LLM Only mode
npm run dev
```

Direct links: `/?run=example`, `/?run=failure`.

Without an API key, the LLM node uses a precomputed answer **for the unmodified example only**, labelled `준비된 예시 답변`. Modified input then fails honestly at the LLM node.

## LLM answers: live, recorded, prepared

The AI step (and LLM Only mode) shows where each answer came from:

| Label | Meaning |
|---|---|
| 실제 AI 응답 | Live call made now (needs `LLM_*` on the server) |
| 기록된 실제 AI 응답 · model · date | A real model answer saved earlier with `npm run record`, shown when no live LLM is available |
| 준비된 예시 답변 | Written for the demo (not model output); last resort for the prepared maintenance-record variants |

Record real answers once (server running with a key):

```bash
npm run dev -- -p 3100
npm run record        # writes src/scenario/recorded.json — review it before deploying
```

## Deployment (Vercel)

- The API key lives only in Vercel environment variables (`LLM_PROVIDER` = `gemini` | `anthropic` | `openai`, `LLM_API_KEY`, `LLM_MODEL`); it never reaches the browser.
- Set a monthly spending limit in the provider console. The endpoints already allow only the demo's fixed question, cap input length and rate-limit per IP.
- Visits: `<Analytics />` (Vercel Web Analytics, cookieless) counts page views; enable it in the Vercel project. Link the portfolio PDF to **`/p`** (same demo) so portfolio-originated visits are counted separately. Custom events: `mission`, `run`, `failure_example` (availability depends on the Vercel plan).

## Tests

```bash
npm test
```

32 tests with a mock LLM (no API needed): validation (duplicate, missing dependency, cycle path, unknown resolver), ordering, concurrency, RULE/CODE/LLM resolvers, malformed LLM output, resolver failure, downstream blocking, trace, every row of the demo policy.

Measurement against a live LLM (§9-1 of the spec): `npm run measure -- --runs 10` → `docs/measurements.md`.

## Limitations

- Toy scenario with four nodes; not a workflow engine (no persistence, retries, distributed execution, authorization).
- The rate limit is in-memory per server instance.
- The fallback answer was authored for the demo, not recorded from a model.
- The comparison is about architecture, not a claim that the structured mode is always more accurate.

## AI-assisted development process

Built with an AI coding assistant. I defined the hypothesis, the three conditions, the constraints and the non-goals; the assistant proposed designs, wrote code and tests, and I reviewed the results against the original conditions. Decisions, including rejected and corrected ones, are in [`docs/decision-log.md`](docs/decision-log.md).

## Live demo URL

_Not deployed yet._
