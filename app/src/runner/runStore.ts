import { create } from "zustand";
import type { NodeRunState, RunStatus } from "./runner";

export type RunStoreState = {
  status: RunStatus;
  runId: string | null;
  workflowId: string | null;
  startedAt: string | null;
  nodeStates: Record<string, NodeRunState>;

  beginRun: (args: {
    runId: string;
    workflowId: string | null;
    nodeIds: readonly string[];
    startedAt: string;
  }) => void;
  setNodeState: (id: string, state: NodeRunState) => void;
  finishRun: (status: Exclude<RunStatus, "idle" | "running">) => void;
  reset: () => void;
};

const INITIAL: Pick<
  RunStoreState,
  "status" | "runId" | "workflowId" | "startedAt" | "nodeStates"
> = {
  status: "idle",
  runId: null,
  workflowId: null,
  startedAt: null,
  nodeStates: {},
};

export const useRunStore = create<RunStoreState>((set) => ({
  ...INITIAL,

  beginRun: ({ runId, workflowId, nodeIds, startedAt }) => {
    const nodeStates: Record<string, NodeRunState> = {};
    for (const id of nodeIds) nodeStates[id] = "queued";
    set({
      status: "running",
      runId,
      workflowId,
      startedAt,
      nodeStates,
    });
  },

  setNodeState: (id, state) => {
    set((s) => ({
      nodeStates: { ...s.nodeStates, [id]: state },
    }));
  },

  finishRun: (status) => {
    set({ status });
  },

  reset: () => {
    set({ ...INITIAL });
  },
}));

export function useNodeRunState(id: string): NodeRunState {
  return useRunStore((s) => s.nodeStates[id] ?? "idle");
}

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_STORE__?: unknown }).__RUN_STORE__ = useRunStore;
}
