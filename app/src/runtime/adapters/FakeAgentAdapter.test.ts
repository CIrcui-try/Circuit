import { describe, expect, it } from "vitest";

import type {
  AgentRunEvent,
  SkillExecutionContext,
} from "./AgentAdapter";
import { FakeAgentAdapter } from "./FakeAgentAdapter";

function makeContext(): SkillExecutionContext {
  return {
    runId: "run_001",
    workflowId: "wf_001",
    nodeId: "node_implement",
    repository: {
      id: "repo_001",
      name: "sample-repo",
      path: "/abs/path/to/sample-repo",
    },
    skill: {
      provider: "claude",
      name: "implement-feature",
      rootDir: "/abs/path/to/sample-repo/.claude/skills/implement-feature",
      skillFile: ".claude/skills/implement-feature/SKILL.md",
      skillFileAbsPath:
        "/abs/path/to/sample-repo/.claude/skills/implement-feature/SKILL.md",
      content: "# implement-feature\n",
    },
    input: { prompt: "do the thing" },
    previousOutputs: {},
    execution: {
      timeoutMs: 300_000,
      cwd: "/abs/path/to/sample-repo",
    },
  };
}

describe("FakeAgentAdapter", () => {
  it("F1 — provider matches the option", () => {
    const adapter = new FakeAgentAdapter({ provider: "codex" });
    expect(adapter.provider).toBe("codex");
  });

  it("F2 — canRun defaults to { ok: true }", async () => {
    const adapter = new FakeAgentAdapter({ provider: "claude" });
    await expect(adapter.canRun(makeContext())).resolves.toEqual({ ok: true });
  });

  it("F3 — canRun returns the configured availability", async () => {
    const availability = {
      ok: false,
      reason: "claude CLI not found",
      details: { lookedAt: ["/usr/local/bin/claude"] },
    };
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      availability,
    });
    await expect(adapter.canRun(makeContext())).resolves.toEqual(availability);
  });

  it("F4 — run emits configured events to the sink in order", async () => {
    const events: AgentRunEvent[] = [
      { type: "start", timestamp: "2026-01-01T00:00:00.000Z", message: "go" },
      { type: "stdout", timestamp: "2026-01-01T00:00:00.001Z", text: "hello" },
      { type: "finish", timestamp: "2026-01-01T00:00:00.002Z", exitCode: 0 },
    ];
    const adapter = new FakeAgentAdapter({ provider: "claude", events });

    const received: AgentRunEvent[] = [];
    await adapter.run(makeContext(), (ev) => received.push(ev));

    expect(received).toEqual(events);
  });

  it("F5 — run returns result with logs deep-equal events and timestamps populated", async () => {
    const events: AgentRunEvent[] = [
      { type: "start", timestamp: "2026-01-01T00:00:00.000Z", message: "go" },
    ];
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      events,
      result: {
        status: "success",
        exitCode: 0,
        output: { ok: true },
        summary: "did the thing",
      },
    });

    const result = await adapter.run(makeContext(), () => {});

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ ok: true });
    expect(result.summary).toBe("did the thing");
    expect(result.logs).toEqual(events);
    expect(typeof result.startedAt).toBe("string");
    expect(typeof result.finishedAt).toBe("string");
  });

  it("F6 — run records each call's context on seenContexts", async () => {
    const adapter = new FakeAgentAdapter({ provider: "claude" });
    const ctxA = makeContext();
    const ctxB = { ...makeContext(), runId: "run_002" };

    await adapter.run(ctxA, () => {});
    await adapter.run(ctxB, () => {});

    expect(adapter.seenContexts).toHaveLength(2);
    expect(adapter.seenContexts[0]).toBe(ctxA);
    expect(adapter.seenContexts[1]).toBe(ctxB);
  });

  it("F7 — run rejects with failWith when configured", async () => {
    const failure = new Error("boom");
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      failWith: failure,
    });

    await expect(adapter.run(makeContext(), () => {})).rejects.toBe(failure);
  });

  it("F8 — default result status is success when no result option is provided", async () => {
    const adapter = new FakeAgentAdapter({ provider: "claude" });
    const result = await adapter.run(makeContext(), () => {});
    expect(result.status).toBe("success");
    expect(result.logs).toEqual([]);
  });
});
