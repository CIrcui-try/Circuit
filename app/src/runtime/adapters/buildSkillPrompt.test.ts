import { describe, expect, it } from "vitest";

import type { SkillExecutionContext } from "../contracts/SkillExecution";
import { buildSkillPrompt } from "./buildSkillPrompt";

function makeContext(input: Record<string, unknown>): SkillExecutionContext {
  return {
    runId: "run_001",
    workflowId: "wf_001",
    nodeId: "node_boarding",
    repository: {
      id: "repo_001",
      name: "sample-repo",
      path: "/abs/path/to/sample-repo",
    },
    skill: {
      provider: "codex",
      name: "boarding",
      rootDir: "/abs/path/to/sample-repo/.codex/skills/boarding",
      skillFile: ".codex/skills/boarding/SKILL.md",
      skillFileAbsPath:
        "/abs/path/to/sample-repo/.codex/skills/boarding/SKILL.md",
      content: "# boarding\n\nPrepare the issue.\n",
    },
    input,
    previousOutputs: {},
    execution: {
      timeoutMs: 300_000,
      cwd: "/abs/path/to/sample-repo",
    },
  };
}

describe("buildSkillPrompt", () => {
  it("explains arguments and prompt semantics while preserving the exact input JSON", () => {
    const prompt = buildSkillPrompt(
      makeContext({
        arguments: "CIR-46 --force",
        prompt: "Summarize the regression risk",
      }),
    );

    expect(prompt).toContain("# Input");
    expect(prompt).toContain("exact workflow node input");
    expect(prompt).toContain("`arguments` as slash-command style arguments");
    expect(prompt).toContain("`prompt` as the free-form user prompt");
    expect(prompt).toContain('"arguments": "CIR-46 --force"');
    expect(prompt).toContain('"prompt": "Summarize the regression risk"');
  });

  it("asks agents to emit a Circuit summary line for the run log", () => {
    const prompt = buildSkillPrompt(makeContext({ arguments: "CIR-46" }));

    expect(prompt).toContain("# Circuit Run Log Summary");
    expect(prompt).toContain("CIRCUIT_SUMMARY: <one concise sentence about the outcome>");
    expect(prompt).toContain("Do not include secrets.");
  });
});
