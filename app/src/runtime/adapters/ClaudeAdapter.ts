import type { RuntimeBridge, RuntimeProcessEvent } from "../bridge/RuntimeBridge";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEvent,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";

export interface ClaudeCommand {
  command: string;
  args: string[];
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
  _ctx: SkillExecutionContext,
  prompt: string,
): ClaudeCommand {
  return { command: "claude", args: ["-p", prompt] };
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

    const probeRunId = `${this.newRunId(ctx)}::probe`;
    const { command, args } = this.probeCommand;

    return new Promise<AdapterAvailability>((resolve) => {
      let settled = false;
      const finish = (result: AdapterAvailability) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(result);
      };

      const unsubscribe = this.bridge.subscribe(probeRunId, (ev) => {
        switch (ev.type) {
          case "exited":
            if (ev.exitCode === 0) {
              finish({ ok: true, details: { command, args } });
            } else {
              finish({
                ok: false,
                reason: `probe exited with code ${ev.exitCode}`,
                details: { command, args, exitCode: ev.exitCode },
              });
            }
            return;
          case "error":
            finish({
              ok: false,
              reason: `spawn error: ${ev.message}`,
              details: { command, args },
            });
            return;
          case "timeout":
            finish({
              ok: false,
              reason: "probe timed out",
              details: { command, args },
            });
            return;
          case "cancelled":
            finish({
              ok: false,
              reason: "probe cancelled",
              details: { command, args },
            });
            return;
          default:
            return;
        }
      });

      this.bridge
        .spawn({
          runId: probeRunId,
          command,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs: this.probeTimeoutMs,
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          finish({
            ok: false,
            reason: `spawn rejected: ${message}`,
            details: { command, args },
          });
        });
    });
  }

  async run(
    ctx: SkillExecutionContext,
    sink: AgentRunEventSink,
  ): Promise<SkillExecutionResult> {
    const startedAt = new Date().toISOString();
    const prompt = this.buildPrompt(ctx);
    const { command, args } = this.buildCommand(ctx, prompt);
    const runId = this.newRunId(ctx);

    const logs: AgentRunEvent[] = [];
    const emit = (ev: AgentRunEvent) => {
      logs.push(ev);
      sink(ev);
    };

    return new Promise<SkillExecutionResult>((resolve) => {
      let settled = false;
      const finish = (
        partial: Pick<SkillExecutionResult, "status" | "exitCode">,
      ) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve({
          status: partial.status,
          exitCode: partial.exitCode,
          logs,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      };

      const unsubscribe = this.bridge.subscribe(runId, (ev: RuntimeProcessEvent) => {
        switch (ev.type) {
          case "started":
            emit({
              type: "start",
              timestamp: ev.timestamp,
              message: `spawn ${command}`,
            });
            return;
          case "stdout":
            emit({ type: "stdout", timestamp: ev.timestamp, text: ev.text });
            return;
          case "stderr":
            emit({ type: "stderr", timestamp: ev.timestamp, text: ev.text });
            return;
          case "exited": {
            const exitCode = ev.exitCode ?? undefined;
            emit({ type: "finish", timestamp: ev.timestamp, exitCode });
            finish({
              status: ev.exitCode === 0 ? "success" : "failed",
              exitCode,
            });
            return;
          }
          case "cancelled":
            emit({ type: "error", timestamp: ev.timestamp, message: "cancelled" });
            finish({ status: "cancelled" });
            return;
          case "timeout":
            emit({ type: "error", timestamp: ev.timestamp, message: "timeout" });
            finish({ status: "timeout" });
            return;
          case "error":
            emit({ type: "error", timestamp: ev.timestamp, message: ev.message });
            finish({ status: "failed" });
            return;
          default:
            return;
        }
      });

      this.bridge
        .spawn({
          runId,
          command,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs: ctx.execution.timeoutMs,
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          emit({
            type: "error",
            timestamp: new Date().toISOString(),
            message: `spawn rejected: ${message}`,
          });
          finish({ status: "failed" });
        });
    });
  }
}
