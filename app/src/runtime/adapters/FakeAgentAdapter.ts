import type { WorkflowSkillProvider } from "../../workflow/schema";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEvent,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";

export interface FakeAgentAdapterOptions {
  provider: WorkflowSkillProvider;
  availability?: AdapterAvailability;
  events?: AgentRunEvent[];
  result?: Omit<SkillExecutionResult, "logs" | "startedAt" | "finishedAt">;
  failWith?: Error;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly provider: WorkflowSkillProvider;
  readonly seenContexts: SkillExecutionContext[] = [];
  private readonly availability: AdapterAvailability;
  private readonly events: AgentRunEvent[];
  private readonly result: Omit<
    SkillExecutionResult,
    "logs" | "startedAt" | "finishedAt"
  >;
  private readonly failWith?: Error;

  constructor(opts: FakeAgentAdapterOptions) {
    this.provider = opts.provider;
    this.availability = opts.availability ?? { ok: true };
    this.events = opts.events ?? [];
    this.result = opts.result ?? { status: "success" };
    this.failWith = opts.failWith;
  }

  async canRun(_ctx: SkillExecutionContext): Promise<AdapterAvailability> {
    return this.availability;
  }

  async run(
    ctx: SkillExecutionContext,
    sink: AgentRunEventSink,
  ): Promise<SkillExecutionResult> {
    this.seenContexts.push(ctx);
    if (this.failWith) throw this.failWith;
    const startedAt = new Date().toISOString();
    for (const ev of this.events) sink(ev);
    const finishedAt = new Date().toISOString();
    return {
      ...this.result,
      logs: [...this.events],
      startedAt,
      finishedAt,
    };
  }
}
