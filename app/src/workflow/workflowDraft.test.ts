import { beforeEach, describe, expect, it } from "vitest";

import { loadWorkflowDraft, saveWorkflowDraft } from "./workflowDraft";

beforeEach(() => {
  window.localStorage.clear();
});

describe("workflowDraft", () => {
  it("preserves node input in the local draft", () => {
    saveWorkflowDraft("repo-1", {
      workflowId: "wf-1",
      workflowName: "Input regression",
      continueOnFailure: true,
      nodes: [
        {
          id: "node-1",
          type: "skill",
          position: { x: 10, y: 20 },
          data: {
            label: "Boarding",
            skillRef: {
              provider: "codex",
              skillFile: ".codex/skills/boarding/SKILL.md",
            },
            input: { arguments: "CIR-46" },
          },
        },
        {
          id: "node-2",
          type: "skill",
          position: { x: 30, y: 40 },
          data: {
            label: "Prompt Only",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/prompt-only/SKILL.md",
            },
            input: { prompt: "Keep this prompt" },
          },
        },
      ],
      edges: [],
    });

    const draft = loadWorkflowDraft("repo-1");

    expect(draft?.nodes.map((node) => node.data.input)).toEqual([
      { arguments: "CIR-46" },
      { prompt: "Keep this prompt" },
    ]);
    expect(draft?.continueOnFailure).toBe(true);
  });

  it("defaults continueOnFailure to false for older drafts", () => {
    window.localStorage.setItem(
      "circuit.workflowDraft.repo-1",
      JSON.stringify({
        version: 1,
        repositoryId: "repo-1",
        workflowId: "wf-1",
        workflowName: "Older draft",
        nodes: [],
        edges: [],
        updatedAt: "2026-05-13T00:00:00.000Z",
      }),
    );

    expect(loadWorkflowDraft("repo-1")?.continueOnFailure).toBe(false);
  });
});
