import { create } from "zustand";
import type {
  AgentRunEvent,
  ApprovalKind,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";

export type RunLogEntry = {
  nodeId: string;
  event: AgentRunEvent;
};

export type PendingApproval = {
  requestId: string;
  nodeId: string;
  prompt: string;
  approvalKind: ApprovalKind;
  createdAt: string;
};

export type RunLogRecord = {
  runId: string | null;
  workflowId: string | null;
  repositoryId: string | null;
  events: RunLogEntry[];
  nodeEvents: Record<string, AgentRunEvent[]>;
  nodeResults: Record<string, SkillExecutionResult>;
  pendingApprovals: Record<string, PendingApproval>;
};

type BeginLogArgs = {
  runId: string;
  workflowId: string | null;
  repositoryId?: string | null;
};

type RunLogStoreSet = (
  partial:
    | Partial<RunLogStoreState>
    | ((state: RunLogStoreState) => Partial<RunLogStoreState>),
  replace?: false,
) => void;

export type RunLogStoreState = RunLogRecord & {
  currentRepositoryId: string | null;
  logsByRepositoryId: Record<string, RunLogRecord>;

  getLogForRepository: (repositoryId?: string | null) => RunLogRecord;
  beginRun: (args: BeginLogArgs) => void;
  appendEvent: (
    nodeId: string,
    event: AgentRunEvent,
    repositoryId?: string | null,
  ) => void;
  setNodeResult: (
    nodeId: string,
    result: SkillExecutionResult,
    repositoryId?: string | null,
  ) => void;
  resolvePendingApproval: (
    requestId: string,
    repositoryId?: string | null,
  ) => void;
  resetRepository: (repositoryId: string) => void;
  reset: (repositoryId?: string | null) => void;
};

const INITIAL_RECORD: RunLogRecord = {
  runId: null,
  workflowId: null,
  repositoryId: null,
  events: [],
  nodeEvents: {},
  nodeResults: {},
  pendingApprovals: {},
};

const EMPTY_RECORD = cloneLogRecord(INITIAL_RECORD);

export const useRunLogStore = create<RunLogStoreState>((set, get) => ({
  ...cloneLogRecord(INITIAL_RECORD),
  currentRepositoryId: null,
  logsByRepositoryId: {},

  getLogForRepository: (repositoryId) => {
    if (repositoryId) {
      const state = get();
      return (
        state.logsByRepositoryId[repositoryId] ??
        (state.repositoryId === repositoryId || state.repositoryId == null
          ? state
          : EMPTY_RECORD)
      );
    }
    return selectCurrentRecord(get());
  },

  beginRun: ({ runId, workflowId, repositoryId }) => {
    const record: RunLogRecord = {
      runId,
      workflowId,
      repositoryId: repositoryId ?? null,
      events: [],
      nodeEvents: {},
      nodeResults: {},
      pendingApprovals: {},
    };
    set((s) => mirrorRecord(s, repositoryId ?? null, record, true));
  },

  appendEvent: (nodeId, event, repositoryId) => {
    updateRecord(set, repositoryId, (record) => {
      const prior = record.nodeEvents[nodeId] ?? [];
      const next: RunLogRecord = {
        ...record,
        events: [...record.events, { nodeId, event }],
        nodeEvents: { ...record.nodeEvents, [nodeId]: [...prior, event] },
      };
      if (event.type === "approval_required") {
        next.pendingApprovals = {
          ...record.pendingApprovals,
          [event.requestId]: {
            requestId: event.requestId,
            nodeId,
            prompt: event.prompt,
            approvalKind: event.approvalKind,
            createdAt: event.timestamp,
          },
        };
      }
      return next;
    });
  },

  setNodeResult: (nodeId, result, repositoryId) => {
    updateRecord(set, repositoryId, (record) => {
      const filteredApprovals: Record<string, PendingApproval> = {};
      for (const [id, p] of Object.entries(record.pendingApprovals)) {
        if (p.nodeId !== nodeId) filteredApprovals[id] = p;
      }
      return {
        ...record,
        nodeResults: { ...record.nodeResults, [nodeId]: result },
        pendingApprovals: filteredApprovals,
      };
    });
  },

  resolvePendingApproval: (requestId, repositoryId) => {
    updateRecord(set, repositoryId, (record) => {
      if (!(requestId in record.pendingApprovals)) return record;
      const next = { ...record.pendingApprovals };
      delete next[requestId];
      return { ...record, pendingApprovals: next };
    });
  },

  resetRepository: (repositoryId) => {
    set((s) => {
      const nextLogs = { ...s.logsByRepositoryId };
      delete nextLogs[repositoryId];
      if (s.currentRepositoryId !== repositoryId) {
        return { logsByRepositoryId: nextLogs };
      }
      return {
        ...cloneLogRecord(INITIAL_RECORD),
        currentRepositoryId: null,
        logsByRepositoryId: nextLogs,
      };
    });
  },

  reset: (repositoryId) => {
    if (repositoryId) {
      get().resetRepository(repositoryId);
      return;
    }
    set({
      ...cloneLogRecord(INITIAL_RECORD),
      currentRepositoryId: null,
      logsByRepositoryId: {},
    });
  },
}));

function updateRecord(
  set: RunLogStoreSet,
  repositoryId: string | null | undefined,
  update: (record: RunLogRecord) => RunLogRecord,
): void {
  set((s) => {
    const resolvedRepositoryId = resolveTargetRepositoryId(s, repositoryId);
    const base = resolvedRepositoryId
      ? s.logsByRepositoryId[resolvedRepositoryId] ??
        recordFromTopLevel(s, resolvedRepositoryId)
      : recordFromTopLevel(s, null);
    return mirrorRecord(s, resolvedRepositoryId, update(base), false);
  });
}

function mirrorRecord(
  state: RunLogStoreState,
  repositoryId: string | null,
  record: RunLogRecord,
  makeCurrent: boolean,
): Partial<RunLogStoreState> {
  if (!repositoryId) {
    return {
      ...cloneLogRecord(record),
      currentRepositoryId: null,
    };
  }
  const nextRecord = cloneLogRecord(record);
  const shouldMirror =
    makeCurrent ||
    state.currentRepositoryId === repositoryId ||
    state.currentRepositoryId == null;
  return {
    logsByRepositoryId: {
      ...state.logsByRepositoryId,
      [repositoryId]: nextRecord,
    },
    ...(shouldMirror
      ? {
          ...cloneLogRecord(nextRecord),
          currentRepositoryId: repositoryId,
        }
      : {}),
  };
}

function resolveTargetRepositoryId(
  state: RunLogStoreState,
  repositoryId: string | null | undefined,
): string | null {
  if (repositoryId !== undefined) return repositoryId;
  return state.currentRepositoryId ?? state.repositoryId;
}

function selectCurrentRecord(state: RunLogStoreState): RunLogRecord {
  if (state.currentRepositoryId) {
    return state.logsByRepositoryId[state.currentRepositoryId] ?? state;
  }
  return state;
}

function recordFromTopLevel(
  state: RunLogStoreState,
  repositoryId: string | null,
): RunLogRecord {
  if (state.repositoryId === repositoryId || state.repositoryId == null) {
    return {
      runId: state.runId,
      workflowId: state.workflowId,
      repositoryId,
      events: state.events,
      nodeEvents: state.nodeEvents,
      nodeResults: state.nodeResults,
      pendingApprovals: state.pendingApprovals,
    };
  }
  return { ...cloneLogRecord(INITIAL_RECORD), repositoryId };
}

function cloneLogRecord(record: RunLogRecord): RunLogRecord {
  return {
    runId: record.runId,
    workflowId: record.workflowId,
    repositoryId: record.repositoryId,
    events: [...record.events],
    nodeEvents: Object.fromEntries(
      Object.entries(record.nodeEvents).map(([nodeId, events]) => [
        nodeId,
        [...events],
      ]),
    ),
    nodeResults: { ...record.nodeResults },
    pendingApprovals: { ...record.pendingApprovals },
  };
}

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_LOG_STORE__?: unknown }).__RUN_LOG_STORE__ =
    useRunLogStore;
}
