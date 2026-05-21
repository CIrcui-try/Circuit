import type { RunnableEdge } from "./runner";

export type TopoSortResult =
  | { cycle: false; order: string[] }
  | { cycle: true };

export type WorkflowGraphAnalysis =
  | {
      valid: true;
      hasCycle: boolean;
      rootNodeId: string;
    }
  | {
      valid: false;
      hasCycle: boolean;
      reason: "empty" | "multiple-roots" | "disconnected";
      rootNodeIds: string[];
    };

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

export function analyzeWorkflowGraph(
  nodeIds: readonly string[],
  edges: readonly RunnableEdge[],
): WorkflowGraphAnalysis {
  if (nodeIds.length === 0) {
    return {
      valid: false,
      hasCycle: false,
      reason: "empty",
      rootNodeIds: [],
    };
  }

  const nodeIndex = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (let i = 0; i < nodeIds.length; i += 1) {
    const id = nodeIds[i];
    nodeIndex.set(id, i);
    successors.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) continue;
    successors.get(edge.source)!.push(edge.target);
  }

  const components = findStronglyConnectedComponents(nodeIds, successors);
  const componentByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const nodeId of component) componentByNode.set(nodeId, componentIndex);
  });

  const componentIncoming = components.map(() => 0);
  const componentSuccessors = components.map(() => new Set<number>());
  let hasCycle = components.some((component) => component.length > 1);

  for (const edge of edges) {
    const sourceComponent = componentByNode.get(edge.source);
    const targetComponent = componentByNode.get(edge.target);
    if (sourceComponent == null || targetComponent == null) continue;
    if (sourceComponent === targetComponent) {
      if (edge.source === edge.target) hasCycle = true;
      continue;
    }
    if (!componentSuccessors[sourceComponent].has(targetComponent)) {
      componentSuccessors[sourceComponent].add(targetComponent);
      componentIncoming[targetComponent] += 1;
    }
  }

  const entryComponents = componentIncoming
    .map((incoming, componentIndex) => ({ incoming, componentIndex }))
    .filter((entry) => entry.incoming === 0)
    .map((entry) => entry.componentIndex)
    .sort(
      (a, b) =>
        firstNodeIndex(components[a], nodeIndex) -
        firstNodeIndex(components[b], nodeIndex),
    );
  const rootNodeIds = entryComponents.map((componentIndex) =>
    firstNodeId(components[componentIndex], nodeIndex),
  );

  if (entryComponents.length !== 1) {
    return {
      valid: false,
      hasCycle,
      reason: "multiple-roots",
      rootNodeIds,
    };
  }

  const reachable = new Set<number>();
  const queue = [entryComponents[0]];
  while (queue.length > 0) {
    const componentIndex = queue.shift()!;
    if (reachable.has(componentIndex)) continue;
    reachable.add(componentIndex);
    for (const next of componentSuccessors[componentIndex]) queue.push(next);
  }

  if (reachable.size !== components.length) {
    return {
      valid: false,
      hasCycle,
      reason: "disconnected",
      rootNodeIds,
    };
  }

  return {
    valid: true,
    hasCycle,
    rootNodeId: rootNodeIds[0],
  };
}

function findStronglyConnectedComponents(
  nodeIds: readonly string[],
  successors: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const indexByNode = new Map<string, number>();
  const lowlinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (nodeId: string) => {
    indexByNode.set(nodeId, nextIndex);
    lowlinkByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const successor of successors.get(nodeId) ?? []) {
      if (!indexByNode.has(successor)) {
        visit(successor);
        lowlinkByNode.set(
          nodeId,
          Math.min(lowlinkByNode.get(nodeId)!, lowlinkByNode.get(successor)!),
        );
      } else if (onStack.has(successor)) {
        lowlinkByNode.set(
          nodeId,
          Math.min(lowlinkByNode.get(nodeId)!, indexByNode.get(successor)!),
        );
      }
    }

    if (lowlinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const next = stack.pop()!;
      onStack.delete(next);
      component.push(next);
      if (next === nodeId) break;
    }
    components.push(component);
  };

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) visit(nodeId);
  }

  return components;
}

function firstNodeId(
  component: readonly string[],
  nodeIndex: Map<string, number>,
) {
  return component.reduce((best, nodeId) =>
    (nodeIndex.get(nodeId) ?? Infinity) < (nodeIndex.get(best) ?? Infinity)
      ? nodeId
      : best,
  );
}

function firstNodeIndex(
  component: readonly string[],
  nodeIndex: Map<string, number>,
): number {
  return nodeIndex.get(firstNodeId(component, nodeIndex)) ?? Infinity;
}
