import { beforeEach, describe, expect, it } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
import { useRunLogStore } from "../../runner/runLogStore";
import type {
  AgentRunEvent,
  SkillExecutionContext,
} from "../contracts/SkillExecution";
import { runViaBridge } from "./runViaBridge";

function ctx(over: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: "r-x",
    workflowId: "wf",
    nodeId: "n-x",
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
    ...over,
  } as SkillExecutionContext;
}

beforeEach(() => {
  useRunLogStore.getState().reset();
});

describe("approval forwarding integration", () => {
  it("I1: trust allow → child progresses → success", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
      ],
    });
    bridge.onInput("r-1", (text) => {
      if (text === "y\n") {
        return [
          { event: { type: "stdout", text: "approved" } },
          { event: { type: "exited", exitCode: 0 } },
        ];
      }
      return undefined;
    });
    const sink: AgentRunEvent[] = [];
    const store = useRunLogStore.getState();
    store.beginRun({ runId: "r-1", workflowId: "wf" });

    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-1",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => {
        sink.push(ev);
        useRunLogStore.getState().appendEvent("n-1", ev);
      },
    });

    // Wait for the approval to surface.
    await new Promise((r) => setTimeout(r, 5));
    const approval = Object.values(useRunLogStore.getState().pendingApprovals)[0];
    expect(approval).toBeDefined();
    await bridge.sendInput("r-1", "y\n");

    const result = await pending;
    expect(result.status).toBe("success");
    expect(bridge.sentInputs()).toEqual([{ runId: "r-1", text: "y\n" }]);
  });

  it("I2: trust deny → child exits non-zero → failed", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
      ],
    });
    bridge.onInput("r-2", (text) => {
      if (text === "n\n") {
        return [{ event: { type: "exited", exitCode: 1 } }];
      }
      return undefined;
    });
    useRunLogStore.getState().beginRun({ runId: "r-2", workflowId: "wf" });
    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-2",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("n-2", ev),
    });
    await new Promise((r) => setTimeout(r, 5));
    await bridge.sendInput("r-2", "n\n");
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  it("I3: freeform prompt round-trips an arbitrary string", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        {
          event: {
            type: "approvalRequest",
            requestId: "rq-free",
            prompt: "Enter token:",
            kind: "freeform",
          },
        },
      ],
    });
    bridge.onInput("r-3", (text) => {
      if (text === "secret\n") {
        return [{ event: { type: "exited", exitCode: 0 } }];
      }
      return undefined;
    });
    useRunLogStore.getState().beginRun({ runId: "r-3", workflowId: "wf" });
    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-3",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("n-3", ev),
    });
    await new Promise((r) => setTimeout(r, 5));
    await bridge.sendInput("r-3", "secret\n");
    const result = await pending;
    expect(result.status).toBe("success");
  });

  it("I4: multi-prompt within one run surfaces every approval (trust + command)", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
      ],
    });
    bridge.onInput("r-4", (text) => {
      if (text === "y\n") {
        return [{ event: { type: "stderr", text: "Allow this command?" } }];
      }
      if (text === "y2\n") {
        return [{ event: { type: "exited", exitCode: 0 } }];
      }
      return undefined;
    });
    useRunLogStore.getState().beginRun({ runId: "r-4", workflowId: "wf" });
    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-4",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("n-4", ev),
    });
    await new Promise((r) => setTimeout(r, 5));
    await bridge.sendInput("r-4", "y\n");
    await new Promise((r) => setTimeout(r, 5));
    const second = Object.values(useRunLogStore.getState().pendingApprovals);
    expect(second.length).toBeGreaterThanOrEqual(1);
    expect(second.some((p) => p.approvalKind === "command")).toBe(true);
    await bridge.sendInput("r-4", "y2\n");
    const result = await pending;
    expect(result.status).toBe("success");
  });

  it("I5: timeout still applies if the user never responds (CIR-26 behavior preserved)", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
        { delayMs: 10, event: { type: "timeout" } },
      ],
    });
    useRunLogStore.getState().beginRun({ runId: "r-5", workflowId: "wf" });
    const result = await runViaBridge({
      bridge,
      ctx: ctx({ execution: { timeoutMs: 50, cwd: "/repo" } }),
      runId: "r-5",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("n-5", ev),
    });
    expect(result.status).toBe("timeout");
  });

  it("I6: an approval_required event does not by itself resolve the run", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Allow this command?" } },
      ],
    });
    let resolved = false;
    const pending = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "r-6",
      command: { command: "codex", args: ["exec", "p"] },
      sink: () => {},
    }).then((r) => {
      resolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);
    await bridge.cancel("r-6");
    const result = await pending;
    expect(result.status).toBe("cancelled");
  });

  it("I7: parallel runs each maintain their own pendingApprovals entry", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
      ],
    });
    useRunLogStore.getState().beginRun({ runId: "rp-shared", workflowId: "wf" });

    const pendingA = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "rp-a",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("node-a", ev),
    });
    const pendingB = runViaBridge({
      bridge,
      ctx: ctx(),
      runId: "rp-b",
      command: { command: "codex", args: ["exec", "p"] },
      sink: (ev) => useRunLogStore.getState().appendEvent("node-b", ev),
    });
    await new Promise((r) => setTimeout(r, 10));
    const approvals = useRunLogStore.getState().pendingApprovals;
    const nodes = Object.values(approvals).map((a) => a.nodeId).sort();
    expect(nodes).toEqual(["node-a", "node-b"]);

    bridge.onInput("rp-a", (text) =>
      text === "y\n" ? [{ event: { type: "exited", exitCode: 0 } }] : undefined,
    );
    bridge.onInput("rp-b", (text) =>
      text === "y\n" ? [{ event: { type: "exited", exitCode: 0 } }] : undefined,
    );
    await bridge.sendInput("rp-a", "y\n");
    await bridge.sendInput("rp-b", "y\n");
    const [ra, rb] = await Promise.all([pendingA, pendingB]);
    expect(ra.status).toBe("success");
    expect(rb.status).toBe("success");
  });
});
