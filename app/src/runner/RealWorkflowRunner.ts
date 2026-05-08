import type { HostBridge } from "../host/bridge";
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

export interface PersistRunLogArgs {
  runId: string;
  workflowId: string | null;
  repository: { id: string; name: string; path: string };
  events: ReturnType<typeof useRunLogStore.getState>["events"];
  nodeResults: ReturnType<typeof useRunLogStore.getState>["nodeResults"];
}

export interface RealWorkflowRunnerOptions {
  registry: AdapterRegistry;
  bridge: RuntimeBridge;
  logStore: typeof useRunLogStore;
  getNode: (id: string) => WorkflowSkillNode | null;
  getRepository: () => { id: string; name: string; path: string } | null;
  getRunMeta: () => { runId: string; workflowId: string | null };
  persistRunLog?: (args: PersistRunLogArgs) => Promise<void> | void;
  /// Phase 7 (CIR-35): when present and the bridge implements the workspace
  /// commands, the runner wraps each run in `acquire → begin_turn → commit_turn
  /// → release_to_pool` and rewrites every node's cwd to the workspace path.
  /// Tests and the web preview omit this and the runner falls back to the
  /// legacy "spawn straight in repo.path" behavior.
  host?: HostBridge;
  userId?: string;
}

const DEFAULT_USER_ID = "default";

export class RealWorkflowRunner implements WorkflowRunner {
  private previousOutputs: Record<string, SkillExecutionResult> = {};
  private lastSeenRunId: string | null = null;
  private currentAdapterRunId: string | null = null;
  private workspaceId: string | null = null;
  private workspacePath: string | null = null;
  private turnCounter = 0;

  constructor(private readonly opts: RealWorkflowRunnerOptions) {}

  reset(): void {
    this.previousOutputs = {};
    this.lastSeenRunId = null;
    this.currentAdapterRunId = null;
    this.workspaceId = null;
    this.workspacePath = null;
  }

  async cancel(): Promise<void> {
    const id = this.currentAdapterRunId;
    if (id) await this.opts.bridge.cancel(id);
  }

  async runNode(node: RunnableNode): Promise<RunResult> {
    const { runId, workflowId } = this.opts.getRunMeta();

    const repo = this.opts.getRepository();
    if (!repo) {
      return { ok: false, reason: "no repository selected" };
    }

    // First node of a new run: clear accumulated state, prime the log store,
    // and (when the host bridge supports it) acquire a workspace + begin a turn.
    if (this.lastSeenRunId !== runId) {
      this.previousOutputs = {};
      this.opts.logStore.getState().beginRun({ runId, workflowId });
      this.lastSeenRunId = runId;
      this.workspaceId = null;
      this.workspacePath = null;

      // Skip the async hop entirely when no workspace bridge is wired up so
      // tests / web-preview that exercise this code path see the same number
      // of microtask boundaries as before Phase 7.
      const host = this.opts.host;
      if (host?.acquireWorkspace && host.beginTurn) {
        const acquireErr = await this.acquireWorkspaceAndBeginTurn(host, repo.path);
        if (acquireErr) return acquireErr;
      }
    }

    const fullNode = this.opts.getNode(node.id);
    if (!fullNode) {
      return { ok: false, reason: `node ${node.id} not found in workflow` };
    }

    let adapter;
    try {
      adapter = this.opts.registry.get(fullNode.skillRef.provider);
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }

    const nodeTimeout = readNodeTimeoutMs(fullNode.input);

    // The cwd for the spawned CLI should be the workspace clone when wired up
    // — that's the whole point of Phase 7. The repository's id/name stay the
    // same so the UI labels don't shift.
    const repoForCtx = this.workspacePath
      ? { ...repo, path: this.workspacePath }
      : repo;

    let ctx;
    try {
      ctx = await buildSkillExecutionContext(
        {
          runId,
          workflowId: workflowId ?? "",
          node: fullNode,
          repository: repoForCtx,
          previousOutputs: { ...this.previousOutputs },
          ...(nodeTimeout != null ? { timeoutMs: nodeTimeout } : {}),
        },
        {
          readSkillFile: (abs, root) => this.opts.bridge.readFile(abs, root),
        },
      );
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }

    const sink = (event: AgentRunEvent): void => {
      this.opts.logStore.getState().appendEvent(node.id, event);
    };

    // Mirrors the default newRunId in ClaudeAdapter / CodexAdapter
    // (`${ctx.runId}::${ctx.nodeId}`); cancel() relies on this to reach
    // the bridge.
    this.currentAdapterRunId = `${runId}::${node.id}`;

    let result: SkillExecutionResult;
    try {
      result = await adapter.run(ctx, sink);
    } catch (err) {
      this.currentAdapterRunId = null;
      return { ok: false, reason: errorMessage(err) };
    }
    this.currentAdapterRunId = null;

    this.opts.logStore.getState().setNodeResult(node.id, result);
    this.previousOutputs[node.id] = result;

    if (this.opts.persistRunLog) {
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

    if (result.status === "success") return { ok: true };
    const exitSuffix =
      result.exitCode != null ? ` (exit ${result.exitCode})` : "";
    return { ok: false, reason: `${result.status}${exitSuffix}` };
  }

  async endRun(status: "success" | "failed"): Promise<void> {
    const wsId = this.workspaceId;
    if (!wsId) return;
    const host = this.opts.host;
    this.workspaceId = null;
    this.workspacePath = null;
    if (!host) return;

    // commit_turn settles the dirty working tree as a real git commit so the
    // turn boundary is a stable checkpoint (Phase 3, CIR-31). Release_to_pool
    // refuses a workspace with an in-flight turn, so commit must run first.
    try {
      await host.commitTurn?.(wsId);
    } catch {
      // fall through to cleanup
    }

    if (status === "success" && host.releaseToPool) {
      try {
        await host.releaseToPool(wsId);
        return;
      } catch {
        // fall through to cleanup
      }
    }

    if (host.cleanupWorkspace) {
      try {
        await host.cleanupWorkspace(wsId);
      } catch {
        // best-effort
      }
    }
  }

  private async acquireWorkspaceAndBeginTurn(
    host: HostBridge,
    repoPath: string,
  ): Promise<RunResult | null> {
    const acquire = host.acquireWorkspace;
    const beginTurn = host.beginTurn;
    if (!acquire || !beginTurn) return null;

    const userId = this.opts.userId ?? DEFAULT_USER_ID;
    const repoUrl = `file://${repoPath}`;
    let ws;
    try {
      ws = await acquire(userId, repoUrl);
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }
    this.turnCounter += 1;
    try {
      await beginTurn(ws.id, this.turnCounter);
    } catch (err) {
      // acquire already registered the workspace; try to hand it back so disk
      // doesn't leak across runs. Best-effort.
      try {
        await host.releaseToPool?.(ws.id);
      } catch {
        try {
          await host.cleanupWorkspace?.(ws.id);
        } catch {
          // give up
        }
      }
      return { ok: false, reason: errorMessage(err) };
    }
    this.workspaceId = ws.id;
    this.workspacePath = ws.path;
    return null;
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
