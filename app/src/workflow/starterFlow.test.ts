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
  it("SF1: defines the Codex issue lifecycle as a regular workflow JSON", () => {
    const wf = createCodexStarterWorkflow({
      repositoryId: "repo-1",
      issueId: "CIR-61",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    expect(wf.id).toBe(CODEX_STARTER_FLOW_ID);
    expect(wf.repositoryId).toBe("repo-1");
    expect(wf.nodes.map((node) => node.id)).toEqual([
      "starter_boarding",
      "starter_door_closing",
      "starter_taxiing",
      "starter_takeoff",
      "starter_landing",
    ]);
    expect(wf.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["starter_boarding", "starter_door_closing"],
      ["starter_door_closing", "starter_taxiing"],
      ["starter_taxiing", "starter_takeoff"],
      ["starter_takeoff", "starter_landing"],
    ]);
    expect(wf.nodes.every((node) => node.input?.arguments === "CIR-61")).toBe(true);
    expect(validateWorkflow(wf)).toEqual({ ok: true });
  });

  it("SF2: binds starter execution to the selected repository and marks approval edges", () => {
    expect(CODEX_STARTER_FLOW_BINDING_POLICY).toEqual({
      repository: "selected-repository",
      runCwd: "repository.path",
      skillReference: "systemSkillId",
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
      issueId: "CIR-61",
      workflowId: "wf-starter",
      now: () => "2026-05-11T00:00:00.000Z",
    });

    const restored = fromWorkflow(wf);
    expect(restored.nodes[0].data.skillRef).toEqual({
      source: "system",
      provider: "codex",
      skillFile: "",
      systemSkillId: "codex:starter/boarding",
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
      source: "system",
      provider: "codex",
      systemSkillId: "codex:starter/boarding",
    });
    expect(validateWorkflow(saved)).toEqual({ ok: true });
  });
});
