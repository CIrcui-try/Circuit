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

  it("closes stdin when codex reports it is reading additional input", async () => {
    const sink: AgentRunEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "stderr",
            text: "Reading additional input from stdin...",
          },
        },
      ],
    });
    bridge.onCloseInput("r-stdin", () => ({
      event: { type: "exited", exitCode: 0 },
    }));

    const result = await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-stdin",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => sink.push(ev),
    });

    expect(result.status).toBe("success");
    expect(bridge.closedInputs()).toEqual(["r-stdin"]);
    expect(sink).toContainEqual(
      expect.objectContaining({
        type: "stderr",
        text: "Reading additional input from stdin...",
      }),
    );
  });

  it("marks zero-exit runs failed when CIRCUIT_SUMMARY reports a blocker", async () => {
    const sink: AgentRunEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "stdout",
            text: "CIRCUIT_SUMMARY: GitHub CLI token invalid로 review-and-fix를 중단했습니다.\n",
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    const result = await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-summary-failed",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => sink.push(ev),
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe(
      "GitHub CLI token invalid로 review-and-fix를 중단했습니다.",
    );
    expect(sink).toContainEqual(
      expect.objectContaining({ type: "finish", exitCode: 0 }),
    );
  });

  it("keeps zero-exit runs successful when CIRCUIT_SUMMARY reports success", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "stderr",
            text: "CIRCUIT_SUMMARY: CIR-59 구현과 테스트를 완료했습니다.\n",
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    const result = await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-summary-success",
      command: { command: "codex", args: ["exec", "p"] },
      sink: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.summary).toBe("CIR-59 구현과 테스트를 완료했습니다.");
  });

  it("keeps non-zero exits failed regardless of CIRCUIT_SUMMARY wording", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "stdout",
            text: "CIRCUIT_SUMMARY: 모든 작업을 완료했습니다.\n",
          },
        },
        { event: { type: "exited", exitCode: 2 } },
      ],
    });

    const result = await runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-summary-nonzero",
      command: { command: "codex", args: ["exec", "p"] },
      sink: () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.summary).toBe("모든 작업을 완료했습니다.");
  });
});
