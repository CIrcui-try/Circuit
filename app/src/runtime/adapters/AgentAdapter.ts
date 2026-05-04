import type { WorkflowSkillProvider, WorkflowSkillRef } from "../../workflow/schema";

export type AgentRunEvent =
  | { type: "start"; timestamp: string; message: string }
  | { type: "stdout"; timestamp: string; text: string }
  | { type: "stderr"; timestamp: string; text: string }
  | { type: "status"; timestamp: string; status: string }
  | { type: "finish"; timestamp: string; exitCode?: number }
  | { type: "error"; timestamp: string; message: string };

export interface SkillExecutionResult {
  status: "success" | "failed" | "cancelled" | "timeout";
  exitCode?: number;
  output?: unknown;
  summary?: string;
  logs: AgentRunEvent[];
  startedAt: string;
  finishedAt: string;
}

export interface SkillExecutionContext {
  runId: string;
  workflowId: string;
  nodeId: string;
  repository: {
    id: string;
    name: string;
    path: string;
  };
  skill: {
    provider: WorkflowSkillProvider;
    name: string;
    rootDir: string;
    skillFile: string;
    skillFileAbsPath: string;
    content: string;
  };
  input: Record<string, unknown>;
  previousOutputs: Record<string, SkillExecutionResult>;
  execution: {
    timeoutMs: number;
    cwd: string;
    env?: Record<string, string>;
  };
}

export interface AgentAdapter {
  readonly provider: WorkflowSkillProvider;
  canHandle(skillRef: WorkflowSkillRef): boolean;
  execute(ctx: SkillExecutionContext): Promise<SkillExecutionResult>;
}
