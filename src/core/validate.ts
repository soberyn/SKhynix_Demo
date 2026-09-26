import type { JudgmentGraph, ResolverType } from "./types";

const KNOWN_RESOLVERS: ResolverType[] = ["RULE", "LLM"];

export class GraphValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`유효하지 않은 판단 그래프:\n${errors.join("\n")}`);
  }
}

/** Returns a list of problems. An empty list means the graph can be executed. */
export function validateGraph(graph: JudgmentGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`중복 노드: ${node.id}`);
    ids.add(node.id);
    if (!KNOWN_RESOLVERS.includes(node.resolver_type)) {
      errors.push(`알 수 없는 resolver "${node.resolver_type}" (노드 ${node.id})`);
    }
  }

  for (const node of graph.nodes) {
    for (const dep of node.dependencies) {
      if (!ids.has(dep)) errors.push(`누락된 의존관계: ${node.id} → 존재하지 않는 노드 ${dep}`);
    }
  }

  if (!ids.has(graph.decision_node)) {
    errors.push(`최종 판단 노드 없음: ${graph.decision_node}`);
  }

  const cycle = findCycle(graph);
  if (cycle) errors.push(`의존관계 순환 감지: ${cycle.join(" → ")}`);

  return errors;
}

export function assertValidGraph(graph: JudgmentGraph): void {
  const errors = validateGraph(graph);
  if (errors.length) throw new GraphValidationError(errors);
}

/** Depth-first search; returns the cycle path (first node repeated at the end) or null. */
function findCycle(graph: JudgmentGraph): string[] | null {
  const deps = new Map(graph.nodes.map((n) => [n.id, n.dependencies]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue; // reported as missing dependency
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const id of deps.keys()) {
    const found = visit(id);
    // Stack follows "depends on" edges; reverse so the path reads in execution direction.
    if (found) return found.reverse();
  }
  return null;
}

/** Depth of each node (0 = no dependencies). Used for layout. Assumes a valid graph. */
export function nodeLevels(graph: JudgmentGraph): Record<string, number> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const levels: Record<string, number> = {};
  const level = (id: string): number => {
    if (id in levels) return levels[id];
    const deps = byId.get(id)?.dependencies ?? [];
    levels[id] = deps.length ? Math.max(...deps.map(level)) + 1 : 0;
    return levels[id];
  };
  graph.nodes.forEach((n) => level(n.id));
  return levels;
}
