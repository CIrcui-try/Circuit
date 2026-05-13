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
  continueOnFailure: boolean;
  nodes: WorkflowSkillNode[];
  edges: WorkflowEdge[];
};

export type RunRecord = {
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
  acknowledgedRunId: string | null;
};

type BeginRunArgs = {
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
};

type RunStoreSet = (
  partial:
    | Partial<RunStoreState>
    | ((state: RunStoreState) => Partial<RunStoreState>),
  replace?: false,
) => void;

export type RunStoreState = RunRecord & {
  currentRepositoryId: string | null;
  runsByRepositoryId: Record<string, RunRecord>;

  getRunForRepository: (repositoryId?: string | null) => RunRecord;
  setCurrentRepository: (repositoryId: string | null) => void;
  beginRun: (args: BeginRunArgs) => void;
  setActiveNode: (id: string | null, repositoryId?: string | null) => void;
  setIteration: (iteration: number | null, repositoryId?: string | null) => void;
  setNodeState: (
    id: string,
    state: NodeRunState,
    repositoryId?: string | null,
  ) => void;
  patchNodeDebug: (
    id: string,
    patch: NodeDebugInfo,
    repositoryId?: string | null,
  ) => void;
  finishRun: (
    status: RunTerminalStatus,
    finishedAt?: string,
    repositoryId?: string | null,
  ) => void;
  acknowledgeRun: (runId: string, repositoryId?: string | null) => void;
  resetRepository: (repositoryId: string) => void;
  reset: () => void;
};

const INITIAL_RECORD: RunRecord = {
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
  acknowledgedRunId: null,
};

const EMPTY_RECORD: RunRecord = cloneRunRecord(INITIAL_RECORD);

export const useRunStore = create<RunStoreState>((set, get) => ({
  ...cloneRunRecord(INITIAL_RECORD),
  currentRepositoryId: null,
  runsByRepositoryId: {},

  getRunForRepository: (repositoryId) => {
    if (repositoryId) {
      const state = get();
      return (
        state.runsByRepositoryId[repositoryId] ??
        (state.repositoryId === repositoryId ? state : EMPTY_RECORD)
      );
    }
    return selectCurrentRecord(get());
  },

  setCurrentRepository: (repositoryId) => {
    set((s) => {
      const record = repositoryId
        ? s.runsByRepositoryId[repositoryId] ?? { ...INITIAL_RECORD, repositoryId }
        : cloneRunRecord(INITIAL_RECORD);
      return {
        currentRepositoryId: repositoryId,
        ...cloneRunRecord(record),
      };
    });
  },

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
    const repositoryId = repository?.id ?? snapshot?.repository.id ?? null;
    const nodeStates: Record<string, NodeRunState> = {};
    for (const id of nodeIds) nodeStates[id] = "queued";
    const record: RunRecord = {
      status: "running",
      runMode: runMode ?? "dag",
      runId,
      workflowId,
      workflowName: workflowName ?? snapshot?.workflowName ?? null,
      repositoryId,
      repositoryName: repository?.name ?? snapshot?.repository.name ?? null,
      startedAt,
      finishedAt: null,
      activeNodeId: null,
      iteration: runMode === "cycle" ? 1 : null,
      nodeStates,
      nodeDebug: {},
      snapshot: snapshot ? cloneRunSnapshot(snapshot) : null,
      acknowledgedRunId: null,
    };
    set((s) => mirrorRecord(s, repositoryId, record, true));
  },

  setActiveNode: (id, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      activeNodeId: id,
    }));
  },

  setIteration: (iteration, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      iteration,
    }));
  },

  setNodeState: (id, state, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      nodeStates: { ...record.nodeStates, [id]: state },
    }));
  },

  patchNodeDebug: (id, patch, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      nodeDebug: {
        ...record.nodeDebug,
        [id]: { ...(record.nodeDebug[id] ?? {}), ...patch },
      },
    }));
  },

  finishRun: (status, finishedAt, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      status,
      finishedAt: finishedAt ?? new Date().toISOString(),
      activeNodeId: null,
    }));
  },

  acknowledgeRun: (runId, repositoryId) => {
    updateRecord(set, repositoryId, (record) => ({
      ...record,
      acknowledgedRunId: runId,
    }));
  },

  resetRepository: (repositoryId) => {
    set((s) => {
      const nextRuns = { ...s.runsByRepositoryId };
      delete nextRuns[repositoryId];
      if (s.currentRepositoryId !== repositoryId) {
        return { runsByRepositoryId: nextRuns };
      }
      return {
        ...cloneRunRecord(INITIAL_RECORD),
        currentRepositoryId: null,
        runsByRepositoryId: nextRuns,
      };
    });
  },

  reset: () => {
    set({
      ...cloneRunRecord(INITIAL_RECORD),
      currentRepositoryId: null,
      runsByRepositoryId: {},
    });
  },
}));

function updateRecord(
  set: RunStoreSet,
  repositoryId: string | null | undefined,
  update: (record: RunRecord) => RunRecord,
): void {
  set((s) => {
    const resolvedRepositoryId = resolveTargetRepositoryId(s, repositoryId);
    const base = resolvedRepositoryId
      ? s.runsByRepositoryId[resolvedRepositoryId] ??
        recordFromTopLevel(s, resolvedRepositoryId)
      : recordFromTopLevel(s, null);
    return mirrorRecord(s, resolvedRepositoryId, update(base), false);
  });
}

function mirrorRecord(
  state: RunStoreState,
  repositoryId: string | null,
  record: RunRecord,
  makeCurrent: boolean,
): Partial<RunStoreState> {
  if (!repositoryId) {
    return {
      ...cloneRunRecord(record),
      currentRepositoryId: null,
    };
  }
  const nextRecord = cloneRunRecord(record);
  const shouldMirror =
    makeCurrent ||
    state.currentRepositoryId === repositoryId ||
    state.currentRepositoryId == null;
  return {
    runsByRepositoryId: {
      ...state.runsByRepositoryId,
      [repositoryId]: nextRecord,
    },
    ...(shouldMirror
      ? {
          ...cloneRunRecord(nextRecord),
          currentRepositoryId: repositoryId,
        }
      : {}),
  };
}

function resolveTargetRepositoryId(
  state: RunStoreState,
  repositoryId: string | null | undefined,
): string | null {
  if (repositoryId !== undefined) return repositoryId;
  return state.currentRepositoryId ?? state.repositoryId;
}

function selectCurrentRecord(state: RunStoreState): RunRecord {
  if (state.currentRepositoryId) {
    return state.runsByRepositoryId[state.currentRepositoryId] ?? state;
  }
  return state;
}

function recordFromTopLevel(
  state: RunStoreState,
  repositoryId: string | null,
): RunRecord {
  if (state.repositoryId === repositoryId || state.repositoryId == null) {
    return {
      status: state.status,
      runMode: state.runMode,
      runId: state.runId,
      workflowId: state.workflowId,
      workflowName: state.workflowName,
      repositoryId,
      repositoryName: state.repositoryName,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      activeNodeId: state.activeNodeId,
      iteration: state.iteration,
      nodeStates: state.nodeStates,
      nodeDebug: state.nodeDebug,
      snapshot: state.snapshot,
      acknowledgedRunId: state.acknowledgedRunId,
    };
  }
  return { ...cloneRunRecord(INITIAL_RECORD), repositoryId };
}

function cloneRunRecord(record: RunRecord): RunRecord {
  return {
    status: record.status,
    runMode: record.runMode,
    runId: record.runId,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    repositoryId: record.repositoryId,
    repositoryName: record.repositoryName,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    activeNodeId: record.activeNodeId,
    iteration: record.iteration,
    nodeStates: { ...record.nodeStates },
    nodeDebug: { ...record.nodeDebug },
    snapshot: record.snapshot ? cloneRunSnapshot(record.snapshot) : null,
    acknowledgedRunId: record.acknowledgedRunId,
  };
}

function cloneRunSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return {
    repository: { ...snapshot.repository },
    workflowId: snapshot.workflowId,
    workflowName: snapshot.workflowName,
    continueOnFailure: snapshot.continueOnFailure === true,
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

export function useNodeRunState(
  id: string,
  repositoryId?: string | null,
): NodeRunState {
  return useRunStore((s) => {
    const record = repositoryId ? s.getRunForRepository(repositoryId) : s;
    return record.nodeStates[id] ?? "idle";
  });
}

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_STORE__?: unknown }).__RUN_STORE__ = useRunStore;
}
