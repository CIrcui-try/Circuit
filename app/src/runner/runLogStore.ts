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

export type RunLogStoreState = {
  runId: string | null;
  workflowId: string | null;
  events: RunLogEntry[];
  nodeEvents: Record<string, AgentRunEvent[]>;
  nodeResults: Record<string, SkillExecutionResult>;
  pendingApprovals: Record<string, PendingApproval>;

  beginRun: (args: { runId: string; workflowId: string | null }) => void;
  appendEvent: (nodeId: string, event: AgentRunEvent) => void;
  setNodeResult: (nodeId: string, result: SkillExecutionResult) => void;
  resolvePendingApproval: (requestId: string) => void;
  reset: () => void;
};

const INITIAL: Pick<
  RunLogStoreState,
  | "runId"
  | "workflowId"
  | "events"
  | "nodeEvents"
  | "nodeResults"
  | "pendingApprovals"
> = {
  runId: null,
  workflowId: null,
  events: [],
  nodeEvents: {},
  nodeResults: {},
  pendingApprovals: {},
};

export const useRunLogStore = create<RunLogStoreState>((set) => ({
  ...INITIAL,

  beginRun: ({ runId, workflowId }) => {
    set({
      runId,
      workflowId,
      events: [],
      nodeEvents: {},
      nodeResults: {},
      pendingApprovals: {},
    });
  },

  appendEvent: (nodeId, event) => {
    set((s) => {
      const prior = s.nodeEvents[nodeId] ?? [];
      const next: Partial<RunLogStoreState> = {
        events: [...s.events, { nodeId, event }],
        nodeEvents: { ...s.nodeEvents, [nodeId]: [...prior, event] },
      };
      if (event.type === "approval_required") {
        next.pendingApprovals = {
          ...s.pendingApprovals,
          [event.requestId]: {
            requestId: event.requestId,
            nodeId,
            prompt: event.prompt,
            approvalKind: event.approvalKind,
            createdAt: event.timestamp,
          },
        };
      }
      return next as RunLogStoreState;
    });
  },

  setNodeResult: (nodeId, result) => {
    set((s) => {
      // When a node finishes, clear any approvals that were still pending for
      // it — the child died before the user could respond, so the prompt is no
      // longer actionable.
      const filteredApprovals: Record<string, PendingApproval> = {};
      for (const [id, p] of Object.entries(s.pendingApprovals)) {
        if (p.nodeId !== nodeId) filteredApprovals[id] = p;
      }
      return {
        nodeResults: { ...s.nodeResults, [nodeId]: result },
        pendingApprovals: filteredApprovals,
      };
    });
  },

  resolvePendingApproval: (requestId) => {
    set((s) => {
      if (!(requestId in s.pendingApprovals)) return {} as Partial<RunLogStoreState>;
      const next = { ...s.pendingApprovals };
      delete next[requestId];
      return { pendingApprovals: next } as Partial<RunLogStoreState>;
    });
  },

  reset: () => {
    set({ ...INITIAL });
  },
}));

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_LOG_STORE__?: unknown }).__RUN_LOG_STORE__ =
    useRunLogStore;
}
