import {
  WORKFLOW_VERSION,
  type Workflow,
  type WorkflowEdge,
  type WorkflowSkillNode,
  type WorkflowSkillProvider,
} from "./schema";

export const CODEX_STARTER_FLOW_ID = "codex-starter-issue-lifecycle";
export const CODEX_STARTER_FLOW_NAME = "Mixed starter flow";

export const CODEX_STARTER_FLOW_BINDING_POLICY = {
  repository: "selected-repository",
  runCwd: "repository.path",
  skillReference: "default-skill-file",
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
  provider: Extract<WorkflowSkillProvider, "claude" | "codex">;
  skillFile: string;
  x: number;
  y: number;
};

const STARTER_STEPS: StarterStep[] = [
  {
    id: "starter_boarding",
    label: "planning",
    description: "Plan the feature to implement and capture scope, constraints, and context.",
    provider: "codex",
    skillFile: ".codex/skills/planning/SKILL.md",
    x: 240,
    y: 80,
  },
  {
    id: "starter_taxiing",
    label: "implement-plan",
    description: "Implement the plan in the worktree, test it, and commit local changes.",
    provider: "claude",
    skillFile: ".claude/skills/implement-plan/SKILL.md",
    x: 240,
    y: 260,
  },
  {
    id: "starter_review_and_fix",
    label: "review-changes",
    description: "Review local changes, fix issues, and commit review fixes.",
    provider: "codex",
    skillFile: ".codex/skills/review-changes/SKILL.md",
    x: 240,
    y: 440,
  },
  {
    id: "starter_takeoff",
    label: "publish-pr",
    description: "Rebase on develop, push the branch, and open a PR.",
    provider: "claude",
    skillFile: ".claude/skills/publish-pr/SKILL.md",
    x: 240,
    y: 620,
  },
  {
    id: "starter_landing",
    label: "cleanup-merged-pr",
    description: "After merge, remove the temporary worktree and sync develop.",
    provider: "claude",
    skillFile: ".claude/skills/cleanup-merged-pr/SKILL.md",
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
    nodes: STARTER_STEPS.map((step, index) =>
      toNode(step, index === 0 ? initialRequest : ""),
    ),
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
      source: "default",
      provider: step.provider,
      skillFile: step.skillFile,
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
