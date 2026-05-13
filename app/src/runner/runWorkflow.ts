import type {
  RunnableEdge,
  RunnableNode,
  RunTerminalStatus,
  WorkflowRunner,
} from "./runner";
import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";
import type { useRunLogStore as RunLogStore } from "./runLogStore";
import type { useRunStore as RunStore } from "./runStore";
import type { WorkflowRunSnapshot } from "./runStore";
import { analyzeWorkflowGraph, topoSort } from "./topoSort";

export type RunWorkflowOptions = {
  nodes: readonly RunnableNode[];
  edges: readonly RunnableEdge[];
  workflowId: string | null;
  workflowName?: string | null;
  repository?: {
    id: string;
    name: string;
  };
  snapshot?: WorkflowRunSnapshot;
  runner: WorkflowRunner;
  store: typeof RunStore;
  logStore?: typeof RunLogStore;
  now?: () => string;
  newRunId?: () => string;
  allowCycles?: boolean;
  continueOnFailure?: boolean;
  startFromNodeId?: string;
  seedPreviousOutputs?: Record<string, SkillExecutionResult>;
};

export type RunWorkflowOutcome =
  | { kind: "started"; status: RunTerminalStatus }
  | {
      kind: "rejected";
      reason: "already-running" | "empty" | "cycle" | "invalid-graph";
    };

const defaultNow = () => new Date().toISOString();
const defaultRunId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `run_${Math.random().toString(36).slice(2)}`;

export async function runWorkflow(
  opts: RunWorkflowOptions,
): Promise<RunWorkflowOutcome> {
  const {
    nodes,
    edges,
    workflowId,
    workflowName,
    repository,
    snapshot,
    runner,
    store,
    logStore,
    now = defaultNow,
    newRunId = defaultRunId,
    allowCycles = false,
    continueOnFailure = false,
    startFromNodeId,
    seedPreviousOutputs,
  } = opts;
  const repositoryId = repository?.id ?? snapshot?.repository.id ?? null;
  const runState = store.getState();
  const currentRun = repositoryId
    ? runState.getRunForRepository(repositoryId)
    : runState;

  if (
    currentRun.status === "running" ||
    (repositoryId && runState.repositoryId == null && runState.status === "running")
  ) {
    return { kind: "rejected", reason: "already-running" };
  }

  if (nodes.length === 0) {
    return { kind: "rejected", reason: "empty" };
  }

  const nodeIds = nodes.map((n) => n.id);
  const graph = analyzeWorkflowGraph(nodeIds, edges);
  const sorted = topoSort(nodeIds, edges);

  // Initialize the run state up front so the UI can show every node as queued
  // even when traversal will fail immediately.
  const runId = newRunId();
  const isCycleRun = graph.valid && graph.hasCycle && allowCycles;
  store.getState().beginRun({
    runId,
    workflowId,
    workflowName,
    repository,
    nodeIds,
    startedAt: now(),
    runMode: isCycleRun ? "cycle" : "dag",
    snapshot,
  });
  logStore?.getState().beginRun({
    runId,
    workflowId,
    repositoryId,
  });

  if (!graph.valid) {
    for (const id of nodeIds) {
      store.getState().setNodeState(id, "skipped", repositoryId);
    }
    store.getState().finishRun("failed", now(), repositoryId);
    return { kind: "rejected", reason: "invalid-graph" };
  }

  if (sorted.cycle && !allowCycles) {
    for (const id of nodeIds) {
      store.getState().setNodeState(id, "skipped", repositoryId);
    }
    store.getState().finishRun("failed", now(), repositoryId);
    return { kind: "rejected", reason: "cycle" };
  }

  if (isCycleRun) {
    const status = await runCycleWorkflow({
      order: nodeIds,
      byId: new Map(nodes.map((n) => [n.id, n])),
      runner,
      store,
      repositoryId,
    });
    store.getState().finishRun(status, now(), repositoryId);
    return { kind: "started", status };
  }

  const order = sorted.cycle ? nodeIds : sorted.order;
  const startIndex = startFromNodeId ? order.indexOf(startFromNodeId) : 0;
  const firstRunnableIndex = startIndex >= 0 ? startIndex : 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let failureSeen = false;
  let finalStatus: RunTerminalStatus = "success";

  runner.seedPreviousOutputs?.({ ...(seedPreviousOutputs ?? {}) });

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (i < firstRunnableIndex) {
      store.getState().setNodeState(id, "skipped", repositoryId);
      continue;
    }
    if (failureSeen) {
      store.getState().setNodeState(id, "skipped", repositoryId);
      continue;
    }
    const node = byId.get(id);
    if (!node) {
      store.getState().setNodeState(id, "skipped", repositoryId);
      failureSeen = true;
      finalStatus = "failed";
      continue;
    }
    store.getState().setActiveNode(id, repositoryId);
    store.getState().setNodeState(id, "running", repositoryId);
    let result;
    try {
      result = await runner.runNode(node);
    } catch (err) {
      result = {
        ok: false as const,
        status: "failed" as const,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (result.ok) {
      store.getState().setNodeState(id, "success", repositoryId);
    } else {
      store.getState().setNodeState(id, result.status, repositoryId);
      if (result.status !== "failed" || !continueOnFailure) {
        failureSeen = true;
      }
      finalStatus = result.status;
    }
  }

  store.getState().finishRun(finalStatus, now(), repositoryId);
  return { kind: "started", status: finalStatus };
}

async function runCycleWorkflow({
  order,
  byId,
  runner,
  store,
  repositoryId,
}: {
  order: string[];
  byId: Map<string, RunnableNode>;
  runner: WorkflowRunner;
  store: typeof RunStore;
  repositoryId: string | null;
}): Promise<RunTerminalStatus> {
  for (let iteration = 1; ; iteration += 1) {
    store.getState().setIteration(iteration, repositoryId);
    for (const id of order) {
      store.getState().setNodeState(id, "queued", repositoryId);
    }

    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const node = byId.get(id);
      store.getState().setActiveNode(id, repositoryId);
      store.getState().setNodeState(id, "running", repositoryId);
      if (!node) {
        store.getState().setNodeState(id, "failed", repositoryId);
        markRemainingSkipped(store, order, i + 1, repositoryId);
        return "failed";
      }

      let result;
      try {
        result = await runner.runNode(node);
      } catch (err) {
        result = {
          ok: false as const,
          status: "failed" as const,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      if (result.ok) {
        store.getState().setNodeState(id, "success", repositoryId);
        continue;
      }

      store.getState().setNodeState(id, result.status, repositoryId);
      markRemainingSkipped(store, order, i + 1, repositoryId);
      return result.status;
    }
  }
}

function markRemainingSkipped(
  store: typeof RunStore,
  order: string[],
  startIndex: number,
  repositoryId: string | null,
): void {
  for (let i = startIndex; i < order.length; i += 1) {
    store.getState().setNodeState(order[i], "skipped", repositoryId);
  }
}
