import { beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../runtime/adapters/AdapterRegistry";
import { FakeAgentAdapter } from "../runtime/adapters/FakeAgentAdapter";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import type { AgentRunEvent } from "../runtime/contracts/SkillExecution";
import type { WorkflowSkillNode } from "../workflow/schema";
import { RealWorkflowRunner } from "./RealWorkflowRunner";
import { useRunLogStore } from "./runLogStore";
import { useRunStore } from "./runStore";
import { runWorkflow } from "./runWorkflow";
import type { RunnableEdge, RunnableNode } from "./runner";

const REPO = { id: "repo", name: "circuit", path: "/repos/circuit" };
const SKILL_PATH = ".claude/skills/example/SKILL.md";
const SKILL_ABS_PATH = `${REPO.path}/${SKILL_PATH}`;
const SKILL_CONTENT = "---\nname: example\n---\n\nhi\n";

function workflowNode(id: string): WorkflowSkillNode {
  return {
    id,
    type: "skill",
    skillRef: { provider: "claude", skillFile: SKILL_PATH },
    label: id,
    position: { x: 0, y: 0 },
    input: {},
  };
}

function runnableFrom(n: WorkflowSkillNode): RunnableNode {
  return {
    id: n.id,
    label: n.label,
    skillRef: { provider: "claude", skillFile: n.skillRef.skillFile },
  };
}

beforeEach(() => {
  useRunStore.getState().reset();
  useRunLogStore.getState().reset();
});

describe("RealWorkflowRunner + runWorkflow integration", () => {
  it("runs a 3-node chain in topo order, threads previousOutputs, and populates both stores", async () => {
    const a = workflowNode("a");
    const b = workflowNode("b");
    const c = workflowNode("c");
    const nodes = new Map([a, b, c].map((n) => [n.id, n]));

    const adapter = new FakeAgentAdapter({
      provider: "claude",
      events: [
        { type: "start", timestamp: "t0", message: "spawn" } as AgentRunEvent,
        { type: "finish", timestamp: "t1", exitCode: 0 } as AgentRunEvent,
      ],
      result: { status: "success", exitCode: 0 },
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const bridge = createMockRuntimeBridge({
      files: { [SKILL_ABS_PATH]: SKILL_CONTENT },
    });

    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      logStore: useRunLogStore,
      getNode: (id) => nodes.get(id) ?? null,
      getRepository: () => REPO,
      getRunMeta: () => {
        const s = useRunStore.getState();
        return { runId: s.runId ?? "", workflowId: s.workflowId };
      },
    });

    runner.reset();

    const runnableNodes: RunnableNode[] = [
      runnableFrom(a),
      runnableFrom(b),
      runnableFrom(c),
    ];
    const edges: RunnableEdge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];

    const outcome = await runWorkflow({
      nodes: runnableNodes,
      edges,
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_e2e",
    });

    expect(outcome).toEqual({ kind: "started", status: "success" });

    const runState = useRunStore.getState();
    expect(runState.status).toBe("success");
    expect(runState.nodeStates).toEqual({
      a: "success",
      b: "success",
      c: "success",
    });

    // Each node executed: 3 contexts seen.
    expect(adapter.seenContexts.map((c) => c.nodeId)).toEqual(["a", "b", "c"]);

    // previousOutputs grew across nodes.
    expect(adapter.seenContexts[0].previousOutputs).toEqual({});
    expect(Object.keys(adapter.seenContexts[1].previousOutputs)).toEqual(["a"]);
    expect(Object.keys(adapter.seenContexts[2].previousOutputs).sort()).toEqual([
      "a",
      "b",
    ]);

    // Log store has 3 nodes * 2 events each = 6 entries.
    const log = useRunLogStore.getState();
    expect(log.events).toHaveLength(6);
    expect(log.events.map((e) => e.nodeId)).toEqual([
      "a",
      "a",
      "b",
      "b",
      "c",
      "c",
    ]);
    expect(Object.keys(log.nodeResults).sort()).toEqual(["a", "b", "c"]);
  });

  it("stops the workflow on first failure and marks downstream nodes skipped", async () => {
    const a = workflowNode("a");
    const b = workflowNode("b");
    const c = workflowNode("c");
    const nodes = new Map([a, b, c].map((n) => [n.id, n]));

    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "failed", exitCode: 1 },
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const bridge = createMockRuntimeBridge({
      files: { [SKILL_ABS_PATH]: SKILL_CONTENT },
    });

    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      logStore: useRunLogStore,
      getNode: (id) => nodes.get(id) ?? null,
      getRepository: () => REPO,
      getRunMeta: () => {
        const s = useRunStore.getState();
        return { runId: s.runId ?? "", workflowId: s.workflowId };
      },
    });

    runner.reset();

    const outcome = await runWorkflow({
      nodes: [runnableFrom(a), runnableFrom(b), runnableFrom(c)],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_fail",
    });

    expect(outcome).toEqual({ kind: "started", status: "failed" });
    expect(useRunStore.getState().nodeStates).toEqual({
      a: "failed",
      b: "skipped",
      c: "skipped",
    });
    // Only the failing node was actually invoked.
    expect(adapter.seenContexts.map((c) => c.nodeId)).toEqual(["a"]);
  });
});
