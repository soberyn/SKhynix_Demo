import type { Override, TraceEntry } from "@/core/types";
import { ResolverBadge, SourceTag, StatusPill, formatValue, sourceMeaning } from "./bits";
import s from "./demo.module.css";

export function TracePanel({
  trace,
  decisionNode,
  overrides,
  onOverride,
  names,
}: {
  trace: TraceEntry[];
  /** Display names for input fields and nodes (from the scenario). */
  names: Record<string, string>;
  decisionNode: string;
  /** Pending human decisions (applied on the next run). */
  overrides: Record<string, Override>;
  onOverride: (nodeId: string, value: boolean | null) => void;
}) {
  if (!trace.length) return null;
  return (
    <ol className={s.trace}>
      {trace.map((t) => (
        <li key={t.nodeId} className={s.traceItem}>
          <div className={s.traceHead}>
            <span className={s.traceOrder}>{t.order}</span>
            <span className={s.traceLabel}>{t.label}</span>
            {t.reused && <span className={s.reusedTag}>재사용</span>}
            {t.human && <span className={s.humanTag}>👤 사람 지정</span>}
            <ResolverBadge type={t.resolverType} />
          </div>
          <dl className={s.traceBody}>
            <dt>상태</dt>
            <dd>
              <StatusPill status={t.status} />
              {t.status === "SUCCEEDED" && <b className={s.traceResult}>→ {formatValue(t.result)}</b>}
            </dd>
            {t.dependencies.length > 0 && (
              <>
                <dt>앞 단계</dt>
                <dd>{t.dependencies.length}개 판단의 결과를 사용</dd>
              </>
            )}
            {t.inputs && (
              <>
                <dt>본 입력</dt>
                <dd className={s.mono}>{summarizeInputs(t, names)}</dd>
              </>
            )}
            {t.explanation && (
              <>
                <dt>{t.resolverType === "LLM" ? "LLM의 근거" : "판단 방법"}</dt>
                <dd>{t.explanation}</dd>
              </>
            )}
            {t.llm && (
              <>
                <dt>응답 출처</dt>
                <dd>
                  <SourceTag source={t.llm.source} model={t.llm.model} recordedAt={t.llm.recordedAt} />
                  <span className={s.muted}> {sourceMeaning(t.llm.source)}</span>
                  {t.llm.confidence !== undefined && <span className={s.muted}> · 확신도 {t.llm.confidence}</span>}
                </dd>
              </>
            )}
            {t.evidence && t.evidence.length > 0 && (
              <>
                <dt>{t.resolverType === "LLM" ? "인용한 원문" : "상세"}</dt>
                <dd>
                  <ul className={s.evidence}>
                    {t.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {t.error && (
              <>
                <dt>실패 이유</dt>
                <dd className={s.errorText}>{t.error}</dd>
              </>
            )}
            {t.blockedBy && (
              <>
                <dt>실행 안 함</dt>
                <dd className={s.errorText}>
                  앞 단계 ‘{nameOf(t.blockedBy, names)}’가 실패하거나 차단되어, 이 단계는 실행하지 않았습니다.
                </dd>
              </>
            )}
          </dl>
          {t.nodeId !== decisionNode && typeof (t.result ?? false) === "boolean" && (
            <OverrideControl entry={t} pending={overrides[t.nodeId]} onOverride={onOverride} />
          )}
        </li>
      ))}
    </ol>
  );
}

function OverrideControl({
  entry,
  pending,
  onOverride,
}: {
  entry: TraceEntry;
  pending?: Override;
  onOverride: (nodeId: string, value: boolean | null) => void;
}) {
  const applied = entry.human !== undefined;
  const pendingText = pending ? formatValue(pending.result) : null;
  return (
    <div className={s.overrideRow}>
      <span className={s.muted}>이 판단에 동의하지 않으면</span>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          className={pending?.result === v ? `${s.small} ${s.smallOn}` : s.small}
          onClick={() => onOverride(entry.nodeId, pending?.result === v ? null : v)}
        >
          ‘{formatValue(v)}’로 지정
        </button>
      ))}
      {(pending || applied) && (
        <button type="button" className={s.small} onClick={() => onOverride(entry.nodeId, null)}>
          지정 해제
        </button>
      )}
      {pendingText && !applied && <span className={s.pendingText}>→ [다시 판단]을 누르면 적용</span>}
    </div>
  );
}

/** Names for values computed inside rule functions (not scenario fields). */
const EXTRA_NAMES: Record<string, string> = {
  window_hours: "집계 범위(시간)",
  threshold: "기준 횟수",
  count: "집계 횟수",
  required_years: "요건(년)",
};

const nameOf = (key: string, names: Record<string, string>) => {
  const k = key.replace(/^(input|node)\./, "");
  return names[k] ?? EXTRA_NAMES[k] ?? k;
};

function summarizeInputs(t: TraceEntry, names: Record<string, string>): string {
  const entries = Object.entries(t.inputs ?? {});
  if (t.resolverType === "LLM") {
    // Evidence texts are long; show which fields were given to the LLM, not their full content.
    return (
      entries
        .filter(([k]) => k !== "question")
        .map(([k, v]) => `${nameOf(k, names)} ${String(v).split("\n").length}줄`)
        .join(", ") + " (LLM에게는 이것만 전달)"
    );
  }
  return entries.map(([k, v]) => `${nameOf(k, names)} = ${formatValue(v as never)}`).join(", ");
}
