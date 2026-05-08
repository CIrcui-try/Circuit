// Runner module is independent of React Flow and the workflow schema module.
// We define the minimal node shape the runner needs so that adapters in later
// phases can call mock or real runners without dragging editor types around.

export const NODE_RUN_STATES = [
  "idle",
  "queued",
  "running",
  "success",
  "failed",
  "skipped",
] as const;

export type NodeRunState = (typeof NODE_RUN_STATES)[number];

export type RunStatus = "idle" | "running" | "success" | "failed";

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

export type RunResult = { ok: true } | { ok: false; reason: string };

export type WorkflowRunner = {
  runNode: (node: RunnableNode) => Promise<RunResult>;
  /// Phase 7 (CIR-35): called once after the last node finishes, with the
  /// run's terminal status. RealWorkflowRunner uses it to commit + release the
  /// workspace turn it acquired on the first node. Optional so older runners
  /// (mockRunner) and tests don't need to implement lifecycle hooks.
  endRun?: (status: "success" | "failed") => Promise<void>;
};
