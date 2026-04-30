import type { RunnableEdge } from "./runner";

export type TopoSortResult =
  | { cycle: false; order: string[] }
  | { cycle: true };

// Kahn's algorithm. Nodes are identified by id only; edges define the partial
// order. The result is stable: ties are broken by the original node insertion
// order so that two runs of the same workflow produce the same sequence.
export function topoSort(
  nodeIds: readonly string[],
  edges: readonly RunnableEdge[],
): TopoSortResult {
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    successors.set(id, []);
  }
  for (const e of edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    successors.get(e.source)!.push(e.target);
  }

  const ready = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const succ of successors.get(next) ?? []) {
      const d = (indegree.get(succ) ?? 0) - 1;
      indegree.set(succ, d);
      if (d === 0) ready.push(succ);
    }
  }
  if (order.length !== nodeIds.length) return { cycle: true };
  return { cycle: false, order };
}
