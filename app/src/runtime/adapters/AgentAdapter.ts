import type { WorkflowSkillProvider, WorkflowSkillRef } from "../../workflow/schema";
import type {
  AgentRunEvent,
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";

export type { AgentRunEvent, SkillExecutionContext, SkillExecutionResult };

export interface AgentAdapter {
  readonly provider: WorkflowSkillProvider;
  canHandle(skillRef: WorkflowSkillRef): boolean;
  execute(ctx: SkillExecutionContext): Promise<SkillExecutionResult>;
}
