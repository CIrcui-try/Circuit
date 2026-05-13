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

// `codex exec` 는 비대화형 실행에서 자기가 받은 user prompt 를 stderr 로 그대로
// echo 한다 (`user` 마커 → 본문 → `codex` 마커). Circuit 의 prompt 는 SKILL.md
// 전문을 포함하므로, 그 echo 가 Run Log 에 그대로 흘러나오면 스킬 본문이 통째로
// 한 줄씩 찍힌다. 마커 두 줄과 그 사이 본문만 떨궈내고 나머지 stderr (메타데이터
// 배너, tokens used, 실제 에러) 는 그대로 통과시킨다.
function wrapSinkDroppingPromptEcho(sink: AgentRunEventSink): AgentRunEventSink {
  let dropping = false;
  return (ev) => {
    if (ev.type === "stderr") {
      const trimmed = ev.text.trim();
      if (!dropping) {
        if (trimmed === "user") {
          dropping = true;
          return;
        }
      } else {
        if (trimmed === "codex") {
          dropping = false;
          return;
        }
        return;
      }
    }
    sink(ev);
  };
}

export interface CodexCommand {
  command: string;
  args: string[];
  stdinMode?: "piped" | "null";
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
  return {
    command: "codex",
    args: ["-a", "on-request", "-s", "workspace-write", "exec", prompt],
    stdinMode: "piped",
  };
}

function defaultBuildPrompt(ctx: SkillExecutionContext): string {
  return buildSkillPrompt(ctx);
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
      sink: wrapSinkDroppingPromptEcho(sink),
    });
  }
}
