import type { LLMOnlyResult } from "./ResultCompare";
import { SourceTag } from "./bits";
import s from "./demo.module.css";

/** The "LLM 단독" tab, laid out like the "LLM + 규칙" tab: structure · final decision · process. */
export function LLMOnlyPanel({ result, running }: { result: LLMOnlyResult | null; running: boolean }) {
  return (
    <div className={s.tabGrid}>
      <div className={s.tabCol}>
        <h3 className={s.colTitle}>판단구조</h3>
        <div className={s.llmOnlyFlow}>
          <div className={s.flowBox}>
            입력 전체
            <div className={s.muted}>압력 · 기준값 · 판단 시각 · 알람 이력 · 정비 기록 + 정책 문장</div>
          </div>
          <div className={s.flowArrow}>↓</div>
          <div className={`${s.flowBox} ${s.flowLLM}`}>
            <span className={`${s.badge} ${s.badge_LLM}`}>✦ LLM</span>
            <div>한 번의 호출이 모든 판단을 함께 수행</div>
            <div className={s.muted}>압력 비교 · 알람 횟수 세기 · 정비 기록 해석 · 정책 적용</div>
          </div>
          <div className={s.flowArrow}>↓</div>
          <div className={s.flowBox}>조치 + 설명 한 덩어리</div>
        </div>
        <p className={s.caption}>
          판단이 나뉘어 있지 않아서, 무엇을 어떤 순서로 확인했는지는 LLM 내부에 있습니다. 같은 입력·같은 정책을 쓰며, LLM이
          틀리도록 조작하지 않았습니다.
        </p>
      </div>

      <div className={s.tabCol}>
        <h3 className={s.colTitle}>최종 판단</h3>
        {running ? (
          <div className={`${s.decision} ${s.decisionIdle}`}>LLM의 답을 기다리는 중입니다…</div>
        ) : !result ? (
          <div className={`${s.decision} ${s.decisionIdle}`}>
            왼쪽의 <b>[판단 실행]</b>을 누르면 같은 입력을 LLM 한 번에 맡긴 결과가 여기에 표시됩니다.
          </div>
        ) : !result.ok ? (
          <div className={`${s.decision} ${s.decisionBlocked}`}>
            <div className={s.decisionNote}>{result.error}</div>
          </div>
        ) : (
          <div className={`${s.decision} ${s.decisionLLM}`}>
            <div className={s.decisionLabel}>LLM 단독의 결론</div>
            <div className={s.decisionValue}>{result.action}</div>
            <div className={s.decisionNote}>
              <SourceTag source={result.source ?? "live"} model={result.model} recordedAt={result.recordedAt} />
            </div>
          </div>
        )}

        <h3 className={s.colTitle}>판단과정</h3>
        {result?.ok ? (
          <>
            <p className={s.llmReason}>{result.reason}</p>
            <ul className={s.missingList}>
              <li>단계별 추적 없음 — 어떤 조건을 확인했는지는 위 설명 문장 안에만 있습니다.</li>
              <li>부분 수정 불가 — 판단 하나만 고치려 해도 전체를 다시 물어야 합니다.</li>
              <li>재사용 불가 — 입력 일부만 바뀌어도 전체를 다시 판단합니다.</li>
            </ul>
          </>
        ) : (
          <p className={s.muted}>실행 후 LLM의 설명이 여기에 표시됩니다. 설명 한 덩어리가 판단과정의 전부입니다.</p>
        )}
      </div>
    </div>
  );
}
