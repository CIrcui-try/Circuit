import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";

// Runner module is independent of React Flow and the workflow schema module.
// We define the minimal node shape the runner needs so that adapters in later
// phases can call mock or real runners without dragging editor types around.

export const NODE_RUN_STATES = [
  "idle",
  "queued",
  "running",
  "waiting_input",
  "success",
  "failed",
  "cancelled",
  "timeout",
  "skipped",
] as const;

export type NodeRunState = (typeof NODE_RUN_STATES)[number];

export type RunTerminalStatus = "success" | "failed" | "cancelled" | "timeout";

export type RunStatus = "idle" | "running" | RunTerminalStatus;

export type RunnableNode = {
  id: string;
  label: string;
  skillRef: {
    provider: "claude" | "codex";
    skillFile: string;
  };
};

export type RunnableEdge = {
  id: string;
  source: string;
  target: string;
};

export type RunResult =
  | { ok: true }
  | { ok: false; status: Exclude<RunTerminalStatus, "success">; reason: string };

export type WorkflowRunner = {
  runNode: (node: RunnableNode) => Promise<RunResult>;
  seedPreviousOutputs?: (
    previousOutputs: Record<string, SkillExecutionResult>,
  ) => void;
};
