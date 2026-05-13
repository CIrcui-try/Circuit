import { getHostBridge, type WorkflowSummaryDTO } from "../host/bridge";
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
