import type {
  RunnableEdge,
  RunnableNode,
  RunStatus,
  WorkflowRunner,
} from "./runner";
import type { useRunStore as RunStore } from "./runStore";
import { topoSort } from "./topoSort";

export type RunWorkflowOptions = {
  nodes: readonly RunnableNode[];
  edges: readonly RunnableEdge[];
  workflowId: string | null;
  runner: WorkflowRunner;
  store: typeof RunStore;
  now?: () => string;
  newRunId?: () => string;
};

export type RunWorkflowOutcome =
  | { kind: "started"; status: Exclude<RunStatus, "idle" | "running"> }
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
    runner,
    store,
    now = defaultNow,
    newRunId = defaultRunId,
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
  // even when traversal will fail (cycle / immediate failure).
  store.getState().beginRun({
    runId: newRunId(),
    workflowId,
    nodeIds,
    startedAt: now(),
  });

  if (sorted.cycle) {
    for (const id of nodeIds) store.getState().setNodeState(id, "skipped");
    store.getState().finishRun("failed");
    return { kind: "rejected", reason: "cycle" };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  let failureSeen = false;

  for (let i = 0; i < sorted.order.length; i++) {
    const id = sorted.order[i];
    if (failureSeen) {
      store.getState().setNodeState(id, "skipped");
      continue;
    }
    const node = byId.get(id);
    if (!node) {
      store.getState().setNodeState(id, "skipped");
      failureSeen = true;
      continue;
    }
    store.getState().setNodeState(id, "running");
    let result;
    try {
      result = await runner.runNode(node);
    } catch (err) {
      result = {
        ok: false as const,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (result.ok) {
      store.getState().setNodeState(id, "success");
    } else {
      store.getState().setNodeState(id, "failed");
      failureSeen = true;
    }
  }

  const finalStatus: Exclude<RunStatus, "idle" | "running"> = failureSeen
    ? "failed"
    : "success";
  if (runner.endRun) {
    try {
      await runner.endRun(finalStatus);
    } catch {
      // endRun is best-effort: a failure to commit/release the workspace turn
      // must not flip a successful run to failed.
    }
  }
  store.getState().finishRun(finalStatus);
  return { kind: "started", status: finalStatus };
}
