"use client";

import { track } from "@vercel/analytics";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { runGraph } from "@/core/engine";
import type { LLMProvider } from "@/core/resolvers";
import type { ExecutionStatus, NodeState, Override, ResolverType, RunResult } from "@/core/types";
import { validateGraph } from "@/core/validate";
import { httpLLM, malformedLLM } from "@/lib/http-llm";
import { SCENARIOS, getScenario } from "@/scenario";
import { groundTruth } from "@/scenario/truth";
import { noteText, toInput, type BenchCase, type Draft, type Mission, type Scenario } from "@/scenario/types";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { ChangeSummary, nodeChange } from "./ChangeSummary";
import { DagView } from "./DagView";
import { InputPanel } from "./InputPanel";
import { LLMOnlyPanel } from "./LLMOnlyPanel";
import { PolicyTable } from "./PolicyTable";
import { ResultCompare, type LLMOnlyResult } from "./ResultCompare";
import { TracePanel } from "./TracePanel";
import { RESOLVER_MEANING, ResolverBadge, STATUS_TEXT, StatusPill, formatValue } from "./bits";
import s from "./demo.module.css";

/** Human-readable list of what differs between the applied state and the draft. */
function diffDraft(sc: Scenario, a: Draft, b: Draft, ao: Record<string, Override>, bo: Record<string, Override>) {
  const keys = new Set<string>();
  const labels: string[] = [];
  const check = (key: string, label: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      keys.add(key);
      labels.push(label);
    }
  };
  for (const f of sc.fields) {
    if (f.kind === "lines") check(f.key, f.label, a.lines[f.key], b.lines[f.key]);
    else if (f.kind === "note") check(f.key, f.label, noteText(sc, a, f.key), noteText(sc, b, f.key));
    else check(f.key, `${f.label} ${a.values[f.key]} → ${b.values[f.key]}`, a.values[f.key], b.values[f.key]);
  }
  const changedSettings = sc.settings.filter((x) => a.settings[x.key] !== b.settings[x.key]);
  if (changedSettings.length)
    check(
      "settings",
      `규칙 값 (${changedSettings.map((x) => `${x.label} ${a.settings[x.key]} → ${b.settings[x.key]}`).join(", ")})`,
      a.settings,
      b.settings,
    );
  check("overrides", "사람이 지정한 판단", ao, bo);
  return { keys, labels };
}

const LEGEND_STATUSES: ExecutionStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "BLOCKED"];
const LEGEND_RESOLVERS: ResolverType[] = ["RULE", "LLM"];

export function Demo() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const scenario = getScenario(scenarioId) ?? SCENARIOS[0];
  const [draft, setDraft] = useState<Draft>(scenario.exampleDraft);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [applied, setApplied] = useState<{ draft: Draft; overrides: Record<string, Override> } | null>(null);
  const [states, setStates] = useState<Record<string, NodeState>>({});
  const [run, setRun] = useState<RunResult | null>(null);
  const [prevRun, setPrevRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [failureDemo, setFailureDemo] = useState(false);
  const [mission, setMission] = useState<Mission | null>(null);
  const [missionApplied, setMissionApplied] = useState(false);
  const [llmOnly, setLlmOnly] = useState<LLMOnlyResult | null>(null);
  const [llmRunning, setLlmRunning] = useState(false);
  const [tab, setTab] = useState<"llm-only" | "hetero">("hetero");
  /** Correct outcome and step results of the last judged input (unknown for custom text or with a human override). */
  const [truth, setTruth] = useState<{ decision: string; nodes: Record<string, string> } | undefined>(undefined);

  const graph = useMemo(() => scenario.buildGraph(draft.settings), [scenario, draft.settings]);
  const graphErrors = useMemo(() => validateGraph(graph), [graph]);
  const pending = useMemo(
    () =>
      applied ? diffDraft(scenario, applied.draft, draft, applied.overrides, overrides) : { keys: new Set<string>(), labels: [] },
    [scenario, applied, draft, overrides],
  );
  const changedNodes = useMemo(() => {
    const set = new Set<string>();
    if (run && prevRun) for (const n of graph.nodes) if (nodeChange(run, prevRun, n.id)) set.add(n.id);
    return set;
  }, [run, prevRun, graph]);
  /** Display names for trace entries: scenario fields and node labels. */
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of scenario.fields) m[f.key] = f.label;
    for (const n of graph.nodes) m[n.id] = n.label.replace(/\?$/, "");
    return m;
  }, [scenario, graph]);

  const runLLMOnly = async (sc: Scenario, d: Draft) => {
    setLlmRunning(true);
    setLlmOnly(null);
    try {
      const res = await fetch("/api/llm-only", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: sc.id, input: toInput(sc, d), settings: d.settings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setLlmOnly({ ok: false, error: data.error ?? `요청 실패 (${res.status})` });
      const schema = z.object({
        action: z.enum(sc.actions as [string, ...string[]]),
        reason: z.string().min(1),
        checks: z.record(z.string(), z.string()).optional(),
      });
      const parsed = schema.safeParse(data.raw);
      if (!parsed.success)
        return setLlmOnly({ ok: false, error: "LLM의 답이 약속된 형식과 달라 결과로 쓸 수 없습니다.", model: data.model });
      setLlmOnly({ ok: true, ...parsed.data, model: data.model, source: data.source, recordedAt: data.recordedAt });
    } catch {
      setLlmOnly({ ok: false, error: "LLM 단독 요청에 실패했습니다." });
    } finally {
      setLlmRunning(false);
    }
  };

  const execute = async (
    sc: Scenario,
    d: Draft,
    o: Record<string, Override>,
    provider: LLMProvider,
    opts: { previous: RunResult | null; failure?: boolean },
  ): Promise<RunResult> => {
    setRunning(true);
    setFailureDemo(!!opts.failure);
    setTruth(undefined);
    if (!opts.failure && Object.keys(o).length === 0)
      void groundTruth(sc, d).then((t) =>
        setTruth(
          t && {
            decision: String(t.decision),
            nodes: Object.fromEntries(Object.entries(t.nodes).map(([k, v]) => [k, formatValue(v)])),
          },
        ),
      );
    // LLM Only runs on the same input at the same time, so both conclusions appear side by side.
    if (opts.failure) setLlmOnly(null);
    else void runLLMOnly(sc, d);
    try {
      const result = await runGraph(sc.buildGraph(d.settings), toInput(sc, d), {
        functions: sc.functions,
        llm: provider,
        onUpdate: setStates,
        minRunMs: opts.previous ? 300 : 450,
        overrides: o,
        previous: opts.previous,
      });
      setStates(result.states);
      setPrevRun(opts.previous);
      setRun(result);
      setApplied({ draft: d, overrides: o });
      return result;
    } finally {
      setRunning(false);
    }
  };

  const onRun = () => {
    // Usage event (no personal data): how many pending changes were applied, in which scenario and mission.
    track("run", { scenario: scenario.id, changes: pending.labels.length, mission: mission?.id ?? "none" });
    if (mission) setMissionApplied(true);
    // Reuse only across normal runs; a failure-example run is not a valid base.
    return execute(scenario, draft, overrides, httpLLM(scenario.id), { previous: failureDemo ? null : run });
  };

  const clear = (sc: Scenario) => {
    setDraft(sc.exampleDraft);
    setOverrides({});
    setApplied(null);
    setStates({});
    setRun(null);
    setPrevRun(null);
    setLlmOnly(null);
    setFailureDemo(false);
    setMission(null);
    setTruth(undefined);
  };

  const switchScenario = (id: string) => {
    const sc = getScenario(id);
    if (!sc || sc.id === scenario.id) return;
    track("scenario", { id });
    setScenarioId(sc.id);
    clear(sc);
  };

  const startMission = async (sc: Scenario, m: Mission) => {
    track("mission", { scenario: sc.id, id: m.id });
    setMission(m);
    setMissionApplied(false);
    // Baseline: the example as it is, so the comparison starts from a known state.
    await execute(sc, sc.exampleDraft, {}, httpLLM(sc.id), { previous: null });
    const next = m.apply(sc.exampleDraft);
    setDraft(next.draft);
    setOverrides(next.overrides ?? {});
  };

  /** Loads a benchmark case into the input and judges it once with both approaches. */
  const runCase = (c: BenchCase) => {
    track("bench_case", { scenario: scenario.id, id: c.id });
    const d = c.apply(scenario.exampleDraft);
    setMission(null);
    setOverrides({});
    setDraft(d);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return execute(scenario, d, {}, httpLLM(scenario.id), { previous: null });
  };

  const runFailure = () => {
    track("failure_example", { scenario: scenario.id });
    setMission(null);
    return execute(scenario, draft, overrides, malformedLLM, { previous: null, failure: true });
  };

  const setOverride = (nodeId: string, value: boolean | null) => {
    const next = { ...overrides };
    if (value === null) delete next[nodeId];
    else next[nodeId] = { result: value, note: `사람이 ‘${value ? "예" : "아니오"}’로 직접 지정` };
    setOverrides(next);
  };

  // ?s=<scenario>&run=example | failure | mission-<id> | problem-<id> starts on load (direct links and portfolio screenshots).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sc = getScenario(q.get("s")) ?? SCENARIOS[0];
    const r = q.get("run");
    const timer = setTimeout(() => {
      if (sc.id !== scenario.id) {
        setScenarioId(sc.id);
        clear(sc);
      }
      if (r === "example") void execute(sc, sc.exampleDraft, {}, httpLLM(sc.id), { previous: null });
      if (r === "failure") void execute(sc, sc.exampleDraft, {}, malformedLLM, { previous: null, failure: true });
      const m = sc.missions.find((x) => r === `mission-${x.id}`);
      if (m) void startMission(sc, m);
      const c = sc.cases.find((x) => r === `problem-${x.id}`);
      if (c) {
        const d = c.apply(sc.exampleDraft);
        setDraft(d);
        void execute(sc, d, {}, httpLLM(sc.id), { previous: null });
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPending = pending.labels.length > 0;
  const runLabel = running ? "실행 중…" : !run ? "판단 실행" : hasPending ? `다시 판단 (변경 ${pending.labels.length}건)` : "다시 판단";
  const llmNodeLabels = graph.nodes.filter((n) => n.resolver_type === "LLM").map((n) => n.label.replace(/\?$/, ""));

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>판단구조 실행 데모</h1>
          <p className={s.subtitle}>
            판단구조를 명시하고, 판단마다 규칙과 LLM 중 알맞은 방법을 써서, 과정을 추적하고 부분만 고칠 수 있게 합니다.
          </p>
        </div>
      </header>

      <div className={s.scenarioBar} role="tablist" aria-label="시나리오">
        {SCENARIOS.map((sc, i) => (
          <button
            key={sc.id}
            role="tab"
            aria-selected={sc.id === scenario.id}
            className={sc.id === scenario.id ? `${s.scenarioCard} ${s.scenarioOn}` : s.scenarioCard}
            onClick={() => switchScenario(sc.id)}
            disabled={running}
          >
            <span className={s.scenarioNo}>시나리오 {i + 1}</span>
            <span className={s.scenarioName}>{sc.name}</span>
            <span className={s.scenarioRole}>{sc.role}</span>
          </button>
        ))}
      </div>
      <p className={s.disclaimer}>{scenario.disclaimer}</p>

      <section className={s.missions} aria-labelledby="missions-h">
        <h2 id="missions-h" className={s.missionsTitle}>
          직접 체험해 보기 <span className={s.muted}>— 상황을 하나 고르면 값이 바뀝니다. 확인한 뒤 [다시 판단]을 누르세요.</span>
        </h2>
        <div className={s.missionGrid}>
          {scenario.missions.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={mission?.id === m.id ? `${s.missionCard} ${s.missionOn}` : s.missionCard}
              onClick={() => startMission(scenario, m)}
              disabled={running}
            >
              <span className={s.missionNo}>{i + 1}</span>
              {m.title}
            </button>
          ))}
        </div>
      </section>

      <div className={s.legend}>
        <span className={s.legendTitle}>판단방법</span>
        {LEGEND_RESOLVERS.map((r) => (
          <span key={r} className={s.legendItem}>
            <ResolverBadge type={r} /> {RESOLVER_MEANING[r]}
          </span>
        ))}
        <span className={s.legendSep} />
        <span className={s.legendTitle}>상태</span>
        {LEGEND_STATUSES.map((st) => (
          <span key={st} className={s.legendItem} title={STATUS_TEXT[st].meaning}>
            <StatusPill status={st} />
          </span>
        ))}
      </div>

      <main className={s.layout}>
        {/* LEFT — Input (fixed) */}
        <section className={`${s.panel} ${s.inputPanel}`} aria-labelledby="input-h">
          <h2 id="input-h" className={s.panelTitle}>
            <span className={s.step}>1</span> 입력
          </h2>
          <InputPanel scenario={scenario} draft={draft} setDraft={setDraft} changed={pending.keys} />
          {mission && !missionApplied && run && hasPending && (
            <p className={s.missionHint}>
              <b>{mission.what}</b> 아래 [다시 판단]을 눌러 무엇이 바뀌는지 확인해 보세요.
            </p>
          )}
          {hasPending && (
            <ul className={s.pendingList} aria-label="아직 적용되지 않은 변경">
              {pending.labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <div className={s.actions}>
            <button className={`${s.primary} ${hasPending ? s.primaryPulse : ""}`} onClick={onRun} disabled={running}>
              {runLabel}
            </button>
            <button className={s.secondary} onClick={() => clear(scenario)} disabled={running}>
              처음으로
            </button>
          </div>
        </section>

        {/* RIGHT — the two approaches as tabs, with a one-line comparison on top */}
        <div className={s.rightArea}>
          <ResultCompare
            graph={graph}
            run={run}
            running={running}
            llmOnly={llmOnly}
            llmRunning={llmRunning}
            failureDemo={failureDemo}
            truth={truth}
          />

          <div className={s.tabs} role="tablist" aria-label="판단 방식">
            {(
              [
                ["llm-only", "LLM 단독", llmRunning ? "판단 중…" : llmOnly?.ok ? llmOnly.action : undefined],
                ["hetero", "LLM + 규칙", running ? "판단 중…" : run ? (run.decisionStatus === "SUCCEEDED" ? String(run.decision) : "판단 불가") : undefined],
              ] as const
            ).map(([id, label, result]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? `${s.tab} ${s.tabOn}` : s.tab}
                onClick={() => setTab(id)}
              >
                <span className={s.tabLabel}>{label}</span>
                {result && <span className={s.tabResult}>{result}</span>}
              </button>
            ))}
          </div>

          <section className={`${s.panel} ${s.tabBody}`} aria-label={tab === "hetero" ? "LLM + 규칙" : "LLM 단독"}>
            {tab === "llm-only" ? (
              <LLMOnlyPanel scenario={scenario} result={failureDemo ? null : llmOnly} running={llmRunning} truth={truth} />
            ) : (
              <div className={s.tabGrid}>
                <div className={s.tabCol}>
                  <h3 className={s.colTitle}>판단구조</h3>
                  <p className={s.caption}>
                    <b>무엇을 판단할지</b>(판단과 의존관계)는 그래프에 고정되어 있고, <b>어떻게 판단할지</b>는 각 상자의
                    판단방법(규칙 · LLM)이 정합니다. LLM은 글을 읽어야 하는 곳({llmNodeLabels.join(", ")})에만 쓰입니다.
                  </p>
                  {failureDemo && (
                    <p className={s.failBanner}>
                      실패 예시: LLM 단계가 <b>약속된 형식을 어긴 출력</b>을 받도록 시뮬레이션했습니다. 어디서 실패했고, 그
                      영향이 어디까지 전파되는지 확인해 보세요.
                    </p>
                  )}
                  <DagView graph={graph} states={states} changed={changedNodes} />
                  <p className={s.graphCheck}>
                    {graphErrors.length === 0
                      ? `✓ 실행 전 구조 검사 통과: 판단 ${graph.nodes.length}개, 중복·누락된 의존관계·순환 없음`
                      : `✕ ${graphErrors.join("; ")}`}
                  </p>
                  <PolicyTable graph={graph} states={states} />
                </div>
                <div className={s.tabCol}>
                  <h3 className={s.colTitle}>최종 판단</h3>
                  <HeteroDecision run={run} running={running} />
                  {run && prevRun && !running && (
                    <ChangeSummary
                      graph={graph}
                      run={run}
                      prev={prevRun}
                      benefit={missionApplied ? mission?.benefit : undefined}
                      llmOnlyNote={missionApplied ? mission?.llmOnly : undefined}
                    />
                  )}
                  <h3 className={s.colTitle}>판단과정 (실행된 순서대로)</h3>
                  {run ? (
                    <TracePanel
                      trace={run.trace}
                      decisionNode={graph.decision_node}
                      overrides={overrides}
                      onOverride={setOverride}
                      names={names}
                    />
                  ) : (
                    <p className={s.muted}>실행 후 각 판단이 무엇을 보고 어떤 방법으로 결론을 냈는지 여기에 표시됩니다.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <BenchmarkPanel scenario={scenario} onRunCase={runCase} disabled={running} />

      {run && <Comparison llmScope={llmNodeLabels.join(", ")} />}

      <section className={s.more}>
        <details>
          <summary>판단구조 ≠ 판단방법 — 핵심 아이디어</summary>
          <div className={s.moreBody}>
            <p>
              <b>판단구조</b>는 <i>무엇을 판단해야 하고, 각 판단이 무엇에 의존하는지</i>를 정합니다. 이 데모에서는 판단구조
              탭의 그래프(DAG)입니다.
            </p>
            <p>
              <b>판단방법</b>은 <i>각 판단을 어떻게 수행하는지</i>를 정합니다:{" "}
              <span className={`${s.badge} ${s.badge_RULE}`}>≡ 규칙</span> 조건·계산처럼 같은 입력이면 항상 같은 결과가 나오는 판단,{" "}
              <span className={`${s.badge} ${s.badge_LLM}`}>✦ LLM</span> 글(비정형 기록)을 읽어야 하는 판단.
            </p>
            <p>
              판단이 나뉘어 있기 때문에, 입력이 그대로인 판단은 재사용하고, 틀린 판단 하나만 사람이 고치고, 규칙 하나만 바꿀
              수 있습니다. LLM은 전체를 결정하는 주체가 아니라, 명시된 구조 안에서 쓰이는 판단방법 중 하나입니다.
            </p>
          </div>
        </details>
        <details>
          <summary>이 데모를 만든 이유</summary>
          <div className={s.moreBody}>
            <p>
              개인 프로젝트로 생성형 AI를 세무 판단에 적용하면서, 결론 전체를 LLM에 맡기면 반드시 거쳐야 할 판단경로가
              드러나지 않는다는 문제를 겪었습니다. 그래서 판단구조를 명시하고, 판단마다 알맞은 방법을 연결하고, 실행과정을
              추적하는 구조를 만들었습니다.
            </p>
            <p>
              시나리오 1(세무)은 그 원래 문제를 공개 법령 수준으로 단순화한 것이고, 시나리오 2(설비)는 같은 구조를 전혀 다른
              도메인에 적용한 것입니다. 도메인이 바뀌어도 ‘판단구조와 판단방법의 분리’가 그대로 작동함을 보여줍니다.
            </p>
          </div>
        </details>
        <details>
          <summary>실패 예시 실행해 보기</summary>
          <div className={s.moreBody}>
            <p>
              같은 그래프를 실행하되, LLM 단계가 약속된 형식을 어긴 답(<code>decision: &quot;아마 아닐 것&quot;</code> — 예/아니오가
              아닌 글)을 받도록 합니다. 그 단계는 <b>실패</b>로 표시되고, 그 결과가 필요한 다음 단계는 <b>차단</b>됩니다. 서로
              관계없는 규칙 판단은 그대로 끝까지 실행됩니다.
            </p>
            <button className={s.secondary} onClick={runFailure} disabled={running}>
              실패 예시 실행
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}

function HeteroDecision({ run, running }: { run: RunResult | null; running: boolean }) {
  if (running) return <div className={`${s.decision} ${s.decisionIdle}`}>판단하는 중입니다…</div>;
  if (!run)
    return (
      <div className={`${s.decision} ${s.decisionIdle}`}>
        왼쪽의 <b>[판단 실행]</b>을 누르면 최종 판단이 여기에 표시됩니다.
      </div>
    );
  const ok = run.decisionStatus === "SUCCEEDED";
  return (
    <div className={ok ? s.decision : `${s.decision} ${s.decisionBlocked}`}>
      <div className={s.decisionLabel}>LLM + 규칙의 결론</div>
      <div className={s.decisionValue}>{ok ? String(run.decision) : "판단 불가"}</div>
      <div className={s.decisionNote}>
        {ok ? "단순화한 데모 정책에 따른 결과이며, 실제 자문이나 운영 권고가 아닙니다." : "실패한 단계와 차단된 단계는 아래 판단과정에서 확인할 수 있습니다."}
      </div>
    </div>
  );
}

function Comparison({ llmScope }: { llmScope: string }) {
  const rows: [string, string, string][] = [
    ["판단경로", "보이지 않음 (LLM 내부)", "그래프로 명시"],
    ["조건·계산 판단", "LLM이 해석 (날짜·횟수 계산도 LLM이 수행)", "규칙이 정확히 처리"],
    ["LLM이 맡는 범위", "결론 전체", `글을 읽어야 하는 단계만 (${llmScope})`],
    ["입력 일부가 바뀌면", "전체를 다시 판단", "바뀐 판단만 다시, 나머지는 재사용"],
    ["판단 하나가 틀렸다면", "결론 전체를 다시 요청", "그 판단만 사람이 지정, 영향받는 단계만 재계산"],
    ["규칙이 바뀌면", "정책 문장을 고쳐 다시 요청", "해당 규칙 단계만 반영"],
    ["추적", "최종 설명 하나", "단계별: 본 입력, 방법, 결과, 근거, 누가 정했는지"],
    ["실패할 때", "답 전체를 쓸 수 없음", "실패한 단계가 특정되고, 영향받는 단계만 차단"],
  ];
  return (
    <section className={s.compare} aria-labelledby="cmp-h">
      <h2 id="cmp-h" className={s.panelTitle}>
        두 방식의 구조 비교
      </h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th />
            <th>LLM 단독</th>
            <th>LLM + 규칙</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.muted}>
        이 표는 구조의 차이를 비교한 것입니다. LLM + 규칙 방식이 항상 더 정확하다고 주장하지 않습니다.
      </p>
    </section>
  );
}
