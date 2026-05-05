import type { RuntimeBridge } from "../bridge/RuntimeBridge";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";
import { probeViaBridge, runViaBridge } from "./runViaBridge";

export interface CodexCommand {
  command: string;
  args: string[];
}

export interface CodexAdapterOptions {
  bridge: RuntimeBridge;
  buildCommand?: (
    ctx: SkillExecutionContext,
    prompt: string,
  ) => CodexCommand;
  buildPrompt?: (ctx: SkillExecutionContext) => string;
  probeCommand?: CodexCommand;
  probeTimeoutMs?: number;
  skipProbe?: boolean;
  newRunId?: (ctx: SkillExecutionContext) => string;
}

const DEFAULT_PROBE: CodexCommand = {
  command: "codex",
  args: ["--version"],
};

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

function defaultBuildCommand(
  _ctx: SkillExecutionContext,
  prompt: string,
): CodexCommand {
  return { command: "codex", args: ["exec", prompt] };
}

function defaultBuildPrompt(ctx: SkillExecutionContext): string {
  const inputJson = JSON.stringify(ctx.input ?? {}, null, 2);
  return [
    `# Skill: ${ctx.skill.name}`,
    "",
    ctx.skill.content,
    "",
    "# Input",
    "",
    inputJson,
  ].join("\n");
}

function defaultRunId(ctx: SkillExecutionContext): string {
  return `${ctx.runId}::${ctx.nodeId}`;
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;

  private readonly bridge: RuntimeBridge;
  private readonly buildCommand: NonNullable<CodexAdapterOptions["buildCommand"]>;
  private readonly buildPrompt: NonNullable<CodexAdapterOptions["buildPrompt"]>;
  private readonly probeCommand: CodexCommand;
  private readonly probeTimeoutMs: number;
  private readonly skipProbe: boolean;
  private readonly newRunId: NonNullable<CodexAdapterOptions["newRunId"]>;

  constructor(opts: CodexAdapterOptions) {
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
