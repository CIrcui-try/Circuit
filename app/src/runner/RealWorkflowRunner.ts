import type { AdapterRegistry } from "../runtime/adapters/AdapterRegistry";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import { buildSkillExecutionContext } from "../runtime/context/buildSkillExecutionContext";
import type {
  AgentRunEvent,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";
import type { WorkflowSkillNode } from "../workflow/schema";
import type { useRunLogStore } from "./runLogStore";
import type { RunnableNode, RunResult, WorkflowRunner } from "./runner";
import type { useRunStore } from "./runStore";

export interface PersistRunLogArgs {
  runId: string;
  workflowId: string | null;
  repository: RunnerRepository;
  events: ReturnType<typeof useRunLogStore.getState>["events"];
  nodeResults: ReturnType<typeof useRunLogStore.getState>["nodeResults"];
}

type RunnerRepository = { id: string; name: string; path: string };

export interface RealWorkflowRunnerOptions {
  registry: AdapterRegistry;
  bridge: RuntimeBridge;
  logStore: typeof useRunLogStore;
  runStore?: typeof useRunStore;
  getNode: (id: string) => WorkflowSkillNode | null;
  getRepository: () => RunnerRepository | null;
  getRunMeta: () => { runId: string; workflowId: string | null };
  persistRunLog?: (args: PersistRunLogArgs) => Promise<void> | void;
  idleMs?: number;
}

const DEFAULT_IDLE_MS = 30_000;
const STDIN_WAITING_RE = /Reading additional input from stdin/i;
const LOOP_LIMIT_SKILL_FILE = ".codex/skills/loop-limit/SKILL.md";

export class RealWorkflowRunner implements WorkflowRunner {
  private previousOutputs: Record<string, SkillExecutionResult> = {};
  private pendingPreviousOutputs: Record<string, SkillExecutionResult> | null =
    null;
  private lastSeenRunId: string | null = null;
  private currentAdapterRunId: string | null = null;
  private currentNodeId: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: RealWorkflowRunnerOptions) {}

  reset(): void {
    this.previousOutputs = {};
    this.pendingPreviousOutputs = null;
    this.lastSeenRunId = null;
    this.currentAdapterRunId = null;
    this.currentNodeId = null;
    this.clearIdleTimer();
  }

  seedPreviousOutputs(
    previousOutputs: Record<string, SkillExecutionResult>,
  ): void {
    this.pendingPreviousOutputs = { ...previousOutputs };
  }

  async cancel(): Promise<void> {
    const id = this.currentAdapterRunId;
    const nodeId = this.currentNodeId;
    if (!id) return;
    if (nodeId) {
      this.opts.logStore.getState().appendEvent(nodeId, {
        type: "status",
        timestamp: new Date().toISOString(),
        status: `cancel requested for ${id}`,
      });
    }
    await this.opts.bridge.cancel(id);
  }

  async runNode(node: RunnableNode): Promise<RunResult> {
    const { runId, workflowId } = this.opts.getRunMeta();
    const repo = this.opts.getRepository();

    if (this.lastSeenRunId !== runId) {
      this.previousOutputs = { ...(this.pendingPreviousOutputs ?? {}) };
      this.pendingPreviousOutputs = null;
      if (this.opts.logStore.getState().runId !== runId) {
        this.opts.logStore.getState().beginRun({
          runId,
          workflowId,
          repositoryId: repo?.id,
        });
      }
      this.lastSeenRunId = runId;
    }

    if (!repo) {
      return await this.recordNodeFailure(node.id, "no repository selected");
    }

    const fullNode = this.opts.getNode(node.id);
    if (!fullNode) {
      return await this.recordNodeFailure(
        node.id,
        `node ${node.id} not found in workflow`,
        repo,
      );
    }

    if (isLoopLimitSkill(fullNode)) {
      return await this.runLoopLimitSkill(fullNode, repo);
    }

    let adapter;
    try {
      adapter = this.opts.registry.get(fullNode.skillRef.provider);
    } catch (err) {
      return await this.recordNodeFailure(node.id, errorMessage(err), repo);
    }

    const nodeTimeout = readNodeTimeoutMs(fullNode.input);

    const { previousOutputs, rerunPreviousAttempt } =
      splitRerunPreviousAttempt(this.previousOutputs, node.id);

    if (rerunPreviousAttempt) {
      this.opts.logStore.getState().appendEvent(node.id, {
        type: "status",
        timestamp: new Date().toISOString(),
        status: `rerun from failed started (previous status: ${rerunPreviousAttempt.status})`,
      });
    }

    let ctx;
    try {
      ctx = await buildSkillExecutionContext(
        {
          runId,
          workflowId: workflowId ?? "",
          node: fullNode,
          repository: repo,
          previousOutputs,
          ...(rerunPreviousAttempt ? { rerunPreviousAttempt } : {}),
          ...(nodeTimeout != null ? { timeoutMs: nodeTimeout } : {}),
        },
        {
          readSkillFile: (abs, root) => this.opts.bridge.readFile(abs, root),
          ...(this.opts.bridge.readSystemSkill
            ? { readSystemSkill: (id) => this.opts.bridge.readSystemSkill!(id) }
            : {}),
          ...(this.opts.bridge.readDefaultSkill
            ? { readDefaultSkill: (file) => this.opts.bridge.readDefaultSkill!(file) }
            : {}),
        },
      );
    } catch (err) {
      return await this.recordNodeFailure(node.id, errorMessage(err), repo);
    }

    // Mirrors the default newRunId in ClaudeAdapter / CodexAdapter
    // (`${ctx.runId}::${ctx.nodeId}`); cancel() relies on this to reach
    // the bridge.
    this.currentAdapterRunId = `${runId}::${node.id}`;
    this.currentNodeId = node.id;
    const idleMs = readNodeIdleMs(fullNode.input, this.opts.idleMs ?? DEFAULT_IDLE_MS);
    this.opts.runStore?.getState().patchNodeDebug(node.id, {
      adapter: fullNode.skillRef.provider,
      adapterRunId: this.currentAdapterRunId,
      idleTimeoutMs: idleMs,
    });

    const sink = (event: AgentRunEvent): void => {
      this.opts.logStore.getState().appendEvent(node.id, event);
      this.recordDebugEvent(node.id, event, idleMs);
    };

    let result: SkillExecutionResult;
    try {
      result = await adapter.run(ctx, sink);
    } catch (err) {
      this.currentAdapterRunId = null;
      this.currentNodeId = null;
      this.clearIdleTimer();
      return await this.recordNodeFailure(node.id, errorMessage(err), repo);
    }
    this.currentAdapterRunId = null;
    this.currentNodeId = null;
    this.clearIdleTimer();
    result = this.failIfStillWaitingForInput(node.id, result);

    this.opts.logStore.getState().setNodeResult(node.id, result);
    this.opts.runStore?.getState().patchNodeDebug(node.id, {
      durationMs: durationMs(result.startedAt, result.finishedAt),
      exitCode: result.exitCode,
      lastLogAt: lastLogTimestamp(result.logs),
    });
    this.previousOutputs[node.id] = result;

    await this.persistCurrentLog(repo);

    if (result.status === "success") return { ok: true };
    const exitSuffix =
      result.exitCode != null ? ` (exit ${result.exitCode})` : "";
    return {
      ok: false,
      status: result.status === "failed" ? "failed" : result.status,
      reason: `${result.status}${exitSuffix}`,
    };
  }

  private failIfStillWaitingForInput(
    nodeId: string,
    result: SkillExecutionResult,
  ): SkillExecutionResult {
    if (result.status !== "success") return result;
    const runStore = this.opts.runStore?.getState();
    if (runStore?.nodeStates[nodeId] !== "waiting_input") return result;

    const message = "user input required but execution ended";
    const event: AgentRunEvent = {
      type: "error",
      timestamp: new Date().toISOString(),
      message,
    };
    this.opts.logStore.getState().appendEvent(nodeId, event);
    return {
      ...result,
      status: "failed",
      summary: message,
      logs: [...result.logs, event],
    };
  }

  private recordDebugEvent(
    nodeId: string,
    event: AgentRunEvent,
    idleMs: number,
  ): void {
    this.clearIdleTimer();
    this.opts.runStore?.getState().patchNodeDebug(nodeId, {
      lastLogAt: event.timestamp,
      idleSince: undefined,
    });
    if (event.type === "start") {
      this.opts.runStore?.getState().patchNodeDebug(nodeId, {
        command: event.command,
        args: event.args,
        spawnType: event.spawnType,
        startedAt: event.timestamp,
      });
    }
    if (event.type === "finish") {
      this.opts.runStore?.getState().patchNodeDebug(nodeId, {
        exitCode: event.exitCode,
      });
      return;
    }
    if (event.type === "approval_required" || isWaitingForStdin(event)) {
      this.opts.runStore?.getState().setNodeState(nodeId, "waiting_input");
      return;
    }
    const runStore = this.opts.runStore?.getState();
    if (runStore?.nodeStates[nodeId] === "waiting_input") {
      runStore.setNodeState(nodeId, "running");
    }
    this.scheduleIdleTimer(nodeId, idleMs);
  }

  private scheduleIdleTimer(nodeId: string, idleMs: number): void {
    if (idleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      const timestamp = new Date().toISOString();
      this.opts.runStore?.getState().patchNodeDebug(nodeId, {
        idleSince: timestamp,
        idleTimeoutMs: idleMs,
      });
      this.opts.logStore.getState().appendEvent(nodeId, {
        type: "status",
        timestamp,
        status: `idle for ${idleMs}ms`,
      });
    }, idleMs);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async recordNodeFailure(
    nodeId: string,
    reason: string,
    repo?: RunnerRepository,
  ): Promise<RunResult> {
    const timestamp = new Date().toISOString();
    const event: AgentRunEvent = { type: "error", timestamp, message: reason };
    const existing = this.opts.logStore.getState().nodeEvents[nodeId] ?? [];
    this.opts.logStore.getState().appendEvent(nodeId, event);
    this.opts.logStore.getState().setNodeResult(nodeId, {
      status: "failed",
      logs: [...existing, event],
      startedAt: timestamp,
      finishedAt: timestamp,
    });
    if (repo) await this.persistCurrentLog(repo);
    return { ok: false, status: "failed", reason };
  }

  private async runLoopLimitSkill(
    node: WorkflowSkillNode,
    repo: RunnerRepository,
  ): Promise<RunResult> {
    const timestamp = new Date().toISOString();
    const maxIterations = readLoopLimit(node.input);
    const iteration = this.opts.runStore?.getState().iteration ?? 1;
    if (maxIterations == null) {
      return await this.recordNodeFailure(
        node.id,
        "loop-limit requires a positive integer in arguments",
        repo,
      );
    }

    const exceeded = iteration > maxIterations;
    const summary = exceeded
      ? `loop limit exceeded (${iteration}/${maxIterations})`
      : `loop limit passed (${iteration}/${maxIterations})`;
    const event: AgentRunEvent = exceeded
      ? { type: "error", timestamp, message: summary }
      : { type: "status", timestamp, status: summary };
    this.opts.logStore.getState().appendEvent(node.id, event);
    const result: SkillExecutionResult = {
      status: exceeded ? "failed" : "success",
      output: { iteration, maxIterations, exceeded },
      summary,
      logs: [event],
      startedAt: timestamp,
      finishedAt: timestamp,
    };
    this.opts.logStore.getState().setNodeResult(node.id, result);
    this.previousOutputs[node.id] = result;
    await this.persistCurrentLog(repo);

    if (!exceeded) return { ok: true };
    return { ok: false, status: "failed", reason: summary };
  }

  private async persistCurrentLog(repo: RunnerRepository): Promise<void> {
    if (!this.opts.persistRunLog) return;
    const { runId, workflowId } = this.opts.getRunMeta();
    const log = this.opts.logStore.getState();
    try {
      await this.opts.persistRunLog({
        runId,
        workflowId,
        repository: repo,
        events: log.events,
        nodeResults: log.nodeResults,
      });
    } catch {
      // best-effort persistence
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readNodeTimeoutMs(
  input: Record<string, unknown> | undefined,
): number | undefined {
  if (!input) return undefined;
  const value = input.timeoutMs;
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return value;
}

function readNodeIdleMs(
  input: Record<string, unknown> | undefined,
  fallback: number,
): number {
  if (!input) return fallback;
  const value = input.idleTimeoutMs;
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  return value;
}

function isLoopLimitSkill(node: WorkflowSkillNode): boolean {
  return (
    (node.skillRef.source ?? "repository") === "default" &&
    node.skillRef.skillFile === LOOP_LIMIT_SKILL_FILE
  );
}

function readLoopLimit(
  input: Record<string, unknown> | undefined,
): number | null {
  const raw = input?.arguments;
  if (typeof raw !== "string") return null;
  const first = raw.trim().split(/\s+/, 1)[0];
  const value = Number(first);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function isWaitingForStdin(event: AgentRunEvent): boolean {
  return event.type === "stderr" && STDIN_WAITING_RE.test(event.text);
}

function splitRerunPreviousAttempt(
  previousOutputs: Record<string, SkillExecutionResult>,
  nodeId: string,
): {
  previousOutputs: Record<string, SkillExecutionResult>;
  rerunPreviousAttempt?: SkillExecutionResult;
} {
  const current = previousOutputs[nodeId];
  if (!current || current.status === "success") {
    return { previousOutputs: { ...previousOutputs } };
  }

  const next = { ...previousOutputs };
  delete next[nodeId];
  return { previousOutputs: next, rerunPreviousAttempt: current };
}

function durationMs(startedAt: string, finishedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return undefined;
  return Math.max(0, finish - start);
}

function lastLogTimestamp(logs: AgentRunEvent[]): string | undefined {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const timestamp = logs[i].timestamp;
    if (timestamp) return timestamp;
  }
  return undefined;
}
