import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "./mockRunner";
import type { RunnableEdge, RunnableNode, WorkflowRunner } from "./runner";
import { useRunStore } from "./runStore";
import { runWorkflow } from "./runWorkflow";

const node = (id: string, label = id): RunnableNode => ({
  id,
  label,
  skillRef: { provider: "claude", skillFile: `.claude/skills/${id}/SKILL.md` },
});

const edge = (id: string, source: string, target: string): RunnableEdge => ({
  id,
  source,
  target,
});

beforeEach(() => {
  useRunStore.getState().reset();
});

describe("runWorkflow", () => {
  it("RW1: runs every node in topo order and ends with status=success", async () => {
    const order: string[] = [];
    const runner: WorkflowRunner = {
      async runNode(n) {
        order.push(n.id);
        return { ok: true };
      },
    };

    const outcome = await runWorkflow({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    expect(outcome).toEqual({ kind: "started", status: "success" });
    expect(order).toEqual(["a", "b", "c"]);
    const s = useRunStore.getState();
    expect(s.status).toBe("success");
    expect(s.nodeStates).toEqual({ a: "success", b: "success", c: "success" });
  });

  it("RW2: failure marks the offending node failed and remaining nodes skipped", async () => {
    const runner = createMockRunner({
      shouldFail: (n) => n.id === "b",
    });

    const outcome = await runWorkflow({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
      workflowId: null,
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    expect(outcome).toEqual({ kind: "started", status: "failed" });
    const s = useRunStore.getState();
    expect(s.status).toBe("failed");
    expect(s.nodeStates).toEqual({
      a: "success",
      b: "failed",
      c: "skipped",
    });
  });

  it("RW3: refuses to start while another run is in progress", async () => {
    useRunStore.setState({
      status: "running",
      runId: "earlier",
      workflowId: "wf",
      startedAt: "t",
      nodeStates: { x: "running" },
    });

    const runner: WorkflowRunner = {
      runNode: vi.fn(async () => ({ ok: true as const })),
    };

    const outcome = await runWorkflow({
      nodes: [node("a")],
      edges: [],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_2",
    });

    expect(outcome).toEqual({ kind: "rejected", reason: "already-running" });
    expect(runner.runNode).not.toHaveBeenCalled();
    expect(useRunStore.getState().runId).toBe("earlier");
  });

  it("RW4: a cycle marks every node skipped and finishes failed without invoking the runner", async () => {
    const runner: WorkflowRunner = {
      runNode: vi.fn(async () => ({ ok: true as const })),
    };

    const outcome = await runWorkflow({
      nodes: [node("a"), node("b")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "a")],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    expect(outcome).toEqual({ kind: "rejected", reason: "cycle" });
    expect(runner.runNode).not.toHaveBeenCalled();
    const s = useRunStore.getState();
    expect(s.status).toBe("failed");
    expect(s.nodeStates).toEqual({ a: "skipped", b: "skipped" });
  });

  it("RW5: empty workflow is rejected without mutating store status", async () => {
    const runner: WorkflowRunner = {
      runNode: vi.fn(async () => ({ ok: true as const })),
    };

    const outcome = await runWorkflow({
      nodes: [],
      edges: [],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    expect(outcome).toEqual({ kind: "rejected", reason: "empty" });
    expect(runner.runNode).not.toHaveBeenCalled();
    expect(useRunStore.getState().status).toBe("idle");
  });

  it("RW6: thrown runner errors are treated as failure of that node", async () => {
    const runner: WorkflowRunner = {
      async runNode(n) {
        if (n.id === "b") throw new Error("boom");
        return { ok: true };
      },
    };

    await runWorkflow({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    const s = useRunStore.getState();
    expect(s.status).toBe("failed");
    expect(s.nodeStates).toEqual({
      a: "success",
      b: "failed",
      c: "skipped",
    });
  });

  it("RW7: cancelled runner result marks node and app status cancelled", async () => {
    const runner: WorkflowRunner = {
      async runNode() {
        return { ok: false, status: "cancelled", reason: "cancelled" };
      },
    };

    const outcome = await runWorkflow({
      nodes: [node("a"), node("b")],
      edges: [edge("e1", "a", "b")],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    expect(outcome).toEqual({ kind: "started", status: "cancelled" });
    const s = useRunStore.getState();
    expect(s.status).toBe("cancelled");
    expect(s.nodeStates).toEqual({ a: "cancelled", b: "skipped" });
  });

  it("RW8: timeout runner result marks node and app status timeout", async () => {
    const runner: WorkflowRunner = {
      async runNode() {
        return { ok: false, status: "timeout", reason: "timeout" };
      },
    };

    await runWorkflow({
      nodes: [node("a")],
      edges: [],
      workflowId: "wf",
      runner,
      store: useRunStore,
      now: () => "t",
      newRunId: () => "run_1",
    });

    const s = useRunStore.getState();
    expect(s.status).toBe("timeout");
    expect(s.nodeStates).toEqual({ a: "timeout" });
  });
});
