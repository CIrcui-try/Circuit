import {
  WORKFLOW_VERSION,
  type Workflow,
  type WorkflowEdge,
  type WorkflowSkillNode,
  type WorkflowSkillProvider,
} from "./schema";

export const CODEX_STARTER_FLOW_ID = "codex-starter-issue-lifecycle";
export const CODEX_STARTER_FLOW_NAME = "Tutorial starter flow";

export const CODEX_STARTER_FLOW_BINDING_POLICY = {
  repository: "selected-repository",
  runCwd: "repository.path",
  skillReference: "default-skill-file",
  saveLoadContract: "regular-workflow-json",
  actualRepoEffects: true,
} as const;

export const CODEX_STARTER_FLOW_APPROVAL_BOUNDARIES = [
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

export type StarterNodePrompts = Partial<Record<string, string>>;

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
    description: "Implement the planned change in the selected folder and verify it.",
    provider: "claude",
    skillFile: ".claude/skills/implement-plan/SKILL.md",
    x: 240,
    y: 260,
  },
  {
    id: "starter_review_and_fix",
    label: "review-and-fix",
    description: "Review the tutorial result, fix obvious issues, and verify the page.",
    provider: "claude",
    skillFile: ".claude/skills/review-and-fix/SKILL.md",
    x: 240,
    y: 440,
  },
  {
    id: "starter_wrap_up",
    label: "wrap-up",
    description: "Run the final tutorial check and summarize the result.",
    provider: "claude",
    skillFile: ".claude/skills/wrap-up/SKILL.md",
    x: 240,
    y: 620,
  },
];

export type CreateCodexStarterWorkflowArgs = {
  repositoryId: string;
  initialRequest?: string;
  issueId?: string;
  nodePrompts?: StarterNodePrompts;
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
      toNode({
        step,
        argumentsValue: index === 0 ? initialRequest : "",
        promptValue: args.nodePrompts?.[step.id] ?? "",
      }),
    ),
    edges: toEdges(STARTER_STEPS),
    createdAt: now,
    updatedAt: now,
  };
}

function toNode({
  step,
  argumentsValue,
  promptValue,
}: {
  step: StarterStep;
  argumentsValue: string;
  promptValue: string;
}): WorkflowSkillNode {
  const trimmedArguments = argumentsValue.trim();
  const trimmedPrompt = promptValue.trim();
  const input = {
    ...(trimmedArguments ? { arguments: trimmedArguments } : {}),
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
  };
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
    ...(Object.keys(input).length > 0 ? { input } : {}),
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
