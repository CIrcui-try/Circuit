import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "./runStore";

beforeEach(() => {
  useRunStore.getState().reset();
});

describe("runStore", () => {
  it("RS1: beginRun seeds every node as queued and switches status to running", () => {
    useRunStore.getState().beginRun({
      runId: "run_1",
      workflowId: "wf_1",
      nodeIds: ["n1", "n2"],
      startedAt: "2026-04-30T00:00:00Z",
    });
    const s = useRunStore.getState();
    expect(s.status).toBe("running");
    expect(s.runId).toBe("run_1");
    expect(s.workflowId).toBe("wf_1");
    expect(s.startedAt).toBe("2026-04-30T00:00:00Z");
    expect(s.activeNodeId).toBeNull();
    expect(s.nodeStates).toEqual({ n1: "queued", n2: "queued" });
    expect(s.nodeDebug).toEqual({});
  });

  it("RS2: setNodeState transitions only the targeted node", () => {
    useRunStore.getState().beginRun({
      runId: "r",
      workflowId: null,
      nodeIds: ["n1", "n2"],
      startedAt: "t",
    });
    useRunStore.getState().setNodeState("n1", "running");
    expect(useRunStore.getState().nodeStates).toEqual({
      n1: "running",
      n2: "queued",
    });
    useRunStore.getState().setNodeState("n1", "success");
    expect(useRunStore.getState().nodeStates.n1).toBe("success");
    expect(useRunStore.getState().nodeStates.n2).toBe("queued");
    useRunStore.getState().setNodeState("n2", "waiting_input");
    expect(useRunStore.getState().nodeStates.n2).toBe("waiting_input");
  });

  it("RS3: tracks active node and debug metadata", () => {
    useRunStore.getState().beginRun({
      runId: "r",
      workflowId: null,
      nodeIds: ["n1"],
      startedAt: "t",
    });

    useRunStore.getState().setActiveNode("n1");
    useRunStore.getState().patchNodeDebug("n1", {
      adapter: "codex",
      adapterRunId: "r::n1",
      command: "codex",
      args: ["exec", "prompt"],
      spawnType: "process",
      lastLogAt: "t1",
      idleTimeoutMs: 30_000,
    });
    useRunStore.getState().patchNodeDebug("n1", { exitCode: 0 });

    const s = useRunStore.getState();
    expect(s.activeNodeId).toBe("n1");
    expect(s.nodeDebug.n1).toMatchObject({
      adapter: "codex",
      adapterRunId: "r::n1",
      command: "codex",
      args: ["exec", "prompt"],
      spawnType: "process",
      lastLogAt: "t1",
      idleTimeoutMs: 30_000,
      exitCode: 0,
    });
  });

  it("RS4: finishRun updates the top-level status and clears active node", () => {
    useRunStore.getState().beginRun({
      runId: "r",
      workflowId: null,
      nodeIds: ["n1"],
      startedAt: "t",
    });
    useRunStore.getState().setActiveNode("n1");
    useRunStore.getState().setNodeState("n1", "success");
    useRunStore.getState().finishRun("success");
    const s = useRunStore.getState();
    expect(s.status).toBe("success");
    expect(s.activeNodeId).toBeNull();
    expect(s.nodeStates.n1).toBe("success");
  });

  it("RS5: reset returns the store to idle with no node states", () => {
    useRunStore.getState().beginRun({
      runId: "r",
      workflowId: "wf",
      nodeIds: ["n1"],
      startedAt: "t",
    });
    useRunStore.getState().setActiveNode("n1");
    useRunStore.getState().patchNodeDebug("n1", { adapter: "claude" });
    useRunStore.getState().reset();
    const s = useRunStore.getState();
    expect(s.status).toBe("idle");
    expect(s.runId).toBeNull();
    expect(s.workflowId).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.activeNodeId).toBeNull();
    expect(s.nodeStates).toEqual({});
    expect(s.nodeDebug).toEqual({});
  });
});
