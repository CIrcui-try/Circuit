import { describe, expect, it } from "vitest";

import {
  createMockRuntimeBridge,
  type MockRuntimeBridge,
  type SpawnScenario,
} from "../bridge/RuntimeBridge.mock";
import type {
  RuntimeBridge,
  SpawnOptions,
} from "../bridge/RuntimeBridge";
import type {
  SkillExecutionContext,
} from "./AgentAdapter";
import { CodexAdapter } from "./CodexAdapter";

function makeContext(over: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: "run_001",
    workflowId: "wf_001",
    nodeId: "node_review",
    repository: {
      id: "repo_001",
      name: "sample-repo",
      path: "/abs/path/to/sample-repo",
    },
    skill: {
      provider: "codex",
      name: "review-pr",
      rootDir: "/abs/path/to/sample-repo/.codex/skills/review-pr",
      skillFile: ".codex/skills/review-pr/SKILL.md",
      skillFileAbsPath:
        "/abs/path/to/sample-repo/.codex/skills/review-pr/SKILL.md",
      content: "# review-pr\n\nReview the diff.\n",
    },
    input: { prompt: "review the diff" },
    previousOutputs: {},
    execution: {
      timeoutMs: 300_000,
      cwd: "/abs/path/to/sample-repo",
      env: { FOO: "bar" },
    },
    ...over,
  };
}

interface SpyBridge {
  bridge: RuntimeBridge;
  mock: MockRuntimeBridge;
  spawnCalls: SpawnOptions[];
}

function spy(scenario?: SpawnScenario): SpyBridge {
  const mock = createMockRuntimeBridge({ scenario });
  const spawnCalls: SpawnOptions[] = [];
  const bridge: RuntimeBridge = {
    readFile: (p, r) => mock.readFile(p, r),
    spawn: async (opts) => {
      spawnCalls.push(opts);
      return mock.spawn(opts);
    },
    cancel: (id) => mock.cancel(id),
    subscribe: (id, listener) => mock.subscribe(id, listener),
  };
  return { bridge, mock, spawnCalls };
}

describe("CodexAdapter", () => {
  it("C1 — provider is 'codex'", () => {
    const { bridge } = spy();
    const adapter = new CodexAdapter({ bridge });
    expect(adapter.provider).toBe("codex");
  });

  it("C2 — canRun returns ok when probe exits 0", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("codex");
    expect(spawnCalls[0].args).toEqual(["--version"]);
    expect(spawnCalls[0].cwd).toBe("/abs/path/to/sample-repo");
  });

  it("C5 — canRun with skipProbe returns ok immediately and does not spawn", async () => {
    const { bridge, spawnCalls } = spy();
    const adapter = new CodexAdapter({ bridge, skipProbe: true });
    const availability = await adapter.canRun(makeContext());
    expect(availability).toEqual({ ok: true, details: { skipped: true } });
    expect(spawnCalls).toHaveLength(0);
  });
});
