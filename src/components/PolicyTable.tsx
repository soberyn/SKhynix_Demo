import type { JudgmentGraph, NodeState } from "@/core/types";
import { formatValue } from "./bits";
import s from "./demo.module.css";

/** Shows the decision node's RULE table and highlights the row that fired. */
export function PolicyTable({ graph, states }: { graph: JudgmentGraph; states: Record<string, NodeState> }) {
  const node = graph.nodes.find((n) => n.id === graph.decision_node);
  if (!node || node.resolver_type !== "RULE" || node.resolver_config.kind !== "table") return null;

  const { rows } = node.resolver_config;
  const keys = node.dependencies;
  const labels = Object.fromEntries(graph.nodes.map((n) => [n.id, n.label]));
  const decided = states[node.id]?.status === "SUCCEEDED";
  const results = Object.fromEntries(keys.map((k) => [k, states[k]?.output?.result]));
  const matched = decided ? rows.findIndex((r) => Object.entries(r.when).every(([k, v]) => results[k] === v)) : -1;

  return (
    <div className={s.policy}>
      <h3 className={s.subTitle}>
        {node.label} — 데모 정책 표 <span className={s.badge + " " + s.badge_RULE}>≡ 규칙</span>
      </h3>
      <table className={s.table}>
        <thead>
          <tr>
            <th>#</th>
            {keys.map((k) => (
              <th key={k}>{labels[k]}</th>
            ))}
            <th>결론</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === matched ? s.matchedRow : undefined}>
              <td className={s.mono}>{i === matched ? "▶" : i + 1}</td>
              {keys.map((k) => (
                <td key={k} className={s.mono}>
                  {k in r.when ? formatValue(r.when[k]) : <span className={s.muted}>상관없음</span>}
                </td>
              ))}
              <td className={s.mono}>{formatValue(r.then)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.caption}>
        앞의 판단 {keys.length}개의 결과를 이 표에 위에서부터 대입해, 처음 맞는 행의 결론을 선택합니다. 실행 후 적용된 행이 ▶로 표시됩니다.
      </p>
    </div>
  );
}
