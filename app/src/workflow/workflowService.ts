import {
  getHostBridge,
  type WorkflowBundleImportResultDTO,
  type WorkflowSummaryDTO,
} from "../host/bridge";
import { useWorkflowStore } from "../stores/workflowStore";
import { fromWorkflow, toWorkflow } from "./serialize";
import type { Workflow } from "./schema";

export type SaveResult = {
  workflowId: string;
  name: string;
  updatedAt: string;
};

export async function saveCurrent(args: {
  repoPath: string;
  repositoryId: string;
}): Promise<SaveResult> {
  const state = useWorkflowStore.getState();
  const id = state.currentWorkflowId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const createdAt = state.currentWorkflowId ? now : now; // first save: same as updatedAt
  const workflow = toWorkflow(
    {
      nodes: state.nodes,
      edges: state.edges,
      continueOnFailure: state.continueOnFailure,
    },
    {
      id,
      repositoryId: args.repositoryId,
      name: state.workflowName,
      createdAt,
    },
  );

  const json = JSON.stringify(workflow, null, 2);
  await getHostBridge().saveWorkflow(args.repoPath, id, json);

  if (!state.currentWorkflowId) {
    useWorkflowStore.setState({ currentWorkflowId: id });
  }

  return { workflowId: id, name: workflow.name, updatedAt: workflow.updatedAt };
}

export async function loadById(args: {
  repoPath: string;
  workflowId: string;
}): Promise<void> {
  const json = await getHostBridge().loadWorkflow(args.repoPath, args.workflowId);
  const parsed = JSON.parse(json) as Workflow;
  const { nodes, edges, meta } = fromWorkflow(parsed);
  useWorkflowStore.getState().replaceCanvas({
    nodes,
    edges,
    workflowId: meta.id,
    workflowName: meta.name,
    continueOnFailure: meta.continueOnFailure,
  });
}

export async function listForRepo(repoPath: string): Promise<WorkflowSummaryDTO[]> {
  return await getHostBridge().listWorkflows(repoPath);
}

export async function deleteById(args: {
  repoPath: string;
  workflowId: string;
}): Promise<void> {
  await getHostBridge().deleteWorkflow(args.repoPath, args.workflowId);
}

export async function exportCurrent(args: {
  repoPath: string;
  repositoryId: string;
}): Promise<{ path: string; skillCount: number } | null> {
  const bridge = getHostBridge();
  if (!bridge.exportWorkflowBundle) {
    throw new Error("workflow bundle export is not available");
  }
  const state = useWorkflowStore.getState();
  const id = state.currentWorkflowId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const workflow = toWorkflow(
    {
      nodes: state.nodes,
      edges: state.edges,
      continueOnFailure: state.continueOnFailure,
    },
    {
      id,
      repositoryId: args.repositoryId,
      name: state.workflowName,
      createdAt: now,
    },
    () => now,
  );
  return await bridge.exportWorkflowBundle(
    args.repoPath,
    JSON.stringify(workflow, null, 2),
    `${toBundleFileStem(workflow.name)}.circuitflow`,
  );
}

export async function loadImportedBundle(
  result: WorkflowBundleImportResultDTO,
): Promise<void> {
  const parsed = JSON.parse(result.workflowJson) as Workflow;
  const { nodes, edges, meta } = fromWorkflow(parsed);
  useWorkflowStore.getState().replaceCanvas({
    nodes,
    edges,
    workflowId: meta.id,
    workflowName: meta.name,
    continueOnFailure: meta.continueOnFailure,
  });
}

function toBundleFileStem(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workflow";
}
