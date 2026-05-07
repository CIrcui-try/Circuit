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
}

export class RealWorkflowRunner implements WorkflowRunner {
  private previousOutputs: Record<string, SkillExecutionResult> = {};
  private lastSeenRunId: string | null = null;
  private currentAdapterRunId: string | null = null;

  constructor(private readonly opts: RealWorkflowRunnerOptions) {}

  reset(): void {
    this.previousOutputs = {};
    this.lastSeenRunId = null;
    this.currentAdapterRunId = null;
  }

  async cancel(): Promise<void> {
    const id = this.currentAdapterRunId;
    if (id) await this.opts.bridge.cancel(id);
  }

  async runNode(node: RunnableNode): Promise<RunResult> {
    const { runId, workflowId } = this.opts.getRunMeta();

    // First node of a new run: clear accumulated state and prime the log store.
    if (this.lastSeenRunId !== runId) {
      this.previousOutputs = {};
      this.opts.logStore.getState().beginRun({ runId, workflowId });
      this.lastSeenRunId = runId;
    }

    const fullNode = this.opts.getNode(node.id);
    if (!fullNode) {
      return { ok: false, reason: `node ${node.id} not found in workflow` };
    }

    const repo = this.opts.getRepository();
    if (!repo) {
      return { ok: false, reason: "no repository selected" };
    }

    let adapter;
    try {
      adapter = this.opts.registry.get(fullNode.skillRef.provider);
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }

    const nodeTimeout = readNodeTimeoutMs(fullNode.input);

    let ctx;
    try {
      ctx = await buildSkillExecutionContext(
        {
          runId,
          workflowId: workflowId ?? "",
          node: fullNode,
          repository: repo,
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
