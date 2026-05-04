import { describe, expect, it, vi } from "vitest";

import type { WorkflowSkillNode } from "../../workflow/schema";
import type { SkillExecutionResult } from "../contracts/SkillExecution";
import { PathOutsideRepoRootError } from "../safety/pathPolicy";
import {
  DEFAULT_TIMEOUT_MS,
  buildSkillExecutionContext,
} from "./buildSkillExecutionContext";

const baseRepo = {
  id: "repo_001",
  name: "sample-repo",
  path: "/abs/path/to/sample-repo",
};

function makeNode(
  override: Partial<WorkflowSkillNode> = {},
): WorkflowSkillNode {
  return {
    id: "node_implement",
    type: "skill",
    label: "Implement",
    position: { x: 0, y: 0 },
    skillRef: {
      provider: "claude",
      skillFile: ".claude/skills/implement-feature/SKILL.md",
    },
    input: { prompt: "do the thing" },
    ...override,
  };
}

const skillContent = [
  "---",
  "name: implement-feature",
  "description: Implements a feature",
  "---",
  "# implement-feature",
  "",
  "Body of skill",
].join("\n");

describe("buildSkillExecutionContext", () => {
  it("B1 builds a context with all fields populated and reads SKILL.md via deps", async () => {
    const reader = vi.fn(async () => skillContent);
    const previousOutputs: Record<string, SkillExecutionResult> = {};

    const ctx = await buildSkillExecutionContext(
      {
        runId: "run_42",
        workflowId: "wf_001",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs,
      },
      { readSkillFile: reader },
    );

    expect(ctx.runId).toBe("run_42");
    expect(ctx.workflowId).toBe("wf_001");
    expect(ctx.nodeId).toBe("node_implement");
    expect(ctx.repository).toEqual(baseRepo);
    expect(ctx.skill.provider).toBe("claude");
    expect(ctx.skill.skillFile).toBe(
      ".claude/skills/implement-feature/SKILL.md",
    );
    expect(ctx.skill.skillFileAbsPath).toBe(
      "/abs/path/to/sample-repo/.claude/skills/implement-feature/SKILL.md",
    );
    expect(ctx.skill.rootDir).toBe(
      "/abs/path/to/sample-repo/.claude/skills/implement-feature",
    );
    expect(ctx.skill.content).toBe(skillContent);
    expect(ctx.skill.name).toBe("implement-feature");
    expect(ctx.input).toEqual({ prompt: "do the thing" });
    expect(ctx.execution.cwd).toBe(baseRepo.path);
    expect(ctx.execution.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(ctx.execution.env).toBeUndefined();

    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(
      ctx.skill.skillFileAbsPath,
      baseRepo.path,
    );
  });

  it("B2 resolves a relative skillFile against repository.path", async () => {
    const ctx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode({
          skillRef: {
            provider: "codex",
            skillFile: ".codex/skills/review/SKILL.md",
          },
        }),
        repository: { ...baseRepo, path: "/repo" },
        previousOutputs: {},
      },
      { readSkillFile: async () => "# review" },
    );

    expect(ctx.skill.skillFileAbsPath).toBe(
      "/repo/.codex/skills/review/SKILL.md",
    );
    expect(ctx.skill.rootDir).toBe("/repo/.codex/skills/review");
  });

  it("B3 keeps an already-absolute skillFile (still validated against repo root)", async () => {
    const ctx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode({
          skillRef: {
            provider: "claude",
            skillFile: "/repo/.claude/skills/implement/SKILL.md",
          },
        }),
        repository: { ...baseRepo, path: "/repo" },
        previousOutputs: {},
      },
      { readSkillFile: async () => "# implement" },
    );

    expect(ctx.skill.skillFileAbsPath).toBe(
      "/repo/.claude/skills/implement/SKILL.md",
    );
  });

  it("B4 rejects a skillFile that escapes the repository root", async () => {
    await expect(
      buildSkillExecutionContext(
        {
          runId: "r",
          workflowId: "w",
          node: makeNode({
            skillRef: {
              provider: "claude",
              skillFile: "../outside/SKILL.md",
            },
          }),
          repository: { ...baseRepo, path: "/repo" },
          previousOutputs: {},
        },
        { readSkillFile: async () => "" },
      ),
    ).rejects.toBeInstanceOf(PathOutsideRepoRootError);
  });

  it("B5 falls back to DEFAULT_TIMEOUT_MS when timeoutMs is omitted", async () => {
    const ctx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs: {},
      },
      { readSkillFile: async () => skillContent },
    );

    expect(ctx.execution.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);

    const ctx2 = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs: {},
        timeoutMs: 1234,
        env: { FOO: "bar" },
      },
      { readSkillFile: async () => skillContent },
    );

    expect(ctx2.execution.timeoutMs).toBe(1234);
    expect(ctx2.execution.env).toEqual({ FOO: "bar" });
  });

  it("B6 passes previousOutputs through unchanged", async () => {
    const previousOutputs: Record<string, SkillExecutionResult> = {
      node_a: {
        status: "success",
        output: { foo: "bar" },
        logs: [],
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:00:01Z",
      },
    };

    const ctx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs,
      },
      { readSkillFile: async () => skillContent },
    );

    expect(ctx.previousOutputs).toBe(previousOutputs);
  });

  it("B7 derives skill.name from frontmatter, then heading, then dirname", async () => {
    const fmCtx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs: {},
      },
      { readSkillFile: async () => skillContent },
    );
    expect(fmCtx.skill.name).toBe("implement-feature");

    const headingCtx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs: {},
      },
      { readSkillFile: async () => "# Heading Name\n\nbody" },
    );
    expect(headingCtx.skill.name).toBe("Heading Name");

    const dirnameCtx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode(),
        repository: baseRepo,
        previousOutputs: {},
      },
      { readSkillFile: async () => "no heading no fm" },
    );
    expect(dirnameCtx.skill.name).toBe("implement-feature");
  });

  it("B8 defaults node.input to an empty object when missing", async () => {
    const ctx = await buildSkillExecutionContext(
      {
        runId: "r",
        workflowId: "w",
        node: makeNode({ input: undefined }),
        repository: baseRepo,
        previousOutputs: {},
      },
      { readSkillFile: async () => skillContent },
    );

    expect(ctx.input).toEqual({});
  });
});
