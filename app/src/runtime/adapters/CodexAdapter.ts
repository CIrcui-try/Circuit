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

// `codex exec` 는 첫 실행 시 디렉토리 신뢰 / 명령 승인 프롬프트를 띄우는데,
// 우리는 stdin=null 로 spawn 하므로 그 프롬프트에 응답할 길이 없어 노드가
// 무한 대기에 빠진다. `--dangerously-bypass-approvals-and-sandbox` 로 그
// 프롬프트들을 모두 끄고, `--skip-git-repo-check` 로 비-git 디렉토리에서도
// 실행되게 한다. 사용자는 Workspace 의 Start Circuit 을 명시적으로 눌러
// 자동화에 옵트인한 상태이므로 per-command 승인은 적합한 UX 가 아니다.
// 더 안전한 정책이 필요하면 호출자가 `buildCommand` 옵션으로 override.
function defaultBuildCommand(
  _ctx: SkillExecutionContext,
  prompt: string,
): CodexCommand {
  return {
    command: "codex",
    args: [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      prompt,
    ],
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
