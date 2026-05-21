import type { RuntimeBridge } from "../bridge/RuntimeBridge";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";
import { buildSkillPrompt } from "./buildSkillPrompt";
import { probeViaBridge, runViaBridge } from "./runViaBridge";

export interface ClaudeCommand {
  command: string;
  args: string[];
  stdinMode?: "piped" | "null";
}

export interface ClaudeAdapterOptions {
  bridge: RuntimeBridge;
  buildCommand?: (
    ctx: SkillExecutionContext,
    prompt: string,
  ) => ClaudeCommand;
  buildPrompt?: (ctx: SkillExecutionContext) => string;
  probeCommand?: ClaudeCommand;
  probeTimeoutMs?: number;
  skipProbe?: boolean;
  newRunId?: (ctx: SkillExecutionContext) => string;
}

const DEFAULT_PROBE: ClaudeCommand = {
  command: "claude",
  args: ["--version"],
};

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

function defaultBuildCommand(
  ctx: SkillExecutionContext,
  prompt: string,
): ClaudeCommand {
  const modelArgs = ctx.execution.model
    ? ["--model", ctx.execution.model]
    : [];
  return {
    command: "claude",
    args: [...modelArgs, "-p", prompt],
    stdinMode: "null",
  };
}

function defaultBuildPrompt(ctx: SkillExecutionContext): string {
  return buildSkillPrompt(ctx);
}

function defaultRunId(ctx: SkillExecutionContext): string {
  return `${ctx.runId}::${ctx.nodeId}`;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = "claude" as const;

  private readonly bridge: RuntimeBridge;
  private readonly buildCommand: NonNullable<ClaudeAdapterOptions["buildCommand"]>;
  private readonly buildPrompt: NonNullable<ClaudeAdapterOptions["buildPrompt"]>;
  private readonly probeCommand: ClaudeCommand;
  private readonly probeTimeoutMs: number;
  private readonly skipProbe: boolean;
  private readonly newRunId: NonNullable<ClaudeAdapterOptions["newRunId"]>;

  constructor(opts: ClaudeAdapterOptions) {
    this.bridge = opts.bridge;
    this.buildCommand = opts.buildCommand ?? defaultBuildCommand;
    this.buildPrompt = opts.buildPrompt ?? defaultBuildPrompt;
    this.probeCommand = opts.probeCommand ?? DEFAULT_PROBE;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.skipProbe = opts.skipProbe ?? false;
    this.newRunId = opts.newRunId ?? defaultRunId;
  }

  async canRun(ctx: SkillExecutionContext): Promise<AdapterAvailability> {
    if (this.skipProbe) {
      return { ok: true, details: { skipped: true } };
    }
    return probeViaBridge({
      bridge: this.bridge,
      ctx,
      runId: `${this.newRunId(ctx)}::probe`,
      command: this.probeCommand,
      timeoutMs: this.probeTimeoutMs,
    });
  }

  async run(
    ctx: SkillExecutionContext,
    sink: AgentRunEventSink,
  ): Promise<SkillExecutionResult> {
    const prompt = this.buildPrompt(ctx);
    const command = this.buildCommand(ctx, prompt);
    return runViaBridge({
      bridge: this.bridge,
      ctx,
      runId: this.newRunId(ctx),
      command,
      sink,
    });
  }
}
