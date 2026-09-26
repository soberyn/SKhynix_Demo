"use client";

import { track } from "@vercel/analytics";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { runGraph } from "@/core/engine";
import type { LLMProvider } from "@/core/resolvers";
import type { ExecutionStatus, NodeState, Override, ResolverType, RunResult } from "@/core/types";
import { validateGraph } from "@/core/validate";
import { httpLLM, malformedLLM } from "@/lib/http-llm";
import {
  ACTIONS,
  DEFAULT_SETTINGS,
  DISCLAIMER,
  EQUIPMENT_CODE,
  EXAMPLE_INPUT,
  NOTE_PRESETS,
  buildEquipmentGraph,
  type EquipmentInput,
} from "@/scenario/equipment";
import { ChangeSummary, nodeChange } from "./ChangeSummary";
import { DagView } from "./DagView";
import { InputPanel, noteText, type Draft } from "./InputPanel";
import { PolicyTable } from "./PolicyTable";
import { RESOLVER_MEANING, ResolverBadge, STATUS_TEXT, SourceTag, StatusPill } from "./bits";
import { DecisionCard, TracePanel } from "./TracePanel";
import s from "./demo.module.css";

type Mode = "structured" | "llm-only";

const LLMOnlySchema = z.object({
  action: z.enum(Object.values(ACTIONS) as [string, ...string[]]),
  reason: z.string().min(1),
});

interface LLMOnlyResult {
  ok: boolean;
  action?: string;
  reason?: string;
  error?: string;
  model?: string;
  source?: "live" | "recorded";
  recordedAt?: string;
}

const EXAMPLE_DRAFT: Draft = {
  pressure: EXAMPLE_INPUT.pressure,
  pressure_limit: EXAMPLE_INPUT.pressure_limit,
  evaluation_time: EXAMPLE_INPUT.evaluation_time,
  alarms: EXAMPLE_INPUT.alarm_history.split("\n").map((text) => ({ text, on: true })),
  noteId: NOTE_PRESETS[0].id,
  customNote: "",
  settings: DEFAULT_SETTINGS,
};

function toInput(d: Draft): EquipmentInput {
  return {
    pressure: d.pressure,
    pressure_limit: d.pressure_limit,
    evaluation_time: d.evaluation_time,
    alarm_history: d.alarms.filter((a) => a.on).map((a) => a.text).join("\n"),
    maintenance_note: noteText(d),
  };
}

/** Human-readable list of what differs between the applied state and the draft. */
function diffDraft(a: Draft, b: Draft, ao: Record<string, Override>, bo: Record<string, Override>) {
  const keys = new Set<string>();
  const labels: string[] = [];
  const check = (key: string, label: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      keys.add(key);
      labels.push(label);
    }
  };
  check("pressure", `챔버 압력 ${a.pressure} → ${b.pressure}`, a.pressure, b.pressure);
  check("pressure_limit", `압력 기준값 ${a.pressure_limit} → ${b.pressure_limit}`, a.pressure_limit, b.pressure_limit);
  check("evaluation_time", "판단 시각", a.evaluation_time, b.evaluation_time);
  check("alarms", "알람 이력", a.alarms, b.alarms);
  check("note", "정비 기록", noteText(a), noteText(b));
  check("settings", `규칙 값 (${a.settings.threshold}회/${a.settings.windowHours}시간 → ${b.settings.threshold}회/${b.settings.windowHours}시간)`, a.settings, b.settings);
  check("overrides", "사람이 지정한 판단", ao, bo);
  return { keys, labels };
}

interface Mission {
  id: string;
  title: string;
  what: string;
  apply: (d: Draft) => { draft: Draft; overrides?: Record<string, Override> };
  benefit: string;
  llmOnly: string;
}

const MISSIONS: Mission[] = [
  {
    id: "pressure",
    title: "압력이 정상으로 돌아오면?",
    what: "챔버 압력을 9.5 Pa로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, pressure: "9.5" } }),
    benefit: "결론이 왜 바뀌었는지 ‘압력 이상’ 한 단계로 바로 추적됩니다.",
    llmOnly: "LLM 단독이라면 전체를 다시 묻고, 새 설명문을 이전 설명과 비교해 무엇이 바뀌었는지 직접 찾아야 합니다.",
  },
  {
    id: "override",
    title: "엔지니어가 센서를 의심한다면?",
    what: "‘센서 고장 근거가 있는가?’를 사람이 ‘예’로 지정했습니다.",
    apply: (d) => ({ draft: d, overrides: { sensor_fault_evidence: { result: true, note: "엔지니어가 현장 확인 후 ‘예’로 지정" } } }),
    benefit: "AI의 판단 하나만 사람이 고쳤고, 그 결과에 의존하는 조치만 다시 정해졌습니다. 누가 무엇을 고쳤는지 판단과정에 남습니다.",
    llmOnly: "LLM 단독이라면 AI의 결론 전체에 반박하고, 새 결론이 내 의견을 제대로 반영했는지 다시 읽어 확인해야 합니다.",
  },
  {
    id: "policy",
    title: "알람 기준이 5회로 바뀌면?",
    what: "규칙 값 ‘알람 기준 횟수’를 3회 → 5회로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, settings: { ...d.settings, threshold: 5 } } }),
    benefit: "바뀐 규칙은 그 규칙을 쓰는 CODE 단계에만 반영됩니다. 같은 입력이면 언제나 같은 결과입니다.",
    llmOnly: "LLM 단독이라면 정책 문장을 고쳐 다시 묻고, 새 기준을 정확히 적용했는지 설명문을 읽어 확인해야 합니다.",
  },
  {
    id: "note",
    title: "정비 기록 내용이 다르면?",
    what: "정비 기록을 ‘센서 이상 정황 있음’으로 바꿨습니다.",
    apply: (d) => ({ draft: { ...d, noteId: "suspect" } }),
    benefit: "AI 단계는 바뀐 정비 기록을 읽는 그 한 단계만 다시 실행되었고, 압력·알람 판단은 재사용되었습니다.",
    llmOnly: "LLM 단독이라면 기록 하나만 바뀌어도 모든 조건을 처음부터 다시 판단합니다.",
  },
];

const LEGEND_STATUSES: ExecutionStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "BLOCKED"];
const LEGEND_RESOLVERS: ResolverType[] = ["RULE", "CODE", "LLM"];

export function Demo() {
  const [mode, setMode] = useState<Mode>("structured");
  const [draft, setDraft] = useState<Draft>(EXAMPLE_DRAFT);
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

  const graph = useMemo(() => buildEquipmentGraph(draft.settings), [draft.settings]);
  const graphErrors = useMemo(() => validateGraph(graph), [graph]);
  const pending = useMemo(
    () => (applied ? diffDraft(applied.draft, draft, applied.overrides, overrides) : { keys: new Set<string>(), labels: [] }),
    [applied, draft, overrides],
  );

  const changedNodes = useMemo(() => {
    const set = new Set<string>();
    if (run && prevRun) for (const n of graph.nodes) if (nodeChange(run, prevRun, n.id)) set.add(n.id);
    return set;
  }, [run, prevRun, graph]);

  const execute = async (
    d: Draft,
    o: Record<string, Override>,
    provider: LLMProvider,
    opts: { previous: RunResult | null; failure?: boolean },
  ): Promise<RunResult> => {
    setMode("structured");
    setRunning(true);
    setFailureDemo(!!opts.failure);
    try {
      const result = await runGraph(buildEquipmentGraph(d.settings), toInput(d), {
        code: EQUIPMENT_CODE,
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
    // Usage events (no personal data): which mode, and how many pending changes were applied.
    track("run", { mode, changes: pending.labels.length, mission: mission?.id ?? "none" });
    if (mode === "llm-only") return runLLMOnly();
    if (mission) setMissionApplied(true);
    // Reuse only across normal runs; a failure-example run is not a valid base.
    return execute(draft, overrides, httpLLM, { previous: failureDemo ? null : run });
  };

  const startMission = async (m: Mission) => {
    track("mission", { id: m.id });
    setMission(m);
    setMissionApplied(false);
    // Baseline: the example as it is, so the comparison starts from a known state.
    await execute(EXAMPLE_DRAFT, {}, httpLLM, { previous: null });
    const next = m.apply(EXAMPLE_DRAFT);
    setDraft(next.draft);
    setOverrides(next.overrides ?? {});
  };

  const runFailure = () => {
    track("failure_example");
    setMission(null);
    return execute(draft, overrides, malformedLLM, { previous: null, failure: true });
  };

  const runLLMOnly = async () => {
    setRunning(true);
    setLlmOnly(null);
    try {
      const res = await fetch("/api/llm-only", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: toInput(draft), settings: draft.settings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setLlmOnly({ ok: false, error: data.error ?? `요청 실패 (${res.status})` });
      const parsed = LLMOnlySchema.safeParse(data.raw);
      if (!parsed.success)
        return setLlmOnly({ ok: false, error: "AI의 답이 약속된 형식과 달라 결과로 쓸 수 없습니다.", model: data.model });
      setLlmOnly({ ok: true, ...parsed.data, model: data.model, source: data.source, recordedAt: data.recordedAt });
    } finally {
      setRunning(false);
    }
  };

  const setOverride = (nodeId: string, value: boolean | null) => {
    const next = { ...overrides };
    if (value === null) delete next[nodeId];
    else next[nodeId] = { result: value, note: `엔지니어가 ‘${value ? "예" : "아니오"}’로 직접 지정` };
    setOverrides(next);
  };

  const reset = () => {
    setDraft(EXAMPLE_DRAFT);
    setOverrides({});
    setApplied(null);
    setStates({});
    setRun(null);
    setPrevRun(null);
    setLlmOnly(null);
    setFailureDemo(false);
    setMission(null);
  };

  // ?run=example | failure | mission-<id> starts on load (direct links and portfolio screenshots).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("run");
    const timer = setTimeout(() => {
      if (q === "example") void execute(EXAMPLE_DRAFT, {}, httpLLM, { previous: null });
      if (q === "failure") void execute(EXAMPLE_DRAFT, {}, malformedLLM, { previous: null, failure: true });
      const m = MISSIONS.find((x) => q === `mission-${x.id}`);
      if (m) void startMission(m);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPending = pending.labels.length > 0;
  const runLabel = running
    ? "실행 중…"
    : mode === "llm-only"
      ? "LLM 단독으로 판단"
      : !run
        ? "판단 실행"
        : hasPending
          ? `다시 판단 (변경 ${pending.labels.length}건)`
          : "다시 판단";

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>판단구조 실행 데모</h1>
          <p className={s.subtitle}>
            판단구조를 명시하고, 각 판단을 Rule · Code · LLM 중 알맞은 방법으로 실행해 과정을 추적합니다.
          </p>
        </div>
        <div className={s.modes} role="tablist" aria-label="실행 방식">
          <button role="tab" aria-selected={mode === "structured"} className={mode === "structured" ? s.modeOn : s.mode} onClick={() => setMode("structured")}>
            구조화된 판단
          </button>
          <button role="tab" aria-selected={mode === "llm-only"} className={mode === "llm-only" ? s.modeOn : s.mode} onClick={() => setMode("llm-only")}>
            LLM 단독 (비교용)
          </button>
        </div>
      </header>
      <p className={s.disclaimer}>{DISCLAIMER}</p>

      <section className={s.missions} aria-labelledby="missions-h">
        <h2 id="missions-h" className={s.missionsTitle}>
          직접 체험해 보기 <span className={s.muted}>— 상황을 하나 고르면 값이 바뀝니다. 확인한 뒤 [다시 판단]을 누르세요.</span>
        </h2>
        <div className={s.missionGrid}>
          {MISSIONS.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={mission?.id === m.id ? `${s.missionCard} ${s.missionOn}` : s.missionCard}
              onClick={() => startMission(m)}
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

      <main className={s.grid}>
        {/* LEFT — Input */}
        <section className={s.panel} aria-labelledby="input-h">
          <h2 id="input-h" className={s.panelTitle}>
            <span className={s.step}>1</span> 입력
          </h2>
          <InputPanel draft={draft} setDraft={setDraft} changed={pending.keys} />
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
            <button className={s.secondary} onClick={reset} disabled={running}>
              처음으로
            </button>
          </div>
        </section>

        {/* CENTER — Judgment DAG / LLM Only flow */}
        <section className={`${s.panel} ${s.center}`} aria-labelledby="graph-h">
          <h2 id="graph-h" className={s.panelTitle}>
            <span className={s.step}>2</span> {mode === "structured" ? "판단구조 (DAG)" : "LLM 단독 방식"}
          </h2>
          {mode === "structured" ? (
            <>
              <p className={s.caption}>
                <b>무엇을 판단할지</b>(판단과 의존관계)는 이 그래프에 고정되어 있고, <b>어떻게 판단할지</b>는 각 상자의
                판단방법(RULE · CODE · LLM)이 정합니다. AI(LLM)는 글을 읽어야 하는 한 곳에만 쓰입니다.
              </p>
              {failureDemo && (
                <p className={s.failBanner}>
                  실패 예시: AI 단계가 <b>약속된 형식을 어긴 출력</b>을 받도록 시뮬레이션했습니다. 어디서 실패했고, 그 영향이
                  어디까지 전파되는지 확인해 보세요.
                </p>
              )}
              <DagView graph={graph} states={states} changed={changedNodes} />
              <p className={s.graphCheck}>
                {graphErrors.length === 0
                  ? `✓ 실행 전 구조 검사 통과: 판단 ${graph.nodes.length}개, 중복·누락된 의존관계·순환 없음`
                  : `✕ ${graphErrors.join("; ")}`}
              </p>
              <PolicyTable graph={graph} states={states} />
            </>
          ) : (
            <div className={s.llmOnlyFlow}>
              <div className={s.flowBox}>입력 전체 + 같은 정책 문장</div>
              <div className={s.flowArrow}>↓</div>
              <div className={`${s.flowBox} ${s.flowLLM}`}>
                <span className={`${s.badge} ${s.badge_LLM}`}>✦ LLM</span> AI 한 번의 호출이 모든 판단을 함께 수행
              </div>
              <div className={s.flowArrow}>↓</div>
              <div className={s.flowBox}>조치 + 설명 한 덩어리</div>
              <p className={s.caption}>
                구조화된 판단과 같은 입력·같은 정책을 씁니다. AI가 틀리도록 일부러 조작하지 않았으며, 두 방식의 결론이 같을
                수도 있습니다. 차이는 정답 여부가 아니라 <b>과정이 보이느냐, 일부만 고칠 수 있느냐</b>입니다.
              </p>
            </div>
          )}
        </section>

        {/* RIGHT — Decision / Trace */}
        <section className={s.panel} aria-labelledby="decision-h">
          <h2 id="decision-h" className={s.panelTitle}>
            <span className={s.step}>3</span> {mode === "structured" ? "최종 판단과 판단과정" : "LLM 단독 결과"}
          </h2>
          {mode === "structured" ? (
            <>
              <DecisionCard run={run} running={running} graph={graph} />
              {run && prevRun && !running && (
                <ChangeSummary
                  graph={graph}
                  run={run}
                  prev={prevRun}
                  benefit={missionApplied ? mission?.benefit : undefined}
                  llmOnlyNote={missionApplied ? mission?.llmOnly : undefined}
                />
              )}
              {run && <h3 className={s.subTitle}>판단과정 추적 (실행된 순서대로)</h3>}
              <TracePanel
                trace={run?.trace ?? []}
                decisionNode={graph.decision_node}
                overrides={overrides}
                onOverride={setOverride}
              />
            </>
          ) : (
            <LLMOnlyResultView result={llmOnly} running={running} />
          )}
        </section>
      </main>

      {(run || llmOnly) && <Comparison run={run} llmOnly={llmOnly} />}

      <section className={s.more}>
        <details>
          <summary>판단구조 ≠ 판단방법 — 핵심 아이디어</summary>
          <div className={s.moreBody}>
            <p>
              <b>판단구조</b>는 <i>무엇을 판단해야 하고, 각 판단이 무엇에 의존하는지</i>를 정합니다. 이 데모에서는 가운데의
              그래프(DAG)입니다.
            </p>
            <p>
              <b>판단방법</b>은 <i>각 판단을 어떻게 수행하는지</i>를 정합니다:{" "}
              <span className={`${s.badge} ${s.badge_RULE}`}>≡ RULE</span> 정해진 조건,{" "}
              <span className={`${s.badge} ${s.badge_CODE}`}>{"{ }"} CODE</span> 정확한 계산,{" "}
              <span className={`${s.badge} ${s.badge_LLM}`}>✦ LLM</span> 비정형 기록 해석.
            </p>
            <p>
              판단이 나뉘어 있기 때문에, 입력이 그대로인 판단은 재사용하고, 틀린 판단 하나만 사람이 고치고, 규칙 하나만 바꿀
              수 있습니다. AI(LLM)는 전체를 결정하는 주체가 아니라, 명시된 구조 안에서 쓰이는 판단방법 중 하나입니다.
            </p>
          </div>
        </details>
        <details>
          <summary>이 데모를 만든 이유</summary>
          <div className={s.moreBody}>
            <p>
              개인 프로젝트로 생성형 AI를 세무 판단에 적용하면서, 결론 전체를 LLM에 맡기면 반드시 거쳐야 할 판단경로가
              드러나지 않는다는 문제를 겪었습니다.
            </p>
            <p>
              그래서 판단구조를 명시하고, 판단마다 알맞은 방법을 연결하고, 실행과정을 추적하는 구조를 만들었습니다. 이 데모는
              그 구조를 가상의 설비 시나리오로 다시 구현해, 도메인이 바뀌어도 ‘판단구조와 판단방법의 분리’가 그대로
              작동함을 보여줍니다.
            </p>
          </div>
        </details>
        <details>
          <summary>실패 예시 실행해 보기</summary>
          <div className={s.moreBody}>
            <p>
              같은 그래프를 실행하되, AI 단계가 약속된 형식을 어긴 답(<code>decision: &quot;아마 아닐 것&quot;</code> — 예/아니오가
              아닌 글)을 받도록 합니다. 그 단계는 <b>실패</b>로 표시되고, 그 결과가 필요한 최종 조치는 <b>차단</b>됩니다. 서로
              관계없는 RULE · CODE 판단은 그대로 끝까지 실행됩니다.
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

function LLMOnlyResultView({ result, running }: { result: LLMOnlyResult | null; running: boolean }) {
  if (running) return <div className={`${s.decision} ${s.decisionIdle}`}>AI의 답을 기다리는 중입니다…</div>;
  if (!result)
    return (
      <div className={`${s.decision} ${s.decisionIdle}`}>
        <b>[LLM 단독으로 판단]</b>을 누르면 같은 입력을 AI 한 번에 맡긴 결과가 표시됩니다.
      </div>
    );
  if (!result.ok)
    return (
      <div className={`${s.decision} ${s.decisionBlocked}`}>
        <div className={s.decisionLabel}>LLM 단독</div>
        <div className={s.decisionNote}>{result.error}</div>
      </div>
    );
  return (
    <>
      <div className={s.decision}>
        <div className={s.decisionLabel}>AI의 권고</div>
        <div className={s.decisionValue}>{result.action}</div>
        <div className={s.decisionNote}>
          <SourceTag source={result.source ?? "live"} model={result.model} recordedAt={result.recordedAt} />
        </div>
      </div>
      <h3 className={s.subTitle}>AI의 설명 (최종 설명 하나)</h3>
      <p className={s.llmReason}>{result.reason}</p>
      <p className={s.muted}>
        단계별 추적이 없습니다. 어떤 조건을 어떤 순서로 확인했는지는 설명 문장 안에 암묵적으로만 들어 있고, 일부만 고치거나
        재사용할 수 없습니다.
      </p>
    </>
  );
}

function Comparison({ run, llmOnly }: { run: RunResult | null; llmOnly: LLMOnlyResult | null }) {
  const rows: [string, string, string][] = [
    ["판단경로", "보이지 않음 (AI 내부)", "그래프로 명시"],
    ["규칙·계산 판단", "AI가 해석", "RULE · CODE가 정확히 처리"],
    ["AI가 맡는 범위", "결론 전체", "한 단계 (센서 고장 근거)"],
    ["입력 일부가 바뀌면", "전체를 다시 판단", "바뀐 판단만 다시, 나머지는 재사용"],
    ["판단 하나가 틀렸다면", "결론 전체를 다시 요청", "그 판단만 사람이 지정, 영향받는 단계만 재계산"],
    ["규칙이 바뀌면", "정책 문장을 고쳐 다시 요청", "해당 RULE · CODE 단계만 반영"],
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
            <th>구조화된 판단</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>이번 실행 결과</th>
            <td>{llmOnly ? (llmOnly.ok ? llmOnly.action : "— (실행할 수 없음)") : "— (아직 실행 안 함)"}</td>
            <td>{run ? (run.decisionStatus === "SUCCEEDED" ? String(run.decision) : "판단 불가 (실패 단계에서 차단)") : "— (아직 실행 안 함)"}</td>
          </tr>
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
        이 표는 구조의 차이를 비교한 것입니다. 구조화된 판단이 항상 더 정확하다고 주장하지 않습니다.
      </p>
    </section>
  );
}
