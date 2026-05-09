import { create } from "zustand";
import type { NodeRunState, RunStatus, RunTerminalStatus } from "./runner";

export type NodeDebugInfo = {
  adapter?: string;
  adapterRunId?: string;
  command?: string;
  args?: string[];
  spawnType?: "process";
  startedAt?: string;
  durationMs?: number;
  exitCode?: number;
  lastLogAt?: string;
  idleSince?: string;
  idleTimeoutMs?: number;
};

export type RunStoreState = {
  status: RunStatus;
  runId: string | null;
  workflowId: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  startedAt: string | null;
  activeNodeId: string | null;
  nodeStates: Record<string, NodeRunState>;
  nodeDebug: Record<string, NodeDebugInfo>;

  beginRun: (args: {
    runId: string;
    workflowId: string | null;
    repository?: {
      id: string;
      name: string;
    };
    nodeIds: readonly string[];
    startedAt: string;
  }) => void;
  setActiveNode: (id: string | null) => void;
  setNodeState: (id: string, state: NodeRunState) => void;
  patchNodeDebug: (id: string, patch: NodeDebugInfo) => void;
  finishRun: (status: RunTerminalStatus) => void;
  reset: () => void;
};

const INITIAL: Pick<
  RunStoreState,
  | "status"
  | "runId"
  | "workflowId"
  | "repositoryId"
  | "repositoryName"
  | "startedAt"
  | "activeNodeId"
  | "nodeStates"
  | "nodeDebug"
> = {
  status: "idle",
  runId: null,
  workflowId: null,
  repositoryId: null,
  repositoryName: null,
  startedAt: null,
  activeNodeId: null,
  nodeStates: {},
  nodeDebug: {},
};

export const useRunStore = create<RunStoreState>((set) => ({
  ...INITIAL,

  beginRun: ({ runId, workflowId, repository, nodeIds, startedAt }) => {
    const nodeStates: Record<string, NodeRunState> = {};
    for (const id of nodeIds) nodeStates[id] = "queued";
    set({
      status: "running",
      runId,
      workflowId,
      repositoryId: repository?.id ?? null,
      repositoryName: repository?.name ?? null,
      startedAt,
      activeNodeId: null,
      nodeStates,
      nodeDebug: {},
    });
  },

  setActiveNode: (id) => {
    set({ activeNodeId: id });
  },

  setNodeState: (id, state) => {
    set((s) => ({
      nodeStates: { ...s.nodeStates, [id]: state },
    }));
  },

  patchNodeDebug: (id, patch) => {
    set((s) => ({
      nodeDebug: {
        ...s.nodeDebug,
        [id]: { ...(s.nodeDebug[id] ?? {}), ...patch },
      },
    }));
  },

  finishRun: (status) => {
    set({ status, activeNodeId: null });
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
