import { getHostBridge } from "../host/bridge";
import type { RepositoryEnvironmentCheck } from "../host/bridge";
import { createDefaultRegistry } from "../runtime/adapters/createDefaultRegistry";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { WorkflowEdge, WorkflowSkillNode } from "../workflow/schema";
import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";
import { RealWorkflowRunner } from "./RealWorkflowRunner";
import { serializeRunLogJsonl } from "./runLogPersistence";
import { useRunLogStore } from "./runLogStore";
import { runWorkflow, type RunWorkflowOutcome } from "./runWorkflow";
import type { RunnableEdge, RunnableNode, WorkflowRunner } from "./runner";
import { useRunStore, type WorkflowRunSnapshot } from "./runStore";

export type { WorkflowRunSnapshot } from "./runStore";

type RunnerRepository = { id: string; name: string; path: string };

type CancellableWorkflowRunner = WorkflowRunner & {
  cancel?: () => Promise<void>;
  reset?: () => void;
};

type CreateRunnerArgs = {
  snapshot: WorkflowRunSnapshot;
  bridge: RuntimeBridge;
  getNode: (id: string) => WorkflowSkillNode | null;
  getRepository: () => RunnerRepository;
  getRunMeta: () => { runId: string; workflowId: string | null };
};

export type StartWorkflowRunOptions = {
  snapshot: WorkflowRunSnapshot;
  now?: () => string;
  newRunId?: () => string;
  allowCycles?: boolean;
  continueOnFailure?: boolean;
  startFromNodeId?: string;
  seedPreviousOutputs?: Record<string, SkillExecutionResult>;
  bridge?: RuntimeBridge;
  checkRepositoryEnvironment?: (
    repoPath: string,
  ) => Promise<RepositoryEnvironmentCheck>;
  createRunner?: (args: CreateRunnerArgs) => CancellableWorkflowRunner;
};

const activeRunners = new Map<string, CancellableWorkflowRunner>();

export async function startWorkflowRun(
  opts: StartWorkflowRunOptions,
): Promise<RunWorkflowOutcome> {
  const snapshot = cloneSnapshot(opts.snapshot);
  const runnableNodes = snapshot.nodes.map(toRunnableNode);
  const runnableEdges = snapshot.edges.map(toRunnableEdge);
  const repositoryId = snapshot.repository.id;

  const runState = useRunStore.getState();
  const repositoryRun = runState.getRunForRepository(repositoryId);
  if (
    repositoryRun.status === "running" ||
    (runState.repositoryId == null && runState.status === "running")
  ) {
    return { kind: "rejected", reason: "already-running" };
  }

  const preflightError = await checkRepositoryPreflight(
    opts.checkRepositoryEnvironment ?? getHostBridge().checkRepositoryEnvironment,
    snapshot.repository.path,
  );
  if (preflightError) {
    return {
      kind: "rejected",
      reason: "repository-preflight",
      message: preflightError,
    };
  }

  const bridge = opts.bridge ?? getRuntimeBridge();
  const getNode = (id: string) => snapshot.nodes.find((n) => n.id === id) ?? null;
  const getRepository = () => snapshot.repository;
  const getRunMeta = () => {
    const s = useRunStore.getState().getRunForRepository(repositoryId);
    return { runId: s.runId ?? "(idle)", workflowId: s.workflowId };
  };
  const runner =
    opts.createRunner?.({ snapshot, bridge, getNode, getRepository, getRunMeta }) ??
    createRealRunner({ snapshot, bridge, getNode, getRepository, getRunMeta });

  runner.reset?.();
  activeRunners.set(repositoryId, runner);
  try {
    return await runWorkflow({
      nodes: runnableNodes,
      edges: runnableEdges,
      workflowId: snapshot.workflowId,
      workflowName: snapshot.workflowName,
      repository: {
        id: snapshot.repository.id,
        name: snapshot.repository.name,
      },
      snapshot,
      runner,
      store: useRunStore,
      logStore: useRunLogStore,
      now: opts.now,
      newRunId: opts.newRunId,
      allowCycles: opts.allowCycles,
      continueOnFailure:
        opts.continueOnFailure ?? snapshot.continueOnFailure === true,
      startFromNodeId: opts.startFromNodeId,
      seedPreviousOutputs: opts.seedPreviousOutputs,
    });
  } finally {
    if (
      activeRunners.get(repositoryId) === runner &&
      useRunStore.getState().getRunForRepository(repositoryId).status !== "running"
    ) {
      activeRunners.delete(repositoryId);
    }
  }
}

export async function cancelWorkflowRun(
  repositoryId?: string | null,
): Promise<boolean> {
  const runner = resolveActiveRunner(repositoryId);
  if (!runner?.cancel) return false;
  await runner.cancel();
  return true;
}

function resolveActiveRunner(
  repositoryId?: string | null,
): CancellableWorkflowRunner | null {
  if (repositoryId) return activeRunners.get(repositoryId) ?? null;
  if (activeRunners.size === 1) {
    return activeRunners.values().next().value ?? null;
  }
  const currentRepositoryId = useRunStore.getState().currentRepositoryId;
  return currentRepositoryId
    ? activeRunners.get(currentRepositoryId) ?? null
    : null;
}

function createRealRunner(args: CreateRunnerArgs): RealWorkflowRunner {
  const registry = createDefaultRegistry({ bridge: args.bridge });
  return new RealWorkflowRunner({
    registry,
    bridge: args.bridge,
    logStore: useRunLogStore,
    runStore: useRunStore,
    getNode: args.getNode,
    getRepository: args.getRepository,
    getRunMeta: args.getRunMeta,
    persistRunLog: async ({
      runId,
      workflowId,
      repository,
      events,
      nodeResults,
    }) => {
      if (!workflowId) return;
      const host = getHostBridge();
      if (!host.saveRunLog) return;
      const jsonl = serializeRunLogJsonl(events, nodeResults);
      await host.saveRunLog(repository.path, workflowId, runId, jsonl);
    },
  });
}

async function checkRepositoryPreflight(
  checker: ((repoPath: string) => Promise<RepositoryEnvironmentCheck>) | undefined,
  repoPath: string,
): Promise<string | null> {
  if (!checker) return null;
  try {
    return formatRepositoryEnvironmentError(await checker(repoPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Repository environment check failed: ${message}`;
  }
}

function formatRepositoryEnvironmentError(
  check: RepositoryEnvironmentCheck,
): string | null {
  const failures: string[] = [];

  if (!check.repoRoot.ok) {
    failures.push(
      `Repository folder is not ready. ${formatCheckMessage(check.repoRoot)}`,
    );
  }
  if (!check.gitCommonDir.ok) {
    failures.push(
      `Circuit host preflight cannot write this repository's git metadata. This is a macOS/Tauri filesystem permission problem before Codex sandboxing starts; check Full Disk Access or folder permissions. ${formatCheckMessage(check.gitCommonDir)}`,
    );
  }
  if (!check.codexStateDir.ok) {
    failures.push(
      `Circuit host preflight cannot write .codex/state. This is different from Codex sandbox writable-root approval; check repository folder permissions first. ${formatCheckMessage(check.codexStateDir)}`,
    );
  }

  return failures.length > 0 ? failures.join("\n") : null;
}

function formatCheckMessage(item: { message?: string | null }): string {
  return item.message?.trim() || "No additional details.";
}

function toRunnableNode(node: WorkflowSkillNode): RunnableNode {
  if (node.skillRef.provider !== "claude" && node.skillRef.provider !== "codex") {
    throw new Error(`Unsupported runnable provider: ${node.skillRef.provider}`);
  }
  const source = node.skillRef.source ?? "repository";
  if (source === "repository" && !node.skillRef.skillFile) {
    throw new Error(`Node ${node.id} is missing skillRef.skillFile`);
  }
  return {
    id: node.id,
    label: node.label,
    skillRef: {
      provider: node.skillRef.provider,
      skillFile: node.skillRef.skillFile ?? "",
    },
  };
}

function toRunnableEdge(edge: WorkflowEdge): RunnableEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  };
}

function cloneSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return {
    repository: { ...snapshot.repository },
    workflowId: snapshot.workflowId,
    workflowName: snapshot.workflowName,
    continueOnFailure: snapshot.continueOnFailure === true,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: "skill",
      skillRef: { ...node.skillRef },
      label: node.label,
      position: { ...node.position },
      ...(node.execution ? { execution: { ...node.execution } } : {}),
      ...(node.input !== undefined ? { input: cloneInput(node.input) } : {}),
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    })),
  };
}

function cloneInput(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}
