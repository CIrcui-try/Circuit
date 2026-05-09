import type { Edge } from "@xyflow/react";
import type { SkillNode } from "../stores/workflowStore";

const DRAFT_VERSION = 1;
const STORAGE_PREFIX = "circuit.workflowDraft.";

export type WorkflowDraft = {
  version: typeof DRAFT_VERSION;
  repositoryId: string;
  workflowId: string | null;
  workflowName: string;
  nodes: SkillNode[];
  edges: Edge[];
  updatedAt: string;
};

export type SaveWorkflowDraftArgs = {
  workflowId: string | null;
  workflowName: string;
  nodes: SkillNode[];
  edges: Edge[];
};

export function loadWorkflowDraft(repositoryId: string): WorkflowDraft | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(storageKey(repositoryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkflowDraft>;
    if (parsed.version !== DRAFT_VERSION) return null;
    if (parsed.repositoryId !== repositoryId) return null;
    if (typeof parsed.workflowName !== "string") return null;
    if (
      parsed.workflowId !== null &&
      typeof parsed.workflowId !== "string"
    ) {
      return null;
    }
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    if (typeof parsed.updatedAt !== "string") return null;
    return parsed as WorkflowDraft;
  } catch {
    return null;
  }
}

export function saveWorkflowDraft(
  repositoryId: string,
  args: SaveWorkflowDraftArgs,
): void {
  const storage = getStorage();
  if (!storage) return;

  const draft: WorkflowDraft = {
    version: DRAFT_VERSION,
    repositoryId,
    workflowId: args.workflowId,
    workflowName: args.workflowName,
    nodes: args.nodes,
    edges: args.edges,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(storageKey(repositoryId), JSON.stringify(draft));
  } catch {
    // localStorage can be unavailable or full; draft persistence is best effort.
  }
}

function storageKey(repositoryId: string): string {
  return `${STORAGE_PREFIX}${repositoryId}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}
