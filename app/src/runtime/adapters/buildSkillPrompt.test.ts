import { describe, expect, it } from "vitest";

import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";
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

  it("adds previous failure context for reruns without framing it as a session resume", () => {
    const previousAttempt: SkillExecutionResult = {
      status: "failed",
      exitCode: 2,
      summary: "command failed",
      logs: [
        { type: "stdout", timestamp: "t", text: "started\n" },
        { type: "stderr", timestamp: "t", text: "warn\n" },
        { type: "error", timestamp: "t", message: "boom" },
      ],
      startedAt: "t0",
      finishedAt: "t1",
    };

    const prompt = buildSkillPrompt({
      ...makeContext({ arguments: "CIR-70" }),
      nodeId: "node_fix",
      rerun: {
        previousAttempt,
        lastError: "boom",
        stdoutTail: "started\n",
        stderrTail: "warn\n",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    });

    expect(prompt).toContain("# Rerun With Previous Failure Context");
    expect(prompt).toContain("a new process and a new prompt");
    expect(prompt).toContain("- node: node_fix");
    expect(prompt).toContain("- previous status: failed");
    expect(prompt).toContain("- previous summary: command failed");
    expect(prompt).toContain("- last error: boom");
    expect(prompt).toContain("## Previous stdout tail");
    expect(prompt).toContain("started");
    expect(prompt).toContain("## Previous stderr tail");
    expect(prompt).toContain("warn");
  });

  it("marks rerun stdout and stderr tails when they were truncated", () => {
    const previousAttempt: SkillExecutionResult = {
      status: "failed",
      logs: [],
      startedAt: "t0",
      finishedAt: "t1",
    };

    const prompt = buildSkillPrompt({
      ...makeContext({ arguments: "CIR-70" }),
      rerun: {
        previousAttempt,
        stdoutTail: "stdout tail",
        stderrTail: "stderr tail",
        stdoutTruncated: true,
        stderrTruncated: true,
      },
    });

    expect(prompt).toContain("… (truncated)\nstdout tail");
    expect(prompt).toContain("… (truncated)\nstderr tail");
  });
});
