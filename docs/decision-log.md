# Decision Log

Only decisions that changed the architecture or the way a problem was solved are recorded here.
Format: Problem · Hypothesis · AI suggestion · Alternatives · Decision · Reason · Implementation · Verification · Result.

---

## 1. Separate execution status from judgment result

- **Problem**: The first draft of the spec used `PASS / FAIL` as node status. A judgment whose answer is FALSE (e.g. "no sensor fault") would look like a failure.
- **Hypothesis**: Traceability breaks if "the answer is no" and "the evaluation broke" share one field.
- **AI suggestion**: Flagged in review of the spec; proposed two fields.
- **Alternatives**: Keep one status enum with more values (`TRUE_PASS`, `FALSE_PASS`, ...).
- **Decision**: `execution_status` (PENDING/READY/RUNNING/SUCCEEDED/FAILED/BLOCKED) and `judgment_result` (TRUE/FALSE/value) are separate.
- **Reason**: The two answer different questions — *did the method run?* and *what did it decide?*
- **Implementation**: `NodeState.status` vs `NodeState.output.result` (`src/core/types.ts`).
- **Verification**: test "keeps judgment result separate from execution status".
- **Result**: `Sensor fault evidence` shows `SUCCEEDED → FALSE`; only resolver errors show `FAILED`.

## 2. Language / stack

- **Problem**: The user asked whether to build in Python inside a virtual environment.
- **AI suggestion**: Keep TypeScript (Next.js): the DAG visualization is browser code anyway, and Vercel deployment is simplest. Dependencies stay in `demo/node_modules`, which already behaves like a removable environment.
- **Alternatives**: Python core + FastAPI + static JS UI; Python + Streamlit.
- **Decision**: TypeScript, chosen by the user.
- **Reason**: One language for engine, API and UI within a two-day deadline.
- **Verification**: No global installs; deleting `demo/` removes everything.

## 3. Fallback only for the unmodified example

- **Problem**: A public demo must work without a live LLM, but a fallback must not pretend to be a model.
- **Alternatives**: (a) a heuristic "mock LLM" that answers any input; (b) a precomputed answer for the example only.
- **Decision**: (b). For any modified evidence without a live LLM, the LLM node FAILS with "LLM unavailable" and the decision is BLOCKED.
- **Reason**: A heuristic would present guesses as model output. Failing honestly also demonstrates failure propagation.
- **Implementation**: `/api/judge` returns `source: "fallback"` only when `isExampleEvidence()`; UI labels it `준비된 예시 답변` (prepared example answer, not a live model call).
- **Verification**: scenario test "fallback is only used for the unmodified example evidence"; curl check returns 503 for modified evidence.
- **Result**: The precomputed answer was authored for the demo (not recorded from a model) — stated in code and UI.

## 4. No fallback for LLM Only mode

- **Problem**: A precomputed LLM-only answer would be a fabricated comparison baseline.
- **Decision**: LLM Only runs only with a live LLM; otherwise it says so (HTTP 503 → message in UI).
- **Reason**: The comparison must not be staged. The spec forbids making LLM Only look worse on purpose; inventing its output would be the same problem.

## 5. The LLM endpoint is not a general proxy

- **Problem**: A public route that forwards arbitrary prompts with the owner's API key can be abused.
- **Decision**: `/api/judge` accepts only a node id and that node's evidence fields; the question comes from the server-side graph. Input length is capped (4000 chars per field) and requests are rate limited per IP.
- **Verification**: curl — unknown node → 400, oversized field → 400.

## 6. Run the engine in the browser, LLM on the server

- **Alternatives**: run the whole DAG in an API route and return the trace.
- **Decision**: The engine runs client-side so state transitions (READY → RUNNING → SUCCEEDED/FAILED/BLOCKED) are real events, not a replayed animation. Only the LLM call goes to the server (API key).
- **Note**: `minRunMs` keeps a node visibly RUNNING for 450 ms. It is UI pacing only and does not change execution order or results.

## 7. Block dependents as soon as one dependency fails

- **Problem**: When the LLM node fails while RULE/CODE siblings are still running, should the decision node wait?
- **Decision**: It becomes BLOCKED immediately; siblings still complete.
- **Reason**: The decision can no longer run regardless of the siblings' results. Independent branches are unaffected, which the failure example shows.
- **Verification**: tests "blocks every transitive dependent of a failed node", "independent branch still succeeds when another branch fails".

## 8. A test that passed for the wrong reason (caught in review)

- **Problem**: An early propagation test made every node read the same invalid input, so "independent" nodes failed too and the test did not check independence at all.
- **Decision**: Split into two tests with separate inputs for the failing and the independent branch.
- **Result**: The independence property is now actually asserted.

## 9. Maintenance note rewritten so the LLM node earns its place

- **Problem**: The original one-line note ("calibration done, no drift") could be judged by keyword matching, which undermines "use the LLM only where needed".
- **Decision**: Three records from different sources, one mildly conflicting (a brief jumpy readout at 02:00) and one distractor (a gauge request for another chamber). Judging requires relating the 02:00 event to the alarm times — so the LLM node receives both the note and the alarm history.

## 10. Korean, guided UI

- **Problem**: The reviewers read Korean, and a first-time visitor needs to understand the screen without instructions (goal: 1–3 minutes).
- **Decision (user request)**: All on-screen text, scenario data and messages in Korean; a three-step "how to read" guide; a legend for resolver types and statuses; plain-language trace labels (본 입력 / 판단 방법 / AI의 근거 / 인용한 원문); Korean validation messages (`zod` Korean locale). Code identifiers stay English.
- **Terminology**: kept aligned with the application essay — 판단구조, 판단방법, Rule · Code · LLM.
- **Side fix**: The mono font has no Hangul, so Korean values rendered with wide spacing; text-heavy values now use the sans font with tabular digits.
- **Verification**: 32 tests updated and passing; screenshots recaptured; mobile width checked.

## 11. From "showing the structure" to "feeling the benefit"

- **Problem (raised by the user)**: The demo showed what the structure looks like, but not what a user gains from it. The benefit was only asserted in text.
- **AI suggestion**: Build experiences around what an engineer actually does with a decision: (1) see why the conclusion changed after an input change, (2) correct one judgment they disagree with, (3) change a rule value. Plus mission cards that set up each situation.
- **Decision**: All of them (user). Engine gained two capabilities: **reuse** (a node whose inputs, upstream results, method and override are unchanged reuses the previous result — tracked by a fingerprint) and **human override** (a person decides one node; its resolver is not called; the trace records it). The run reports how many times the AI step was actually executed.
- **Honesty constraints kept**: LLM-only is never shown failing; mission texts describe what the *user* would have to do with LLM-only (re-ask, re-read, compare), not that it would be wrong. The AI-step count names its source (실제 AI 응답 / 준비된 예시 답변) so a prepared answer is never presented as an AI call.
- **Verification**: tests for reuse on input change, identical re-run, override (0 AI calls, dependents recomputed), rule change (only the CODE node recomputed), alarm toggle (LLM node reused).

## 12. The AI step reads only the maintenance records

- **Problem**: The AI step also read the alarm history (decision 9). Toggling an alarm then changed the AI's input → a new AI call (or honest failure without a key), which hides the benefit and costs money.
- **Decision**: The AI step reads only the maintenance records; the alarm history is handled by the CODE step. The records were rewritten to be self-contained.
- **Result**: Alarm and rule changes cost 0 AI calls. This also sharpens the separation: each method sees only what it needs.

## 13. Explicit [다시 판단] instead of automatic re-evaluation

- **AI suggestion**: Re-evaluate automatically whenever a value changes.
- **Decision (user)**: Rejected. The user changes values, sees a list of pending changes, and presses [다시 판단 (변경 N건)].
- **Reason**: Several changes can be compared at once, and the "before → change → apply → what changed" sequence is deliberate and easier to follow.

## 14. Direct input controls

- **Decision (user suggestion)**: Slider for pressure, checkboxes for alarms (+ add a warning), maintenance-record variants, steppers for rule values. Free-text records remain possible but need a live AI; each prepared variant carries a prepared answer (labelled) so the demo works without an API key.

## 15. Recorded real answers instead of written ones

- **Problem**: Without a key, the AI step showed answers written for the demo. Clearly labelled, but a reviewer could read the AI part as a mock-up.
- **Decision**: `npm run record` calls the real model once for each prepared maintenance record and each LLM-only mission input, and saves the answers with model and timestamp. When no live LLM is available, these are served as "기록된 실제 AI 응답 · model · date". The written answers remain only as a last resort.
- **Safeguards**: The script saves only answers whose source is `live`; it refuses to write anything otherwise (verified without a key). A temporary test entry was served as `source: "recorded"` by the API, then removed.

## 16. Knowing whether the demo is visited

- **Decision (user request)**: Vercel Web Analytics (cookieless page views, no personal data) plus a dedicated `/p` path used only in the portfolio PDF, and three usage events (`mission`, `run`, `failure_example`).
- **Limitation, stated to the user**: This shows *that* and *how* the demo was used (time, country, device, path), not *who* visited.

## 17. Gemini (free tier) as the provider

- **Decision (user)**: Use the Gemini API free tier. Added a `gemini` provider (REST `generateContent`, JSON response mode) next to Anthropic and OpenAI; selected by `LLM_PROVIDER`.
- **Notes**: The model id is required (`LLM_MODEL`) and should be checked in Google AI Studio. Free-tier rate limits are covered by recorded answers when a live call fails. Free-tier inputs may be used by the provider to improve its models — acceptable here because the scenario is hypothetical and contains no personal or company data.
- **Credential handling**: The key is entered by the user in `.env.local` / Vercel; the assistant does not look it up or copy it between projects.

## 18. Free-tier quota: recording must be incremental; the rate limit must not break the demo

- **Problem 1**: The first recording run retried on quota errors (429), burning more quota, and saved only at the end — a failure on the last item discarded 8 successful answers.
- **Fix**: The recorder saves after every item and skips what is already recorded; the server retries only temporary overloads (500/503), never 429.
- **Problem 2**: When our own per-IP rate limit was hit, the API returned an error, so the LLM node FAILED and the decision was BLOCKED.
- **Fix**: The rate limit only skips the *live* call; recorded (then prepared) answers are still served.
- **Model**: `gemini-3.8-flash` and `gemini-flash-latest` hit the daily free quota; switched to `gemini-3.1-flash-lite` (user: "performance may be lower, generous free usage first"). Pinned by name, not an alias, so recorded answers and measurements stay reproducible.

## 19. RULE and CODE merged into one "규칙" method

- **Problem (raised by the user)**: RULE and CODE are both deterministic; showing them as two methods made the screen harder to read and blurred the main contrast.
- **Decision (user)**: Only two judgment methods: **규칙** (same input → same result: conditions, tables, calculations) and **LLM** (reads unstructured text). In code, a function-based rule is a `RULE` node of kind `"function"`.
- **Note**: The original tax system still has Rule, Code and LLM resolvers; the demo simplifies for the reader.

## 20. Show both approaches for the same input, side by side

- **Problem (raised by the user)**: LLM-only was hidden behind a mode switch, so the two results could not be compared.
- **Decision (user)**: The input panel stays fixed; every run judges the same input with **LLM 단독** and **LLM + 규칙** at once. A comparison bar shows both conclusions and whether they agree; tabs show each approach with the same layout (judgment structure · final decision · process).
- **When they disagree**: The bar shows what the rules established next to the LLM's full explanation, so the point of divergence is visible.

## 21. A real disagreement, reported as observed

- **Observation**: For the "알람 기준 5회" mission, `gemini-3.1-flash-lite` in LLM-only mode stated that there were **5** pressure warnings (there are 4) and chose "설비 보류". LLM + 규칙 counts 4 with a rule and chooses "모니터링 강화". This happened in the recording run and again in a live run.
- **How it is presented**: As a recorded real answer with model and date, with no prompt changes to provoke it. It illustrates why deterministic judgments (counting) are not delegated to the LLM; it is not a claim that LLMs always fail — two observations with one lightweight model.
