"use client";

import type { JudgmentGraph, NodeState } from "@/core/types";
import { nodeLevels } from "@/core/validate";
import { ResolverBadge, SourceTag, StatusPill, formatValue } from "./bits";
import s from "./demo.module.css";

const labelOf = (graph: JudgmentGraph, id?: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

const GAP_Y = 24;
const PAD = 12;

export function DagView({
  graph,
  states,
  changed,
}: {
  graph: JudgmentGraph;
  states: Record<string, NodeState>;
  /** Nodes whose result differs from the previous run. */
  changed?: Set<string>;
}) {
  const levels = nodeLevels(graph);
  const columns: string[][] = [];
  for (const n of graph.nodes) (columns[levels[n.id]] ??= []).push(n.id);

  // Narrower cards when the graph is deeper, so three levels still fit next to the decision panel.
  const H = columns.length >= 3 ? 152 : 132;
  const W = columns.length >= 3 ? 178 : 236;
  const GAP_X = columns.length >= 3 ? 34 : 64;
  const tallest = Math.max(...columns.map((c) => c.length));
  const height = tallest * H + (tallest - 1) * GAP_Y + PAD * 2;
  const width = columns.length * W + (columns.length - 1) * GAP_X + PAD * 2;

  const pos: Record<string, { x: number; y: number }> = {};
  columns.forEach((ids, col) => {
    const colHeight = ids.length * H + (ids.length - 1) * GAP_Y;
    const top = (height - colHeight) / 2;
    ids.forEach((id, row) => (pos[id] = { x: PAD + col * (W + GAP_X), y: top + row * (H + GAP_Y) }));
  });

  return (
    <div className={s.dagScroll}>
      <div className={s.dag} style={{ width, height }}>
        <svg className={s.edges} width={width} height={height} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge)" />
            </marker>
            <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--fail)" />
            </marker>
          </defs>
          {graph.nodes.flatMap((n) =>
            n.dependencies.map((dep) => {
              const a = pos[dep];
              const b = pos[n.id];
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x - 2;
              const y2 = b.y + H / 2;
              const mid = (x1 + x2) / 2;
              const src = states[dep]?.status;
              const bad = src === "FAILED" || src === "BLOCKED";
              const done = src === "SUCCEEDED";
              return (
                <path
                  key={`${dep}->${n.id}`}
                  d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={bad ? "var(--fail)" : "var(--edge)"}
                  strokeWidth={done ? 2 : 1.5}
                  strokeDasharray={bad ? "5 4" : done ? undefined : "2 4"}
                  markerEnd={`url(#${bad ? "arrow-bad" : "arrow"})`}
                />
              );
            }),
          )}
        </svg>

        {graph.nodes.map((n) => {
          const st = states[n.id] ?? { status: "PENDING" };
          const isDecision = n.id === graph.decision_node;
          return (
            <div
              key={n.id}
              className={`${s.node} ${s[`st_${st.status}`]} ${isDecision ? s.decisionNode : ""} ${changed?.has(n.id) ? s.nodeChanged : ""} ${st.reused ? s.nodeReused : ""}`}
              style={{ left: pos[n.id].x, top: pos[n.id].y, width: W, height: H }}
            >
              <div className={s.nodeHead}>
                <ResolverBadge type={n.resolver_type} />
                {changed?.has(n.id) && <span className={s.changedTag}>바뀜</span>}
                {st.reused && <span className={s.reusedTag}>재사용</span>}
                {st.output?.human && !st.reused && <span className={s.humanTag}>👤 지정</span>}
                <StatusPill status={st.status} />
              </div>
              <div className={s.nodeLabel}>{n.label}</div>
              <div className={s.nodeResult}>
                {st.status === "SUCCEEDED" && st.output ? (
                  <>
                    <span className={s.resultValue}>{formatValue(st.output.result)}</span>
                    {st.output.llm && <SourceTag source={st.output.llm.source} recordedAt={st.output.llm.recordedAt} />}
                    <span className={s.nodeHow}>{st.output.explanation}</span>
                  </>
                ) : st.status === "FAILED" ? (
                  <span className={`${s.errorText} ${s.nodeHow}`}>{st.error}</span>
                ) : st.status === "BLOCKED" ? (
                  <span className={s.errorText}>
                    앞 단계({labelOf(graph, st.blockedBy)})가 실패해 실행하지 않음
                  </span>
                ) : (
                  <span className={s.muted}>{n.description}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
