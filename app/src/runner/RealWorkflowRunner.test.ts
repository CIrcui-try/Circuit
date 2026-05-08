import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../runtime/adapters/AdapterRegistry";
import { FakeAgentAdapter } from "../runtime/adapters/FakeAgentAdapter";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEventSink,
} from "../runtime/adapters/AgentAdapter";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import type {
  AgentRunEvent,
  SkillExecutionContext,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";
import type { WorkflowSkillNode } from "../workflow/schema";
import { RealWorkflowRunner } from "./RealWorkflowRunner";
import { useRunLogStore } from "./runLogStore";
import { useRunStore } from "./runStore";
import type { RunnableNode } from "./runner";

const REPO = {
  id: "repo-1",
  name: "circuit",
  path: "/repos/circuit",
};

const SKILL_PATH = ".claude/skills/example/SKILL.md";
const SKILL_ABS_PATH = `${REPO.path}/${SKILL_PATH}`;
const SKILL_CONTENT =
  "---\nname: example-skill\ndescription: example\n---\n\n# example\n\nDo the thing.\n";

function workflowNode(
  id: string,
  provider: "claude" | "codex" = "claude",
  input: Record<string, unknown> = {},
): WorkflowSkillNode {
  return {
    id,
    type: "skill",
    skillRef: { provider, skillFile: SKILL_PATH },
    label: id,
    position: { x: 0, y: 0 },
    input,
  };
}

function runnable(node: WorkflowSkillNode): RunnableNode {
  const provider = node.skillRef.provider;
  if (provider !== "claude" && provider !== "codex") {
    throw new Error(`unsupported provider in test: ${provider}`);
  }
  return {
    id: node.id,
    label: node.label,
    skillRef: { provider, skillFile: node.skillRef.skillFile },
  };
}

interface Harness {
  registry: AdapterRegistry;
  bridge: ReturnType<typeof createMockRuntimeBridge>;
  runner: RealWorkflowRunner;
  nodes: Map<string, WorkflowSkillNode>;
  runMeta: { runId: string; workflowId: string | null };
}

function makeHarness(
  opts: {
    nodes?: WorkflowSkillNode[];
    repository?: typeof REPO | null;
  } = {},
): Harness {
  const nodesArr = opts.nodes ?? [workflowNode("a")];
  const nodes = new Map(nodesArr.map((n) => [n.id, n]));
  const repository = opts.repository === undefined ? REPO : opts.repository;

  const bridge = createMockRuntimeBridge({
    files: { [SKILL_ABS_PATH]: SKILL_CONTENT },
  });

  const registry = new AdapterRegistry();
  const runMeta: { runId: string; workflowId: string | null } = {
    runId: "run_1",
    workflowId: "wf",
  };

  const runner = new RealWorkflowRunner({
    registry,
    bridge,
    logStore: useRunLogStore,
    runStore: useRunStore,
    getNode: (id) => nodes.get(id) ?? null,
    getRepository: () => repository,
    getRunMeta: () => runMeta,
  });

  return { registry, bridge, runner, nodes, runMeta };
}

const finishEvent = (exitCode = 0): AgentRunEvent => ({
  type: "finish",
  timestamp: "t1",
  exitCode,
});

beforeEach(() => {
  useRunLogStore.getState().reset();
  useRunStore.getState().reset();
});

describe("RealWorkflowRunner", () => {
  it("R1: looks up adapter by provider and passes ctx with that provider", async () => {
    const claudeNode = workflowNode("a", "claude");
    const codexNode = workflowNode("b", "codex");
    const harness = makeHarness({ nodes: [claudeNode, codexNode] });

    const claudeAdapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success" },
    });
    const codexAdapter = new FakeAgentAdapter({
      provider: "codex",
      result: { status: "success" },
    });
    harness.registry.register(claudeAdapter);
    harness.registry.register(codexAdapter);

    const r1 = await harness.runner.runNode(runnable(claudeNode));
    const r2 = await harness.runner.runNode(runnable(codexNode));

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(claudeAdapter.seenContexts).toHaveLength(1);
    expect(claudeAdapter.seenContexts[0].skill.provider).toBe("claude");
    expect(codexAdapter.seenContexts).toHaveLength(1);
    expect(codexAdapter.seenContexts[0].skill.provider).toBe("codex");
  });

  it("R2: builds context with bridge.readFile content and repo cwd", async () => {
    const node = workflowNode("a", "claude", { foo: 1 });
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({ provider: "claude" });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    const ctx = adapter.seenContexts[0];
    expect(ctx.skill.content).toBe(SKILL_CONTENT);
    expect(ctx.skill.skillFile).toBe(SKILL_PATH);
    expect(ctx.skill.skillFileAbsPath).toBe(SKILL_ABS_PATH);
    expect(ctx.execution.cwd).toBe(REPO.path);
    expect(ctx.input).toEqual({ foo: 1 });
    expect(ctx.repository).toEqual(REPO);
    expect(ctx.runId).toBe("run_1");
    expect(ctx.workflowId).toBe("wf");
    expect(ctx.nodeId).toBe("a");
  });

  it("R3: accumulates previousOutputs for downstream nodes", async () => {
    const a = workflowNode("a");
    const b = workflowNode("b");
    const harness = makeHarness({ nodes: [a, b] });

    const aResult: Omit<
      SkillExecutionResult,
      "logs" | "startedAt" | "finishedAt"
    > = {
      status: "success",
      exitCode: 0,
      output: { value: 42 },
      summary: "ran a",
    };
    const adapterA = new FakeAgentAdapter({ provider: "claude", result: aResult });
    harness.registry.register(adapterA);

    await harness.runner.runNode(runnable(a));
    await harness.runner.runNode(runnable(b));

    const ctxB = adapterA.seenContexts[1];
    expect(ctxB.previousOutputs).toHaveProperty("a");
    expect(ctxB.previousOutputs.a.status).toBe("success");
    expect(ctxB.previousOutputs.a.output).toEqual({ value: 42 });
    expect(ctxB.previousOutputs.a.summary).toBe("ran a");

    // First node sees an empty previousOutputs map.
    expect(adapterA.seenContexts[0].previousOutputs).toEqual({});
  });

  it("R4: stores SkillExecutionResult in runLogStore.nodeResults", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success", exitCode: 0, summary: "ok" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    const stored = useRunLogStore.getState().nodeResults.a;
    expect(stored).toBeDefined();
    expect(stored.status).toBe("success");
    expect(stored.exitCode).toBe(0);
    expect(stored.summary).toBe("ok");
  });

  it("R5: forwards adapter events to runLogStore (events + nodeEvents)", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });

    const events: AgentRunEvent[] = [
      { type: "start", timestamp: "t0", message: "spawn claude" },
      { type: "stdout", timestamp: "t1", text: "hello" },
      finishEvent(0),
    ];
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      events,
      result: { status: "success", exitCode: 0 },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    const log = useRunLogStore.getState();
    expect(log.events).toEqual(events.map((e) => ({ nodeId: "a", event: e })));
    expect(log.nodeEvents.a).toEqual(events);
  });

  it("R6: maps adapter failure to RunResult ok=false with status + exitCode", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "failed", exitCode: 2 },
    });
    harness.registry.register(adapter);

    const result = await harness.runner.runNode(runnable(node));

    expect(result).toEqual({
      ok: false,
      status: "failed",
      reason: "failed (exit 2)",
    });
  });

  it("R7: cancel() calls bridge.cancel with `${runId}::${nodeId}` and surfaces cancelled status", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });

    let resolveAdapter: ((v: SkillExecutionResult) => void) | null = null;
    const cancelSpy = vi.fn(async (_runId: string) => {
      // Mirror runViaBridge behavior: cancel resolves the run with status="cancelled".
      resolveAdapter?.({
        status: "cancelled",
        logs: [],
        startedAt: "t0",
        finishedAt: "t1",
      });
    });

    const cancellableAdapter: AgentAdapter = {
      provider: "claude",
      async canRun(): Promise<AdapterAvailability> {
        return { ok: true };
      },
      run(_ctx: SkillExecutionContext, _sink: AgentRunEventSink) {
        return new Promise<SkillExecutionResult>((resolve) => {
          resolveAdapter = resolve;
        });
      },
    };
    harness.registry.register(cancellableAdapter);

    // Replace bridge.cancel with our spy. readFile is unaffected.
    const spiedBridge: RuntimeBridge = {
      ...harness.bridge,
      cancel: cancelSpy,
    };
    const runner = new RealWorkflowRunner({
      registry: harness.registry,
      bridge: spiedBridge,
      logStore: useRunLogStore,
      runStore: useRunStore,
      getNode: (id) => harness.nodes.get(id) ?? null,
      getRepository: () => REPO,
      getRunMeta: () => harness.runMeta,
    });

    const pending = runner.runNode(runnable(node));
    // Yield once so runNode can reach the adapter.run await.
    await Promise.resolve();
    await Promise.resolve();
    await runner.cancel();
    const result = await pending;

    expect(cancelSpy).toHaveBeenCalledWith("run_1::a");
    expect(result).toEqual({
      ok: false,
      status: "cancelled",
      reason: "cancelled",
    });
  });

  it("R8: clears previousOutputs when getRunMeta runId changes between calls", async () => {
    const a = workflowNode("a");
    const harness = makeHarness({ nodes: [a] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success", output: "first" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(a));

    // Second run: bump runId.
    harness.runMeta.runId = "run_2";

    await harness.runner.runNode(runnable(a));

    // The second call should not carry the first run's "a" output.
    expect(adapter.seenContexts[1].previousOutputs).toEqual({});
    // runLogStore should also have been re-initialized.
    expect(useRunLogStore.getState().runId).toBe("run_2");
  });

  it("R9: unknown provider yields ok=false with UnknownProviderError message", async () => {
    const node = workflowNode("a", "codex");
    const harness = makeHarness({ nodes: [node] });
    // No adapters registered.

    const result = await harness.runner.runNode(runnable(node));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("codex");
    }
    const log = useRunLogStore.getState();
    expect(log.events).toHaveLength(1);
    expect(log.events[0].nodeId).toBe("a");
    expect(log.events[0].event.type).toBe("error");
    expect(log.nodeResults.a.status).toBe("failed");
  });

  it("R10: forwards numeric node.input.timeoutMs to ctx.execution.timeoutMs", async () => {
    const node = workflowNode("a", "claude", { timeoutMs: 7_500 });
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    expect(adapter.seenContexts[0].execution.timeoutMs).toBe(7_500);
  });

  it("R11: ignores non-numeric or non-positive node.input.timeoutMs", async () => {
    const a = workflowNode("a", "claude", { timeoutMs: "fast" });
    const b = workflowNode("b", "claude", { timeoutMs: -100 });
    const harness = makeHarness({ nodes: [a, b] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(a));
    await harness.runner.runNode(runnable(b));

    // 둘 다 default 로 떨어진다.
    expect(adapter.seenContexts[0].execution.timeoutMs).toBe(300_000);
    expect(adapter.seenContexts[1].execution.timeoutMs).toBe(300_000);
  });

  it("records process metadata from start events", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });
    const startEvent: AgentRunEvent = {
      type: "start",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: "spawn claude",
      command: "claude",
      args: ["-p", "prompt"],
      spawnType: "process",
    };
    const adapter: AgentAdapter = {
      provider: "claude",
      async canRun(): Promise<AdapterAvailability> {
        return { ok: true };
      },
      async run(_ctx: SkillExecutionContext, sink: AgentRunEventSink) {
        sink(startEvent);
        return {
          status: "success",
          exitCode: 0,
          logs: [startEvent],
          startedAt: "2026-05-09T00:00:00.000Z",
          finishedAt: "2026-05-09T00:00:01.250Z",
        };
      },
    };
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    expect(useRunStore.getState().nodeDebug.a).toMatchObject({
      adapter: "claude",
      adapterRunId: "run_1::a",
      command: "claude",
      args: ["-p", "prompt"],
      spawnType: "process",
      startedAt: "2026-05-09T00:00:00.000Z",
      durationMs: 1_250,
      exitCode: 0,
      lastLogAt: "2026-05-09T00:00:00.000Z",
      idleTimeoutMs: 30_000,
    });
  });

  it("marks a node waiting_input when stderr says stdin is being read", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      events: [
        {
          type: "stderr",
          timestamp: "t-stdin",
          text: "Reading additional input from stdin...",
        },
      ],
      result: { status: "success" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    expect(useRunStore.getState().nodeStates.a).toBe("waiting_input");
  });

  it("marks a node waiting_input when approval is required", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node] });
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      events: [
        {
          type: "approval_required",
          timestamp: "t-approval",
          requestId: "rq-1",
          prompt: "Allow?",
          approvalKind: "command",
        },
      ],
      result: { status: "success" },
    });
    harness.registry.register(adapter);

    await harness.runner.runNode(runnable(node));

    expect(useRunStore.getState().nodeStates.a).toBe("waiting_input");
  });

  it("records idle status when a running node produces no output", async () => {
    vi.useFakeTimers();
    try {
      const node = workflowNode("a", "claude", { idleTimeoutMs: 25 });
      const harness = makeHarness({ nodes: [node] });
      let resolveAdapter: (v: SkillExecutionResult) => void = () => {};
      const adapter: AgentAdapter = {
        provider: "claude",
        async canRun(): Promise<AdapterAvailability> {
          return { ok: true };
        },
        run(_ctx: SkillExecutionContext, sink: AgentRunEventSink) {
          sink({
            type: "start",
            timestamp: "2026-05-09T00:00:00.000Z",
            message: "spawn claude",
          });
          return new Promise<SkillExecutionResult>((resolve) => {
            resolveAdapter = resolve;
          });
        },
      };
      harness.registry.register(adapter);

      const pending = harness.runner.runNode(runnable(node));
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(25);

      expect(useRunStore.getState().nodeDebug.a.idleSince).toBeDefined();
      expect(useRunLogStore.getState().events).toContainEqual({
        nodeId: "a",
        event: expect.objectContaining({
          type: "status",
          status: "idle for 25ms",
        }),
      });

      resolveAdapter({
        status: "success",
        logs: [],
        startedAt: "2026-05-09T00:00:00.000Z",
        finishedAt: "2026-05-09T00:00:00.030Z",
      });
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("missing node id is reported as RunResult.ok=false", async () => {
    const harness = makeHarness({ nodes: [] });
    const ghost: RunnableNode = {
      id: "ghost",
      label: "ghost",
      skillRef: { provider: "claude", skillFile: SKILL_PATH },
    };

    const result = await harness.runner.runNode(ghost);

    expect(result).toEqual({
      ok: false,
      status: "failed",
      reason: "node ghost not found in workflow",
    });
    const log = useRunLogStore.getState();
    expect(log.events).toEqual([
      {
        nodeId: "ghost",
        event: expect.objectContaining({
          type: "error",
          message: "node ghost not found in workflow",
        }),
      },
    ]);
    expect(log.nodeResults.ghost.status).toBe("failed");
  });

  it("records no-repository failures in the run log", async () => {
    const node = workflowNode("a");
    const harness = makeHarness({ nodes: [node], repository: null });

    const result = await harness.runner.runNode(runnable(node));

    expect(result).toEqual({
      ok: false,
      status: "failed",
      reason: "no repository selected",
    });
    const log = useRunLogStore.getState();
    expect(log.events).toEqual([
      {
        nodeId: "a",
        event: expect.objectContaining({
          type: "error",
          message: "no repository selected",
        }),
      },
    ]);
    expect(log.nodeResults.a.status).toBe("failed");
  });
});
