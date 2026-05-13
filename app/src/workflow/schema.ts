export const WORKFLOW_VERSION = "0.1" as const;

export type WorkflowVersion = typeof WORKFLOW_VERSION;

export const WORKFLOW_SKILL_PROVIDERS = ["claude", "codex", "shell", "git"] as const;

export type WorkflowSkillProvider = (typeof WORKFLOW_SKILL_PROVIDERS)[number];

export const WORKFLOW_SKILL_SOURCES = ["repository", "default", "system"] as const;

export type WorkflowSkillSource = (typeof WORKFLOW_SKILL_SOURCES)[number];

export type WorkflowSkillRef = {
  source?: WorkflowSkillSource;
  provider: WorkflowSkillProvider;
  skillFile?: string;
  systemSkillId?: string;
};

export type WorkflowNodePosition = {
  x: number;
  y: number;
};

export type WorkflowSkillNode = {
  id: string;
  type: "skill";
  skillRef: WorkflowSkillRef;
  label: string;
  description?: string;
  position: WorkflowNodePosition;
  input?: Record<string, unknown>;
};

export type WorkflowNode = WorkflowSkillNode;

export type WorkflowEdgeKind = "dependency";

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  kind: WorkflowEdgeKind;
};

export type Workflow = {
  version: WorkflowVersion;
  id: string;
  repositoryId: string;
  name: string;
  continueOnFailure?: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  updatedAt: string;
};
