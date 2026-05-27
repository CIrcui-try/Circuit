import type { WorkflowSkillProvider } from "../../workflow/schema";
import type {
  AgentRunEvent,
  SkillExecutionContext,
  SkillExecutionResult,
  TokenUsage,
} from "../contracts/SkillExecution";

export type {
  AgentRunEvent,
  SkillExecutionContext,
  SkillExecutionResult,
  TokenUsage,
};

export interface AdapterAvailability {
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export type AgentRunEventSink = (event: AgentRunEvent) => void;

export interface AgentAdapter {
  readonly provider: WorkflowSkillProvider;
  canRun(ctx: SkillExecutionContext): Promise<AdapterAvailability>;
  run(
    ctx: SkillExecutionContext,
    events: AgentRunEventSink,
  ): Promise<SkillExecutionResult>;
}
