import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { fromWorkflow, toWorkflow } from "./serialize";
import { WORKFLOW_VERSION, type Workflow } from "./schema";
import type { SkillNode } from "../stores/workflowStore";

const sampleNodes: SkillNode[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    type: "skill",
    position: { x: 12, y: 34 },
    data: {
      label: "Implement Feature",
      skillRef: {
        provider: "claude",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
      },
    },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    type: "skill",
    position: { x: 200, y: 80 },
    data: {
      label: "Review Code",
      skillRef: {
        provider: "codex",
        skillFile: ".codex/skills/review-code/SKILL.md",
      },
    },
  },
];

const sampleEdges: Edge[] = [
  {
    id: "edge_1",
    source: "11111111-1111-4111-8111-111111111111",
    target: "22222222-2222-4222-8222-222222222222",
  },
];

const meta = {
  id: "wf-abc",
  repositoryId: "repo-xyz",
  name: "Sample workflow",
  createdAt: "2026-04-01T00:00:00.000Z",
};

describe("workflow/serialize", () => {
  it("SR1: round-trips RF -> Workflow -> RF preserving ids/positions/skillRef/edges", () => {
    const wf = toWorkflow(
      { nodes: sampleNodes, edges: sampleEdges },
      meta,
      () => "2026-04-30T00:00:00.000Z",
    );
    const restored = fromWorkflow(wf);

    expect(restored.nodes).toEqual(sampleNodes);
    expect(restored.edges).toEqual([
      {
        id: "edge_1",
        source: "11111111-1111-4111-8111-111111111111",
        target: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    expect(restored.meta).toEqual({
      id: "wf-abc",
      name: "Sample workflow",
      repositoryId: "repo-xyz",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
  });

  it("SR2: toWorkflow injects version, repositoryId, and updatedAt", () => {
    const wf = toWorkflow(
      { nodes: sampleNodes, edges: sampleEdges },
      meta,
      () => "2026-04-30T12:00:00.000Z",
    );

    expect(wf.version).toBe(WORKFLOW_VERSION);
    expect(wf.repositoryId).toBe("repo-xyz");
    expect(wf.updatedAt).toBe("2026-04-30T12:00:00.000Z");
    expect(wf.createdAt).toBe("2026-04-01T00:00:00.000Z");
    expect(wf.nodes[0].skillRef).toEqual({
      provider: "claude",
      skillFile: ".claude/skills/implement-feature/SKILL.md",
    });
    expect(wf.edges[0].kind).toBe("dependency");
  });

  it("SR3: fromWorkflow rejects unknown version", () => {
    const wf = {
      version: "9.9",
      id: "x",
      repositoryId: "r",
      name: "n",
      nodes: [],
      edges: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as unknown as Workflow;
    expect(() => fromWorkflow(wf)).toThrow(/version/i);
  });

  it("SR4: fromWorkflow rejects nodes missing skillRef", () => {
    const wf = {
      version: WORKFLOW_VERSION,
      id: "x",
      repositoryId: "r",
      name: "n",
      nodes: [
        {
          id: "n1",
          type: "skill",
          label: "x",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as unknown as Workflow;
    expect(() => fromWorkflow(wf)).toThrow(/skillRef/);
  });

  it("SR5: re-serializing advances updatedAt while preserving createdAt", () => {
    let now = "2026-04-30T00:00:00.000Z";
    const wf1 = toWorkflow({ nodes: sampleNodes, edges: sampleEdges }, meta, () => now);
    now = "2026-05-01T00:00:00.000Z";
    const wf2 = toWorkflow(
      { nodes: sampleNodes, edges: sampleEdges },
      { ...meta, createdAt: wf1.createdAt },
      () => now,
    );
    expect(wf2.createdAt).toBe(wf1.createdAt);
    expect(wf2.updatedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("SR6: preserves node input for runtime debug settings", () => {
    const nodes: SkillNode[] = [
      {
        ...sampleNodes[0],
        data: {
          ...sampleNodes[0].data,
          input: { timeoutMs: 5_000, idleTimeoutMs: 1_000 },
        },
      },
    ];

    const wf = toWorkflow({ nodes, edges: [] }, meta, () => "2026-05-02T00:00:00Z");
    expect(wf.nodes[0].input).toEqual({
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });

    const restored = fromWorkflow(wf);
    expect(restored.nodes[0].data.input).toEqual({
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });
  });

  it("SR7: preserves slash-command arguments and prompt-only input", () => {
    const nodes: SkillNode[] = [
      {
        ...sampleNodes[0],
        data: {
          ...sampleNodes[0].data,
          input: { arguments: "CIR-46 --force" },
        },
      },
      {
        ...sampleNodes[1],
        data: {
          ...sampleNodes[1].data,
          input: { prompt: "Review only the regression tests" },
        },
      },
    ];

    const wf = toWorkflow({ nodes, edges: sampleEdges }, meta, () => "2026-05-02T00:00:00Z");
    expect(wf.nodes.map((node) => node.input)).toEqual([
      { arguments: "CIR-46 --force" },
      { prompt: "Review only the regression tests" },
    ]);

    const restored = fromWorkflow(wf);
    expect(restored.nodes.map((node) => node.data.input)).toEqual([
      { arguments: "CIR-46 --force" },
      { prompt: "Review only the regression tests" },
    ]);
  });
});
