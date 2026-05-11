import { WORKFLOW_VERSION, type Workflow, type WorkflowEdge, type WorkflowSkillNode } from "./schema";

export const CODEX_STARTER_FLOW_ID = "codex-starter-issue-lifecycle";
export const CODEX_STARTER_FLOW_NAME = "Codex starter flow";

export const CODEX_STARTER_FLOW_BINDING_POLICY = {
  repository: "selected-repository",
  runCwd: "repository.path",
  skillReference: "systemSkillId",
  saveLoadContract: "regular-workflow-json",
  actualRepoEffects: true,
} as const;

export const CODEX_STARTER_FLOW_APPROVAL_BOUNDARIES = [
  {
    nodeId: "starter_takeoff",
    boundary: "remote",
    description: "fetches/rebases, pushes the branch, and creates a PR",
  },
  {
    nodeId: "starter_landing",
    boundary: "post-merge-cleanup",
    description: "runs only after the PR is merged and may remove the temporary worktree",
  },
] as const;

type StarterStep = {
  id: string;
  label: string;
  description: string;
  systemSkillId: string;
  x: number;
  y: number;
};

const STARTER_STEPS: StarterStep[] = [
  {
    id: "starter_boarding",
    label: "boarding",
    description: "Capture the request and map requirements plus code impact.",
    systemSkillId: "codex:starter/boarding",
    x: 240,
    y: 80,
  },
  {
    id: "starter_door_closing",
    label: "door-closing",
    description: "Refresh develop, create the worktree, and write the implementation plan.",
    systemSkillId: "codex:starter/door-closing",
    x: 240,
    y: 260,
  },
  {
    id: "starter_taxiing",
    label: "taxiing",
    description: "Implement the plan in the worktree, test it, and commit local changes.",
    systemSkillId: "codex:starter/taxiing",
    x: 240,
    y: 440,
  },
  {
    id: "starter_takeoff",
    label: "takeoff",
    description: "Rebase on develop, push the branch, and open a PR.",
    systemSkillId: "codex:starter/takeoff",
    x: 240,
    y: 620,
  },
  {
    id: "starter_landing",
    label: "landing",
    description: "After merge, remove the temporary worktree and sync develop.",
    systemSkillId: "codex:starter/landing",
    x: 240,
    y: 800,
  },
];

export type CreateCodexStarterWorkflowArgs = {
  repositoryId: string;
  initialRequest?: string;
  issueId?: string;
  workflowId?: string;
  now?: () => string;
};

export function createCodexStarterWorkflow(
  args: CreateCodexStarterWorkflowArgs,
): Workflow {
  const now = args.now?.() ?? new Date().toISOString();
  const id = args.workflowId ?? CODEX_STARTER_FLOW_ID;
  const initialRequest = args.initialRequest ?? args.issueId ?? "";
  return {
    version: WORKFLOW_VERSION,
    id,
    repositoryId: args.repositoryId,
    name: CODEX_STARTER_FLOW_NAME,
    nodes: STARTER_STEPS.map((step) => toNode(step, initialRequest)),
    edges: toEdges(STARTER_STEPS),
    createdAt: now,
    updatedAt: now,
  };
}

function toNode(step: StarterStep, initialRequest: string): WorkflowSkillNode {
  const trimmedRequest = initialRequest.trim();
  return {
    id: step.id,
    type: "skill",
    skillRef: {
      source: "system",
      provider: "codex",
      systemSkillId: step.systemSkillId,
    },
    label: step.label,
    description: step.description,
    position: { x: step.x, y: step.y },
    ...(trimmedRequest ? { input: { arguments: trimmedRequest } } : {}),
  };
}

function toEdges(steps: StarterStep[]): WorkflowEdge[] {
  return steps.slice(1).map((step, index) => ({
    id: `edge_${steps[index].id}_to_${step.id}`,
    source: steps[index].id,
    target: step.id,
    kind: "dependency",
  }));
}
