import bench from "@/scenario/benchmark.json";
import type { BenchCase, Scenario } from "@/scenario/types";
import s from "./demo.module.css";

type StepStats = Record<string, { correct: number; runs: number }>;
interface WrongRun {
  run: number;
  answer: string;
  finalCorrect: boolean;
  wrongSteps: string[];
  reason: string;
}
interface Side {
  runs: number;
  correct: number;
  outcomes: Record<string, number>;
  steps: StepStats;
  wrong: WrongRun[];
}
interface CaseResult {
  scenario: string;
  caseId: string;
  title: string;
  expected: string;
  expectedSteps: Record<string, string>;
  structured: Side;
  llmOnly: Side;
}

const data = bench as unknown as { model: string; updatedAt: string; results: CaseResult[] };

/** Accuracy of both approaches over repeated real runs, per problem and per step. Shown exactly as measured. */
export function BenchmarkPanel({
  scenario,
  onRunCase,
  disabled,
}: {
  scenario: Scenario;
  onRunCase: (c: BenchCase) => void;
  disabled: boolean;
}) {
  const rows = scenario.cases.map((c) => ({ c, r: data.results.find((x) => x.scenario === scenario.id && x.caseId === c.id) }));
  const measured = rows.filter((x) => x.r && x.r.llmOnly.runs > 0).map((x) => x.r!);
  const total = (side: "llmOnly" | "structured", f: (x: Side) => number) => measured.reduce((a, r) => a + f(r[side]), 0);
  const stepTotal = (side: "llmOnly" | "structured", key: "correct" | "runs") =>
    measured.reduce((a, r) => a + Object.values(r[side].steps).reduce((b, v) => b + v[key], 0), 0);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const perCase = Math.max(0, ...measured.map((r) => r.llmOnly.runs));

  return (
    <section className={s.bench} aria-labelledby="bench-h">
      <h2 id="bench-h" className={s.panelTitle}>
        정답률 비교 — 조건이 얽힌 문제를 두 방식으로 여러 번 풀기
      </h2>
      <p className={s.caption}>
        LLM은 확률적으로 답을 만들기 때문에, 같은 문제도 풀 때마다 결과가 달라질 수 있습니다. 여러 조건이 얽힌 문제마다 두 방식을
        실제 LLM으로 반복 실행해, <b>최종 결론</b>과 <b>판단 단계별 판단</b>이 정답과 일치한 횟수를 기록했습니다. 매번 입력 전체를
        처음부터 판단하며, 이전 답을 기억하지 않습니다.
      </p>

      {measured.length === 0 ? (
        <p className={s.muted}>측정 중입니다. 결과가 기록되면 여기에 표시됩니다.</p>
      ) : (
        <>
          <p className={s.benchHow}>
            문제 <b>{measured.length}개</b>를 각각 <b>{perCase}번씩</b>, 방식마다 모두 <b>{total("llmOnly", (x) => x.runs)}번</b> 풀었습니다. 사용
            모델: <b>{data.model}</b> (경량·저성능 모델).
          </p>
          <div className={s.benchSummary}>
            <div className={`${s.benchStat} ${s.compareLLM}`}>
              <div className={s.decisionLabel}>LLM 단독 — 최종 결론</div>
              <div className={s.benchPct}>{pct(total("llmOnly", (x) => x.correct), total("llmOnly", (x) => x.runs))}%</div>
              <div className={s.compareSub}>
                {total("llmOnly", (x) => x.runs)}번 중 {total("llmOnly", (x) => x.correct)}번 정답 · 단계 판단{" "}
                {pct(stepTotal("llmOnly", "correct"), stepTotal("llmOnly", "runs"))}% 정확
              </div>
            </div>
            <div className={s.benchStat}>
              <div className={s.decisionLabel}>LLM + 규칙 — 최종 결론</div>
              <div className={s.benchPct}>{pct(total("structured", (x) => x.correct), total("structured", (x) => x.runs))}%</div>
              <div className={s.compareSub}>
                {total("structured", (x) => x.runs)}번 중 {total("structured", (x) => x.correct)}번 정답 · 단계 판단{" "}
                {pct(stepTotal("structured", "correct"), stepTotal("structured", "runs"))}% 정확
              </div>
            </div>
          </div>
        </>
      )}

      <div className={s.problemList}>
        {rows.map(({ c, r }) => (
          <article key={c.id} className={s.problem}>
            <header className={s.problemHead}>
              <h3>{c.title}</h3>
              <button type="button" className={s.small} onClick={() => onRunCase(c)} disabled={disabled}>
                이 문제 실행해 보기
              </button>
            </header>
            <ul className={s.traps}>
              {c.traps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {r && r.llmOnly.runs > 0 ? (
              <>
                <div className={s.problemFinal}>
                  <span>
                    정답 <b>{r.expected}</b>
                  </span>
                  <Final label="LLM 단독" side={r.llmOnly} expected={r.expected} />
                  <Final label="LLM + 규칙" side={r.structured} expected={r.expected} />
                </div>
                <table className={`${s.table} ${s.stepTable}`}>
                  <thead>
                    <tr>
                      <th>판단 단계</th>
                      <th>정답</th>
                      <th>LLM 단독 (스스로 보고한 판단)</th>
                      <th>LLM + 규칙</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(r.expectedSteps).map(([label, correct]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{correct}</td>
                        <td>
                          <Rate stats={r.llmOnly.steps[label]} />
                        </td>
                        <td>
                          <Rate stats={r.structured.steps[label]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Wrong title="LLM 단독" side={r.llmOnly} />
                <Wrong title="LLM + 규칙" side={r.structured} />
              </>
            ) : (
              <p className={s.muted}>측정 전</p>
            )}
          </article>
        ))}
      </div>

      {measured.length > 0 && (
        <p className={s.muted}>
          측정 모델: <b>{data.model || "—"}</b> (Google의 경량·저성능 모델) · {data.updatedAt ? data.updatedAt.slice(0, 10) : "—"} · 제공사 기본 샘플링 설정.
          더 좋은 모델에서는 LLM 단독의 오답률이 낮아질 수 있지만, 계산과 조건 적용을 확률적으로 처리하는 한 문제가 복잡해질수록 오답
          가능성은 남습니다. 판단구조는 모델 성능과 관계없이 규칙으로 정할 수 있는 판단을 항상 같은 결과로 처리합니다. LLM 단독에게는 판단 단계
          목록만 알려 주고 단계별 판단을 함께 보고하게 했습니다(계산과 결론은 스스로). LLM + 규칙에서도 LLM 단계는 틀릴 수 있으며, 틀리면
          위 표에 그대로 나타납니다. 결과는 관찰된 그대로입니다.
        </p>
      )}
    </section>
  );
}

function Final({ label, side, expected }: { label: string; side: Side; expected: string }) {
  const wrong = Object.entries(side.outcomes).filter(([k]) => k !== expected);
  return (
    <span className={s.finalItem}>
      {label}: <Rate stats={{ correct: side.correct, runs: side.runs }} />
      {wrong.length > 0 && <span className={s.benchWrong}>오답: {wrong.map(([k, n]) => `${k} ×${n}`).join(", ")}</span>}
    </span>
  );
}

function Wrong({ title, side }: { title: string; side: Side }) {
  if (!side.wrong.length) return null;
  const finalWrong = side.wrong.filter((w) => !w.finalCorrect).length;
  return (
    <details className={s.wrongDetails}>
      <summary>
        {title}: 틀린 풀이 {side.wrong.length}건 보기 (결론 오답 {finalWrong}건, 결론은 맞았지만 단계 판단이 틀린 풀이{" "}
        {side.wrong.length - finalWrong}건)
      </summary>
      <ol>
        {side.wrong.map((w) => (
          <li key={w.run}>
            <b>
              {w.run}번째 풀이 → {w.answer} {w.finalCorrect ? "(결론은 정답)" : "(결론 오답)"}
            </b>
            {w.wrongSteps.length > 0 && <div className={s.benchWrong}>틀린 단계: {w.wrongSteps.join(" · ")}</div>}
            {w.reason && <p>{w.reason}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function Rate({ stats }: { stats?: { correct: number; runs: number } }) {
  if (!stats || !stats.runs) return <span className={s.muted}>—</span>;
  const p = stats.correct / stats.runs;
  return (
    <span className={s.rate}>
      <span className={s.rateBar}>
        <span className={p === 1 ? s.rateFillOk : p >= 0.5 ? s.rateFillMid : s.rateFillBad} style={{ width: `${p * 100}%` }} />
      </span>
      <span className={s.rateText}>
        {stats.runs}번 중 {stats.correct}번 정답
      </span>
    </span>
  );
}
