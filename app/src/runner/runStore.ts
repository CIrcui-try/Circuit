import { create } from "zustand";
import type { WorkflowEdge, WorkflowSkillNode } from "../workflow/schema";
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

export type WorkflowRunSnapshot = {
  repository: {
    id: string;
    name: string;
    path: string;
  };
  workflowId: string | null;
  workflowName: string;
  nodes: WorkflowSkillNode[];
  edges: WorkflowEdge[];
};

export type RunStoreState = {
  status: RunStatus;
  runMode: "dag" | "cycle";
  runId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  activeNodeId: string | null;
  iteration: number | null;
  nodeStates: Record<string, NodeRunState>;
  nodeDebug: Record<string, NodeDebugInfo>;
  snapshot: WorkflowRunSnapshot | null;

  beginRun: (args: {
    runId: string;
    workflowId: string | null;
    workflowName?: string | null;
    repository?: {
      id: string;
      name: string;
    };
    nodeIds: readonly string[];
    startedAt: string;
    runMode?: "dag" | "cycle";
    snapshot?: WorkflowRunSnapshot;
  }) => void;
  setActiveNode: (id: string | null) => void;
  setIteration: (iteration: number | null) => void;
  setNodeState: (id: string, state: NodeRunState) => void;
  patchNodeDebug: (id: string, patch: NodeDebugInfo) => void;
  finishRun: (status: RunTerminalStatus, finishedAt?: string) => void;
  reset: () => void;
};

const INITIAL: Pick<
  RunStoreState,
  | "status"
  | "runMode"
  | "runId"
  | "workflowId"
  | "workflowName"
  | "repositoryId"
  | "repositoryName"
  | "startedAt"
  | "finishedAt"
  | "activeNodeId"
  | "iteration"
  | "nodeStates"
  | "nodeDebug"
  | "snapshot"
> = {
  status: "idle",
  runMode: "dag",
  runId: null,
  workflowId: null,
  workflowName: null,
  repositoryId: null,
  repositoryName: null,
  startedAt: null,
  finishedAt: null,
  activeNodeId: null,
  iteration: null,
  nodeStates: {},
  nodeDebug: {},
  snapshot: null,
};

export const useRunStore = create<RunStoreState>((set) => ({
  ...INITIAL,

  beginRun: ({
    runId,
    workflowId,
    workflowName,
    repository,
    nodeIds,
    startedAt,
    runMode,
    snapshot,
  }) => {
    const nodeStates: Record<string, NodeRunState> = {};
    for (const id of nodeIds) nodeStates[id] = "queued";
    set({
      status: "running",
      runId,
      workflowId,
      workflowName: workflowName ?? snapshot?.workflowName ?? null,
      repositoryId: repository?.id ?? null,
      repositoryName: repository?.name ?? null,
      startedAt,
      finishedAt: null,
      activeNodeId: null,
      runMode: runMode ?? "dag",
      iteration: runMode === "cycle" ? 1 : null,
      nodeStates,
      nodeDebug: {},
      snapshot: snapshot ? cloneRunSnapshot(snapshot) : null,
    });
  },

  setActiveNode: (id) => {
    set({ activeNodeId: id });
  },

  setIteration: (iteration) => {
    set({ iteration });
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

  finishRun: (status, finishedAt) => {
    set({
      status,
      finishedAt: finishedAt ?? new Date().toISOString(),
      activeNodeId: null,
    });
  },

  reset: () => {
    set({ ...INITIAL });
  },
}));

function cloneRunSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return {
    repository: { ...snapshot.repository },
    workflowId: snapshot.workflowId,
    workflowName: snapshot.workflowName,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: "skill",
      skillRef: { ...node.skillRef },
      label: node.label,
      position: { ...node.position },
      ...(node.input !== undefined ? { input: cloneInput(node.input) } : {}),
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    })),
  };
}

function cloneInput(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

export function useNodeRunState(id: string): NodeRunState {
  return useRunStore((s) => s.nodeStates[id] ?? "idle");
}

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_STORE__?: unknown }).__RUN_STORE__ = useRunStore;
}
