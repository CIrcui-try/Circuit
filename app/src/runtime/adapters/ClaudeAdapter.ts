import type { RuntimeBridge } from "../bridge/RuntimeBridge";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEvent,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
  TokenUsage,
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
    args: [...modelArgs, "--output-format", "stream-json", "-p", prompt],
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
  private readonly usesDefaultCommand: boolean;

  constructor(opts: ClaudeAdapterOptions) {
    this.bridge = opts.bridge;
    this.buildCommand = opts.buildCommand ?? defaultBuildCommand;
    this.buildPrompt = opts.buildPrompt ?? defaultBuildPrompt;
    this.probeCommand = opts.probeCommand ?? DEFAULT_PROBE;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.skipProbe = opts.skipProbe ?? false;
    this.newRunId = opts.newRunId ?? defaultRunId;
    this.usesDefaultCommand = opts.buildCommand == null;
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
      processEvent: this.usesDefaultCommand ? processClaudeStreamJsonEvent : undefined,
    });
  }
}

function processClaudeStreamJsonEvent(ev: AgentRunEvent): AgentRunEvent[] {
  if (ev.type !== "stdout") return [ev];
  const events: AgentRunEvent[] = [];
  const lines = ev.text.split(/\r?\n/);
  let parsedAny = false;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const parsed = parseJsonObject(line);
    if (!parsed) {
      events.push({ ...ev, text: line });
      continue;
    }
    parsedAny = true;
    const text = readClaudeText(parsed);
    if (text) events.push({ ...ev, text });
    const usage = readTokenUsage(parsed);
    if (usage) {
      events.push({ type: "token_usage", timestamp: ev.timestamp, usage });
    }
  }
  if (!parsedAny) return [ev];
  if (events.length > 0) return events;
  return [];
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readClaudeText(value: Record<string, unknown>): string | null {
  const result = value.result;
  if (typeof result === "string" && result.length > 0) return result;

  const message = objectValue(value.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : Array.isArray(value.content)
      ? value.content
      : null;
  if (!content) return null;

  const text = content
    .map((item) => {
      const obj = objectValue(item);
      return typeof obj?.text === "string" ? obj.text : "";
    })
    .join("");
  return text.length > 0 ? text : null;
}

function readTokenUsage(value: Record<string, unknown>): TokenUsage | null {
  return readUsageObject(objectValue(value.usage) ?? objectValue(value.message)?.usage);
}

function readUsageObject(value: unknown): TokenUsage | null {
  const usage = objectValue(value);
  if (!usage) return null;
  const inputTokens = readNumber(usage.inputTokens) ?? readNumber(usage.input_tokens);
  const outputTokens =
    readNumber(usage.outputTokens) ?? readNumber(usage.output_tokens);
  const cachedInputTokens =
    readNumber(usage.cachedInputTokens) ??
    readNumber(usage.cached_input_tokens) ??
    readNumber(usage.cache_read_input_tokens);
  const reasoningOutputTokens =
    readNumber(usage.reasoningOutputTokens) ??
    readNumber(usage.reasoning_output_tokens);
  const totalTokens =
    readNumber(usage.totalTokens) ??
    readNumber(usage.total_tokens) ??
    sumDefined(inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens);
  if (totalTokens == null) return null;
  return {
    totalTokens,
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(cachedInputTokens != null ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens != null ? { reasoningOutputTokens } : {}),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sumDefined(...values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return undefined;
  return present.reduce((sum, value) => sum + value, 0);
}
