import { getHostBridge } from "../host/bridge";
import { createDefaultRegistry } from "../runtime/adapters/createDefaultRegistry";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { WorkflowEdge, WorkflowSkillNode } from "../workflow/schema";
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
  bridge?: RuntimeBridge;
  createRunner?: (args: CreateRunnerArgs) => CancellableWorkflowRunner;
};

let activeRunner: CancellableWorkflowRunner | null = null;

export async function startWorkflowRun(
  opts: StartWorkflowRunOptions,
): Promise<RunWorkflowOutcome> {
  const snapshot = cloneSnapshot(opts.snapshot);
  const runnableNodes = snapshot.nodes.map(toRunnableNode);
  const runnableEdges = snapshot.edges.map(toRunnableEdge);

  if (useRunStore.getState().status === "running") {
    return { kind: "rejected", reason: "already-running" };
  }

  const bridge = opts.bridge ?? getRuntimeBridge();
  const getNode = (id: string) => snapshot.nodes.find((n) => n.id === id) ?? null;
  const getRepository = () => snapshot.repository;
  const getRunMeta = () => {
    const s = useRunStore.getState();
    return { runId: s.runId ?? "(idle)", workflowId: s.workflowId };
  };
  const runner =
    opts.createRunner?.({ snapshot, bridge, getNode, getRepository, getRunMeta }) ??
    createRealRunner({ snapshot, bridge, getNode, getRepository, getRunMeta });

  runner.reset?.();
  activeRunner = runner;
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
      now: opts.now,
      newRunId: opts.newRunId,
    });
  } finally {
    if (activeRunner === runner && useRunStore.getState().status !== "running") {
      activeRunner = null;
    }
  }
}

export async function cancelWorkflowRun(): Promise<boolean> {
  if (!activeRunner?.cancel) return false;
  await activeRunner.cancel();
  return true;
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

function toRunnableNode(node: WorkflowSkillNode): RunnableNode {
  if (node.skillRef.provider !== "claude" && node.skillRef.provider !== "codex") {
    throw new Error(`Unsupported runnable provider: ${node.skillRef.provider}`);
  }
  return {
    id: node.id,
    label: node.label,
    skillRef: {
      provider: node.skillRef.provider,
      skillFile: node.skillRef.skillFile,
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
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: "skill",
      skillRef: { ...node.skillRef },
      label: node.label,
      position: { ...node.position },
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
