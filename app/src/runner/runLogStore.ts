import { create } from "zustand";
import type {
  AgentRunEvent,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";

export type RunLogEntry = {
  nodeId: string;
  event: AgentRunEvent;
};

export type RunLogStoreState = {
  runId: string | null;
  workflowId: string | null;
  events: RunLogEntry[];
  nodeEvents: Record<string, AgentRunEvent[]>;
  nodeResults: Record<string, SkillExecutionResult>;

  beginRun: (args: { runId: string; workflowId: string | null }) => void;
  appendEvent: (nodeId: string, event: AgentRunEvent) => void;
  setNodeResult: (nodeId: string, result: SkillExecutionResult) => void;
  reset: () => void;
};

const INITIAL: Pick<
  RunLogStoreState,
  "runId" | "workflowId" | "events" | "nodeEvents" | "nodeResults"
> = {
  runId: null,
  workflowId: null,
  events: [],
  nodeEvents: {},
  nodeResults: {},
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
    });
  },

  appendEvent: (nodeId, event) => {
    set((s) => {
      const prior = s.nodeEvents[nodeId] ?? [];
      return {
        events: [...s.events, { nodeId, event }],
        nodeEvents: { ...s.nodeEvents, [nodeId]: [...prior, event] },
      };
    });
  },

  setNodeResult: (nodeId, result) => {
    set((s) => ({
      nodeResults: { ...s.nodeResults, [nodeId]: result },
    }));
  },

  reset: () => {
    set({ ...INITIAL });
  },
}));

if (typeof window !== "undefined") {
  (window as unknown as { __RUN_LOG_STORE__?: unknown }).__RUN_LOG_STORE__ =
    useRunLogStore;
}
