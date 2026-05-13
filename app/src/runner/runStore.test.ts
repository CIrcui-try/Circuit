import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore, type WorkflowRunSnapshot } from "./runStore";

beforeEach(() => {
  useRunStore.getState().reset();
});

describe("runStore", () => {
  it("RS1: beginRun seeds every node as queued and switches status to running", () => {
    useRunStore.getState().beginRun({
      runId: "run_1",
      workflowId: "wf_1",
      workflowName: "Release flow",
      repository: { id: "repo_1", name: "alpha" },
      nodeIds: ["n1", "n2"],
      startedAt: "2026-04-30T00:00:00Z",
    });
    const s = useRunStore.getState();
    expect(s.status).toBe("running");
    expect(s.runMode).toBe("dag");
    expect(s.runId).toBe("run_1");
    expect(s.workflowId).toBe("wf_1");
    expect(s.workflowName).toBe("Release flow");
    expect(s.repositoryId).toBe("repo_1");
    expect(s.repositoryName).toBe("alpha");
    expect(s.startedAt).toBe("2026-04-30T00:00:00Z");
    expect(s.finishedAt).toBeNull();
    expect(s.activeNodeId).toBeNull();
    expect(s.nodeStates).toEqual({ n1: "queued", n2: "queued" });
    expect(s.nodeDebug).toEqual({});
  });

  it("RS1c: beginRun tracks cycle iteration metadata", () => {
    useRunStore.getState().beginRun({
      runId: "run_1",
      workflowId: "wf_1",
      nodeIds: ["n1"],
      startedAt: "2026-04-30T00:00:00Z",
      runMode: "cycle",
    });

    useRunStore.getState().setIteration(3);

    const s = useRunStore.getState();
    expect(s.runMode).toBe("cycle");
    expect(s.iteration).toBe(3);
  });

  it("RS1b: stores a cloned workflow snapshot for workspace re-entry", () => {
    const snapshot: WorkflowRunSnapshot = {
      repository: { id: "repo_1", name: "alpha", path: "/repo" },
      workflowId: "wf_1",
      workflowName: "Release flow",
      continueOnFailure: true,
      nodes: [
        {
          id: "n1",
          type: "skill",
          label: "Foo",
          skillRef: {
            provider: "claude",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
          position: { x: 1, y: 2 },
          input: { prompt: "go" },
        },
      ],
      edges: [],
    };

    useRunStore.getState().beginRun({
      runId: "run_1",
      workflowId: "wf_1",
      repository: { id: "repo_1", name: "alpha" },
      nodeIds: ["n1"],
      startedAt: "2026-04-30T00:00:00Z",
      snapshot,
    });
    snapshot.nodes[0].label = "Changed after begin";

    const s = useRunStore.getState();
    expect(s.snapshot?.workflowName).toBe("Release flow");
    expect(s.snapshot?.continueOnFailure).toBe(true);
    expect(s.snapshot?.nodes[0].label).toBe("Foo");
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
    expect(s.finishedAt).toBeTruthy();
    expect(s.activeNodeId).toBeNull();
    expect(s.nodeStates.n1).toBe("success");
  });

  it("RS4b: finishRun stores an explicit finishedAt timestamp", () => {
    useRunStore.getState().beginRun({
      runId: "r",
      workflowId: null,
      nodeIds: ["n1"],
      startedAt: "2026-05-09T00:00:00.000Z",
    });
    useRunStore.getState().finishRun("success", "2026-05-09T00:00:05.000Z");

    expect(useRunStore.getState().finishedAt).toBe(
      "2026-05-09T00:00:05.000Z",
    );
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
    expect(s.runMode).toBe("dag");
    expect(s.runId).toBeNull();
    expect(s.workflowId).toBeNull();
    expect(s.workflowName).toBeNull();
    expect(s.repositoryId).toBeNull();
    expect(s.repositoryName).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.finishedAt).toBeNull();
    expect(s.activeNodeId).toBeNull();
    expect(s.iteration).toBeNull();
    expect(s.nodeStates).toEqual({});
    expect(s.nodeDebug).toEqual({});
    expect(s.snapshot).toBeNull();
  });
});
