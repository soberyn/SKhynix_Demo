import type { JudgmentGraph, RunResult } from "@/core/types";
import { SourceTag, formatValue } from "./bits";
import s from "./demo.module.css";

export interface LLMOnlyResult {
  ok: boolean;
  action?: string;
  reason?: string;
  /** LLM-only's own answer to each step of the graph, keyed by the step question. */
  checks?: Record<string, string>;
  error?: string;
  model?: string;
  source?: "live" | "recorded";
  recordedAt?: string;
}

/**
 * The two approaches side by side for the same input.
 * When they disagree, the structured side's node results are shown next to the LLM's single explanation,
 * so the point where they diverge is visible.
 */
export function ResultCompare({
  graph,
  run,
  running,
  llmOnly,
  llmRunning,
  failureDemo,
  truth,
}: {
  graph: JudgmentGraph;
  run: RunResult | null;
  running: boolean;
  llmOnly: LLMOnlyResult | null;
  llmRunning: boolean;
  failureDemo: boolean;
  /** The correct outcome and step results for the judged input, when known (prepared texts, no human override). */
  truth?: { decision: string; nodes: Record<string, string> };
}) {
  const expected = truth?.decision;
  if (!run && !running)
    return (
      <div className={`${s.decision} ${s.decisionIdle}`}>
        왼쪽의 <b>[판단 실행]</b>을 누르면 같은 입력을
        <br />
        <b>LLM 단독</b>과 <b>LLM + 규칙</b> 두 방식으로 동시에 판단해 결론을 나란히 보여줍니다. 자세한 과정은 아래 탭에서 볼 수 있습니다.
      </div>
    );

  const structured =
    run && !running ? (run.decisionStatus === "SUCCEEDED" ? formatValue(run.decision) : "판단 불가") : undefined;
  const llm = llmOnly?.ok ? llmOnly.action : undefined;
  // A human override applies only to LLM + rules; a different conclusion then is not an LLM-only mistake.
  const humanDecided = !!run && !running && Object.values(run.states).some((st) => st.output?.human);
  const bothDone = structured !== undefined && llm !== undefined && !failureDemo && !humanDecided;
  const same = bothDone && structured === llm;


  const mark = (v: string | undefined) =>
    expected && v && v !== "판단 중…" ? (v === expected ? <span className={s.okMark}>✓ 정답</span> : <span className={s.badMark}>✗ 오답</span>) : null;

  return (
    <div className={s.compareWrap}>
      {expected && !running && (
        <div className={s.expectedBar}>
          <span className={s.decisionLabel}>이 입력의 정답</span> <b>{expected}</b>
          <span className={s.muted}> — 규칙과 기록의 의도된 해석으로 정해진 답</span>
        </div>
      )}
      <div className={s.compareGrid}>
        <div className={`${s.compareCell} ${s.compareLLM}`}>
          <div className={s.decisionLabel}>LLM 단독</div>
          <div className={s.compareValue}>
            {failureDemo ? "—" : llmRunning ? "판단 중…" : llmOnly ? (llmOnly.ok ? llmOnly.action : "결과 없음") : "—"}{" "}
            {!llmRunning && !failureDemo && mark(llm)}
          </div>
          <div className={s.compareSub}>
            {llmOnly?.ok ? (
              <SourceTag source={llmOnly.source ?? "live"} model={llmOnly.model} recordedAt={llmOnly.recordedAt} />
            ) : failureDemo ? (
              "실패 예시에서는 실행하지 않음"
            ) : (
              "LLM 한 번이 모든 판단을 수행"
            )}
          </div>
        </div>
        <div className={`${s.compareCell} ${structured === "판단 불가" ? s.compareFail : ""}`}>
          <div className={s.decisionLabel}>LLM + 규칙</div>
          <div className={s.compareValue}>
            {running || !run ? "판단 중…" : structured} {!running && !humanDecided && mark(structured)}
          </div>
          <div className={s.compareSub}>판단을 나눠 규칙과 LLM으로 실행</div>
        </div>
      </div>

      {run && !running && run.decisionStatus !== "SUCCEEDED" && (
        <p className={s.diffNote}>
          ‘{graph.nodes.find((n) => n.id === run.trace.find((t) => t.status === "FAILED")?.nodeId)?.label ?? "?"}’ 단계에서
          실패했습니다. 그 결과가 필요한 다음 단계는 실행하지 않았습니다. 실패 위치가 특정되고, 영향이 다른 단계로 번지지
          않습니다.
        </p>
      )}
      {humanDecided && llm !== undefined && (
        <p className={s.changeNote}>
          사람이 지정한 판단은 LLM + 규칙에만 반영됩니다. LLM 단독에는 판단 하나만 고칠 방법이 없어, 같은 입력에 대한 원래
          답이 그대로 표시됩니다. 이 경우 두 결론의 차이는 LLM 단독의 오류가 아닙니다.
        </p>
      )}
      {bothDone && (
        <p className={same ? s.sameNote : s.diffNote}>
          {same ? "✓ 두 방식의 결론이 같습니다." : "⚠ 두 방식의 결론이 다릅니다. 아래에서 어디서 갈렸는지 확인해 보세요."}
        </p>
      )}
      {llmOnly && !llmOnly.ok && !failureDemo && <p className={s.changeNote}>LLM 단독: {llmOnly.error}</p>}

      {run && !running && !failureDemo && (
        <StepTable graph={graph} run={run} llmOnly={llmOnly} truth={truth} humanDecided={humanDecided} />
      )}
      {bothDone && !same && llmOnly?.reason && (
        <div className={s.divergence}>
          <div className={s.divTitle}>LLM 단독의 설명 (전체)</div>
          <p className={s.llmReason}>{llmOnly.reason}</p>
        </div>
      )}
      {bothDone && same && llmOnly?.reason && (
        <details className={s.llmDetails}>
          <summary>LLM 단독의 설명 보기</summary>
          <p className={s.llmReason}>{llmOnly.reason}</p>
          <p className={s.muted}>결론은 같지만, 어떤 조건을 어떤 순서로 확인했는지는 이 설명 문장 안에만 들어 있습니다.</p>
        </details>
      )}
      {run && !running && structured !== "판단 불가" && (
        <p className={s.decisionNote}>가상의 데모 정책에 따른 결과이며, 실제 운영 권고가 아닙니다.</p>
      )}
    </div>
  );
}

/** Every step of the graph: the correct result, LLM + rules, and what LLM-only reported for the same step. */
function StepTable({
  graph,
  run,
  llmOnly,
  truth,
  humanDecided,
}: {
  graph: JudgmentGraph;
  run: RunResult;
  llmOnly: LLMOnlyResult | null;
  truth?: { decision: string; nodes: Record<string, string> };
  humanDecided: boolean;
}) {
  const steps = graph.nodes.filter((n) => n.id !== graph.decision_node);
  const cell = (value: string | undefined, correct: string | undefined) => {
    if (value === undefined) return <span className={s.muted}>—</span>;
    const mark = correct === undefined ? null : value === correct ? <span className={s.okMark}>✓</span> : <span className={s.badMark}>✗</span>;
    return (
      <>
        {value} {mark}
      </>
    );
  };
  return (
    <table className={`${s.table} ${s.stepTable}`}>
      <thead>
        <tr>
          <th>판단 단계</th>
          {truth && <th>정답</th>}
          <th>LLM 단독이 보고한 판단</th>
          <th>LLM + 규칙</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((n) => {
          const st = run.states[n.id];
          const het = st?.status === "SUCCEEDED" ? formatValue(st.output?.result) : st?.status;
          const llm = llmOnly?.ok ? llmOnly.checks?.[n.label] : undefined;
          const correct = truth?.nodes[n.id];
          return (
            <tr key={n.id}>
              <th>
                {n.label} <span className={s.muted}>{n.resolver_type === "LLM" ? "(LLM)" : "(규칙)"}</span>
              </th>
              {truth && <td>{correct}</td>}
              <td>{cell(llm, correct)}</td>
              <td>{cell(het, humanDecided ? undefined : correct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
