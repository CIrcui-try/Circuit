import { describe, expect, it } from "vitest";
import { fromWorkflow, toWorkflow } from "./serialize";
import {
  CODEX_STARTER_FLOW_APPROVAL_BOUNDARIES,
  CODEX_STARTER_FLOW_BINDING_POLICY,
  CODEX_STARTER_FLOW_ID,
  createCodexStarterWorkflow,
} from "./starterFlow";
import { validateWorkflow } from "./validate";

describe("workflow/starterFlow", () => {
  it("SF1: defines the mixed starter flow as a regular workflow JSON", () => {
    const wf = createCodexStarterWorkflow({
      repositoryId: "repo-1",
      initialRequest: "Add a theme toggle",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    expect(wf.id).toBe(CODEX_STARTER_FLOW_ID);
    expect(wf.repositoryId).toBe("repo-1");
    expect(wf.nodes.map((node) => node.id)).toEqual([
      "starter_boarding",
      "starter_taxiing",
      "starter_review_and_fix",
      "starter_takeoff",
      "starter_landing",
    ]);
    expect(wf.nodes.map((node) => node.label)).toEqual([
      "planning",
      "implement-plan",
      "review-changes",
      "publish-pr",
      "cleanup-merged-pr",
    ]);
    expect(wf.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["starter_boarding", "starter_taxiing"],
      ["starter_taxiing", "starter_review_and_fix"],
      ["starter_review_and_fix", "starter_takeoff"],
      ["starter_takeoff", "starter_landing"],
    ]);
    expect(wf.nodes.map((node) => node.position)).toEqual([
      { x: 240, y: 80 },
      { x: 240, y: 260 },
      { x: 240, y: 440 },
      { x: 240, y: 620 },
      { x: 240, y: 800 },
    ]);
    expect(wf.nodes.map((node) => node.skillRef.provider)).toEqual([
      "codex",
      "claude",
      "codex",
      "claude",
      "claude",
    ]);
    expect(wf.nodes.map((node) => node.input)).toEqual([
      { arguments: "Add a theme toggle" },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(validateWorkflow(wf)).toEqual({ ok: true });
  });

  it("SF1b: allows creating the starter flow without an initial request", () => {
    const wf = createCodexStarterWorkflow({
      repositoryId: "repo-1",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    expect(wf.nodes.every((node) => node.input === undefined)).toBe(true);
    expect(validateWorkflow(wf)).toEqual({ ok: true });
  });

  it("SF2: binds starter execution to the selected repository and marks approval edges", () => {
    expect(CODEX_STARTER_FLOW_BINDING_POLICY).toEqual({
      repository: "selected-repository",
      runCwd: "repository.path",
      skillReference: "default-skill-file",
      saveLoadContract: "regular-workflow-json",
      actualRepoEffects: true,
    });
    expect(CODEX_STARTER_FLOW_APPROVAL_BOUNDARIES.map((b) => b.nodeId)).toEqual([
      "starter_takeoff",
      "starter_landing",
    ]);
  });

  it("SF3: survives the existing load and save path without repository skill files", () => {
    const wf = createCodexStarterWorkflow({
      repositoryId: "repo-1",
      initialRequest: "Refine the onboarding flow",
      workflowId: "wf-starter",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    const restored = fromWorkflow(wf);
    expect(restored.nodes[0].data.skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
    });

    const saved = toWorkflow(
      { nodes: restored.nodes, edges: restored.edges },
      {
        id: restored.meta.id,
        repositoryId: restored.meta.repositoryId,
        name: restored.meta.name,
        createdAt: restored.meta.createdAt,
      },
      () => "2026-05-12T00:00:00.000Z",
    );

    expect(saved.nodes[0].skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
    });
    expect(validateWorkflow(saved)).toEqual({ ok: true });
  });

  it("SF4: assigns planning and review to Codex, and operations to Claude", () => {
    const wf = createCodexStarterWorkflow({
      repositoryId: "repo-1",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    expect(wf.nodes[0].skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
    });
    expect(wf.nodes[1].skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/implement-plan/SKILL.md",
    });
    expect(wf.nodes[2].skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/review-changes/SKILL.md",
    });
    expect(wf.nodes[3].skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/publish-pr/SKILL.md",
    });
    expect(wf.nodes[4].skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/cleanup-merged-pr/SKILL.md",
    });
  });
});
