import { describe, expect, it } from "vitest";

import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";
import { buildDefaultPrompt } from "./buildPrompt";

function makeContext(
  override: Partial<SkillExecutionContext> = {},
): SkillExecutionContext {
  const base: SkillExecutionContext = {
    runId: "run_1",
    workflowId: "wf_1",
    nodeId: "node_a",
    repository: { id: "repo_1", name: "sample", path: "/repo" },
    skill: {
      provider: "claude",
      name: "implement-feature",
      rootDir: "/repo/.claude/skills/implement",
      skillFile: ".claude/skills/implement/SKILL.md",
      skillFileAbsPath: "/repo/.claude/skills/implement/SKILL.md",
      content: "# implement\n\nDo it carefully.",
    },
    input: { prompt: "do it" },
    previousOutputs: {},
    execution: { timeoutMs: 300_000, cwd: "/repo" },
  };
  return { ...base, ...override };
}

describe("buildDefaultPrompt", () => {
  it("P1 includes the SKILL.md content verbatim", () => {
    const prompt = buildDefaultPrompt(makeContext());
    expect(prompt).toContain("## SKILL.md");
    expect(prompt).toContain("# implement\n\nDo it carefully.");
  });

  it("P2 serializes input as a JSON code fence", () => {
    const prompt = buildDefaultPrompt(
      makeContext({ input: { prompt: "do it", count: 3 } }),
    );
    expect(prompt).toContain("## Input");
    expect(prompt).toContain('```json\n{\n  "prompt": "do it",\n  "count": 3\n}\n```');
  });

  it("P3 includes previousOutputs entries with status, summary and output", () => {
    const previousOutputs: Record<string, SkillExecutionResult> = {
      node_a: {
        status: "success",
        summary: "applied diff",
        output: { diff: "+1 -0" },
        logs: [],
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:00:01Z",
      },
    };
    const prompt = buildDefaultPrompt(makeContext({ previousOutputs }));

    expect(prompt).toContain("## Previous Outputs");
    expect(prompt).toContain("### node_a");
    expect(prompt).toContain("- status: success");
    expect(prompt).toContain("- summary: applied diff");
    expect(prompt).toContain('"diff": "+1 -0"');
  });

  it("P4 includes execution instructions referencing the repository path", () => {
    const prompt = buildDefaultPrompt(
      makeContext({
        repository: { id: "x", name: "y", path: "/some/repo/path" },
      }),
    );
    expect(prompt).toContain("## Execution Instructions");
    expect(prompt).toContain(
      "Do not modify files outside the repository at /some/repo/path.",
    );
  });

  it("P5 marks empty input and previousOutputs as (none)", () => {
    const prompt = buildDefaultPrompt(
      makeContext({ input: {}, previousOutputs: {} }),
    );
    expect(prompt).toMatch(/## Input\n\n\(none\)/);
    expect(prompt).toMatch(/## Previous Outputs\n\n\(none\)/);
  });

  it("renders the section order deterministically", () => {
    const prompt = buildDefaultPrompt(makeContext());
    const order = [
      "# Skill: implement-feature",
      "## Repository",
      "## SKILL.md",
      "## Input",
      "## Previous Outputs",
      "## Execution Instructions",
    ];
    let cursor = 0;
    for (const heading of order) {
      const idx = prompt.indexOf(heading, cursor);
      expect(idx, `expected ${heading} after position ${cursor}`).toBeGreaterThan(
        -1,
      );
      cursor = idx + heading.length;
    }
  });
});
