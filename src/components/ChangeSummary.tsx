import type { JudgmentGraph, RunResult } from "@/core/types";
import { formatValue } from "./bits";
import s from "./demo.module.css";

/** Per-node comparison of this run with the previous one. */
export function nodeChange(run: RunResult, prev: RunResult | null, id: string): { before?: string; after?: string } | null {
  if (!prev) return null;
  const a = prev.states[id];
  const b = run.states[id];
  const before = a?.status === "SUCCEEDED" ? formatValue(a.output?.result) : a?.status;
  const after = b?.status === "SUCCEEDED" ? formatValue(b.output?.result) : b?.status;
  return before === after ? null : { before, after };
}

export function ChangeSummary({
  graph,
  run,
  prev,
  benefit,
  llmOnlyNote,
  onCompare,
}: {
  graph: JudgmentGraph;
  run: RunResult;
  prev: RunResult;
  benefit?: string;
  llmOnlyNote?: string;
  /** Runs AI-only mode on the same input. */
  onCompare?: () => void;
}) {
  const nodes = graph.nodes;
  const reused = nodes.filter((n) => run.states[n.id]?.reused);
  const human = nodes.filter((n) => run.states[n.id]?.output?.human && !run.states[n.id]?.reused);
  const recomputed = nodes.filter((n) => !run.states[n.id]?.reused && !run.states[n.id]?.output?.human);
  const changes = nodes
    .map((n) => ({ n, c: nodeChange(run, prev, n.id) }))
    .filter((x) => x.c && x.n.id !== graph.decision_node);
  const decisionChange = nodeChange(run, prev, graph.decision_node);
  // Say what actually answered the LLM step, so a prepared answer is never counted as a live LLM call.
  const SOURCE_NAME = { live: "실제 LLM 응답", recorded: "기록된 실제 LLM 응답", fallback: "준비된 예시 답변", mock: "시뮬레이션" } as const;
  const aiSources = [
    ...new Set(
      nodes
        .filter((n) => n.resolver_type === "LLM" && !run.states[n.id]?.reused && run.states[n.id]?.output?.llm)
        .map((n) => SOURCE_NAME[run.states[n.id]!.output!.llm!.source]),
    ),
  ];

  return (
    <div className={s.changeCard}>
      <div className={s.changeTitle}>이전 실행과 비교해 바뀐 점</div>
      <div className={s.changeDecision}>
        {decisionChange ? (
          <>
            결론 <s>{decisionChange.before}</s> → <b>{decisionChange.after}</b>
          </>
        ) : (
          <>결론은 그대로입니다 ({formatValue(run.decision) || run.decisionStatus})</>
        )}
      </div>
      {changes.length > 0 ? (
        <ul className={s.changeList}>
          {changes.map(({ n, c }) => (
            <li key={n.id}>
              <b>{n.label}</b> {c!.before} → <b>{c!.after}</b>
              <span className={s.muted}>
                {" "}
                — {run.states[n.id]?.output?.human ? "사람이 직접 지정" : run.states[n.id]?.output?.explanation}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.muted}>바뀐 판단이 없습니다.</p>
      )}
      <div className={s.changeStats}>
        <span>
          다시 판단 <b>{recomputed.length}</b>
        </span>
        <span>
          재사용 <b>{reused.length}</b>
        </span>
        {human.length > 0 && (
          <span>
            사람 지정 <b>{human.length}</b>
          </span>
        )}
        <span>
          LLM 단계 실행 <b>{run.llmCalls}회</b>
          {aiSources.length > 0 && <span className={s.muted}> ({aiSources.join(", ")})</span>}
        </span>
      </div>
      {reused.length > 0 && (
        <p className={s.changeNote}>
          입력이 그대로인 판단({reused.map((n) => n.label).join(", ")})은 다시 계산하지 않고 이전 결과를 재사용했습니다.
        </p>
      )}
      {benefit && <p className={s.changeBenefit}>{benefit}</p>}
      {llmOnlyNote && <p className={s.changeNote}>↔ {llmOnlyNote}</p>}
      {onCompare && (
        <button type="button" className={`${s.small} ${s.compareBtn}`} onClick={onCompare}>
          같은 입력으로 LLM 단독 판단해 보기 →
        </button>
      )}
    </div>
  );
}
