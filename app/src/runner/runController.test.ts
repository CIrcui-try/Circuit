import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import type { WorkflowRunSnapshot } from "./runController";
import { cancelWorkflowRun, startWorkflowRun } from "./runController";
import type { RunResult } from "./runner";
import { useRunStore } from "./runStore";

function snapshot(): WorkflowRunSnapshot {
  return {
    repository: { id: "repo-1", name: "repo", path: "/Users/me/repo" },
    workflowId: "wf-1",
    workflowName: "Release flow",
    nodes: [
      {
        id: "a",
        type: "skill",
        skillRef: { provider: "claude", skillFile: ".claude/skills/a/SKILL.md" },
        label: "A",
        position: { x: 0, y: 0 },
        input: {
          prompt: "original",
          timeoutMs: 5000,
          env: { DEBUG: true },
        },
      },
      {
        id: "b",
        type: "skill",
        skillRef: { provider: "claude", skillFile: ".claude/skills/b/SKILL.md" },
        label: "B",
        position: { x: 10, y: 10 },
        input: { prompt: "second" },
      },
    ],
    edges: [{ id: "e1", source: "a", target: "b", kind: "dependency" }],
  };
}

beforeEach(() => {
  useRunStore.getState().reset();
});

describe("runController", () => {
  it("RC1: runs against the start-time snapshot even if the source workflow mutates", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: {
      id: string;
      label: string;
      input: Record<string, unknown> | undefined;
    }[] = [];
    const source = snapshot();

    const run = startWorkflowRun({
      snapshot: source,
      bridge: createMockRuntimeBridge(),
      now: () => "2026-01-01T00:00:00.000Z",
      newRunId: () => "run-1",
      createRunner: ({ getNode }) => ({
        async runNode(node): Promise<RunResult> {
          const full = getNode(node.id);
          seen.push({
            id: node.id,
            label: full?.label ?? "",
            input: full?.input,
          });
          if (node.id === "a") await blocker;
          return { ok: true };
        },
      }),
    });

    source.nodes.reverse();
    source.nodes[1].label = "mutated";
    source.nodes[1].input = { prompt: "mutated" };
    source.edges.length = 0;

    release();
    await expect(run).resolves.toEqual({ kind: "started", status: "success" });
    expect(seen).toEqual([
      {
        id: "a",
        label: "A",
        input: {
          prompt: "original",
          timeoutMs: 5000,
          env: { DEBUG: true },
        },
      },
      { id: "b", label: "B", input: { prompt: "second" } },
    ]);
  });

  it("RC2: rejects a duplicate start without replacing the active runner", async () => {
    useRunStore.setState({
      status: "running",
      runId: "run-1",
      workflowId: "wf-1",
      startedAt: "t",
      activeNodeId: "a",
      nodeStates: { a: "running" },
      nodeDebug: {},
    });
    const createRunner = vi.fn();

    const outcome = await startWorkflowRun({
      snapshot: snapshot(),
      bridge: createMockRuntimeBridge(),
      createRunner,
    });

    expect(outcome).toEqual({ kind: "rejected", reason: "already-running" });
    expect(createRunner).not.toHaveBeenCalled();
  });

  it("RC3: cancel targets the active controller-owned runner", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancel = vi.fn(async () => {});

    const run = startWorkflowRun({
      snapshot: snapshot(),
      bridge: createMockRuntimeBridge(),
      createRunner: () => ({
        cancel,
        async runNode(): Promise<RunResult> {
          await blocker;
          return { ok: true };
        },
      }),
    });

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("running");
    });
    await expect(cancelWorkflowRun()).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    release();
    await run;
  });

  it("RC4: clears the active runner after a terminal run", async () => {
    await expect(
      startWorkflowRun({
        snapshot: snapshot(),
        bridge: createMockRuntimeBridge(),
        createRunner: () => ({
          async runNode(): Promise<RunResult> {
            return { ok: true };
          },
        }),
      }),
    ).resolves.toEqual({ kind: "started", status: "success" });

    await expect(cancelWorkflowRun()).resolves.toBe(false);
  });

  it("allows system skill nodes to reach the workflow runner", async () => {
    const source = snapshot();
    source.nodes = [
      {
        id: "starter_boarding",
        type: "skill",
        skillRef: {
          source: "system",
          provider: "codex",
          systemSkillId: "codex:starter/boarding",
        },
        label: "boarding",
        position: { x: 0, y: 0 },
        input: { arguments: "CIR-63" },
      },
    ];
    source.edges = [];
    const seen: string[] = [];

    await expect(
      startWorkflowRun({
        snapshot: source,
        bridge: createMockRuntimeBridge(),
        createRunner: () => ({
          async runNode(node): Promise<RunResult> {
            seen.push(node.id);
            return { ok: true };
          },
        }),
      }),
    ).resolves.toEqual({ kind: "started", status: "success" });

    expect(seen).toEqual(["starter_boarding"]);
  });
});
