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
import { topoSort } from "./topoSort";

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
  startFromNodeId?: string;
  seedPreviousOutputs?: Record<string, SkillExecutionResult>;
};

export type RunWorkflowOutcome =
  | { kind: "started"; status: RunTerminalStatus }
  | { kind: "rejected"; reason: "already-running" | "empty" | "cycle" };

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
    startFromNodeId,
    seedPreviousOutputs,
  } = opts;

  if (store.getState().status === "running") {
    return { kind: "rejected", reason: "already-running" };
  }

  if (nodes.length === 0) {
    return { kind: "rejected", reason: "empty" };
  }

  const nodeIds = nodes.map((n) => n.id);
  const sorted = topoSort(nodeIds, edges);

  // Initialize the run state up front so the UI can show every node as queued
  // even when traversal will fail immediately.
  const runId = newRunId();
  const isCycleRun = sorted.cycle && allowCycles;
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
  logStore?.getState().beginRun({ runId, workflowId });

  if (sorted.cycle && !allowCycles) {
    for (const id of nodeIds) store.getState().setNodeState(id, "skipped");
    store.getState().finishRun("failed", now());
    return { kind: "rejected", reason: "cycle" };
  }

  if (isCycleRun) {
    const status = await runCycleWorkflow({
      order: nodeIds,
      byId: new Map(nodes.map((n) => [n.id, n])),
      runner,
      store,
    });
    store.getState().finishRun(status, now());
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
      store.getState().setNodeState(id, "skipped");
      continue;
    }
    if (failureSeen) {
      store.getState().setNodeState(id, "skipped");
      continue;
    }
    const node = byId.get(id);
    if (!node) {
      store.getState().setNodeState(id, "skipped");
      failureSeen = true;
      finalStatus = "failed";
      continue;
    }
    store.getState().setActiveNode(id);
    store.getState().setNodeState(id, "running");
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
      store.getState().setNodeState(id, "success");
    } else {
      store.getState().setNodeState(id, result.status);
      failureSeen = true;
      finalStatus = result.status;
    }
  }

  store.getState().finishRun(finalStatus, now());
  return { kind: "started", status: finalStatus };
}

async function runCycleWorkflow({
  order,
  byId,
  runner,
  store,
}: {
  order: string[];
  byId: Map<string, RunnableNode>;
  runner: WorkflowRunner;
  store: typeof RunStore;
}): Promise<RunTerminalStatus> {
  for (let iteration = 1; ; iteration += 1) {
    store.getState().setIteration(iteration);
    for (const id of order) store.getState().setNodeState(id, "queued");

    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const node = byId.get(id);
      store.getState().setActiveNode(id);
      store.getState().setNodeState(id, "running");
      if (!node) {
        store.getState().setNodeState(id, "failed");
        markRemainingSkipped(store, order, i + 1);
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
        store.getState().setNodeState(id, "success");
        continue;
      }

      store.getState().setNodeState(id, result.status);
      markRemainingSkipped(store, order, i + 1);
      return result.status;
    }
  }
}

function markRemainingSkipped(
  store: typeof RunStore,
  order: string[],
  startIndex: number,
): void {
  for (let i = startIndex; i < order.length; i += 1) {
    store.getState().setNodeState(order[i], "skipped");
  }
}
