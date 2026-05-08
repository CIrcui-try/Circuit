import { describe, expect, it } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
import type { AgentRunEvent, SkillExecutionContext } from "./AgentAdapter";
import { runViaBridge } from "./runViaBridge";

function ctx(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: "r-1",
    workflowId: "w-1",
    nodeId: "n-1",
    repository: { id: "repo-1", name: "repo", path: "/repo" },
    skill: {
      provider: "codex",
      name: "skill",
      rootDir: "/repo",
      skillFile: "skill.md",
      skillFileAbsPath: "/repo/skill.md",
      content: "",
    },
    input: {},
    previousOutputs: {},
    execution: { timeoutMs: 1_000, cwd: "/repo" },
    ...overrides,
  } as SkillExecutionContext;
}

describe("runViaBridge approval forwarding", () => {
  it("adds process metadata to start events", async () => {
    const sink: AgentRunEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-meta",
      command: { command: "codex", args: ["exec", "prompt"] },
      sink: (ev) => sink.push(ev),
    });

    expect(sink[0]).toMatchObject({
      type: "start",
      command: "codex",
      args: ["exec", "prompt"],
      spawnType: "process",
    });
  });

  it("forwards approvalRequest as a non-terminal approval_required event", async () => {
    const sink: AgentRunEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "approvalRequest",
            requestId: "rq-1",
            prompt: "Do you trust this directory?",
            kind: "trust",
          },
        },
        { delayMs: 5, event: { type: "stdout", text: "approved" } },
        { delayMs: 5, event: { type: "exited", exitCode: 0 } },
      ],
    });

    const result = await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-1",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => sink.push(ev),
    });

    expect(result.status).toBe("success");
    const approvals = sink.filter((e) => e.type === "approval_required");
    expect(approvals).toHaveLength(1);
    const approval = approvals[0] as Extract<
      AgentRunEvent,
      { type: "approval_required" }
    >;
    expect(approval.requestId).toBe("rq-1");
    expect(approval.approvalKind).toBe("trust");
    expect(approval.prompt).toMatch(/trust this directory/);
  });

  it("does not resolve until a terminal event arrives, even after approvalRequest", async () => {
    const sink: AgentRunEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "approvalRequest",
            requestId: "rq-2",
            prompt: "Allow this command?",
            kind: "command",
          },
        },
      ],
    });

    let settled = false;
    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-2",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => sink.push(ev),
    }).then((r) => {
      settled = true;
      return r;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    expect(sink.some((e) => e.type === "approval_required")).toBe(true);

    await bridge.cancel("r-2");
    const result = await pending;
    expect(result.status).toBe("cancelled");
  });
});
