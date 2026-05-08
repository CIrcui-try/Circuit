import { beforeEach, describe, expect, it } from "vitest";
import type { HostBridge, WorkspaceDTO } from "../host/bridge";
import { AdapterRegistry } from "../runtime/adapters/AdapterRegistry";
import { FakeAgentAdapter } from "../runtime/adapters/FakeAgentAdapter";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import type { WorkflowSkillNode } from "../workflow/schema";
import { RealWorkflowRunner } from "./RealWorkflowRunner";
import { useRunLogStore } from "./runLogStore";
import { runWorkflow } from "./runWorkflow";
import type { RunnableEdge, RunnableNode } from "./runner";
import { useRunStore } from "./runStore";

const REPO = { id: "repo-1", name: "circuit", path: "/repos/circuit" };
const WS_PATH = "/var/circuit/workspaces/default/circuit-0";

const SKILL_PATH = ".claude/skills/example/SKILL.md";
const SKILL_CONTENT =
  "---\nname: example-skill\ndescription: example\n---\n\n# example\n";

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

function runnable(node: WorkflowSkillNode): RunnableNode {
  return {
    id: node.id,
    label: node.label,
    skillRef: { provider: "claude", skillFile: node.skillRef.skillFile },
  };
}

interface FakeHostCalls {
  acquire: { userId: string; repoUrl: string }[];
  beginTurn: { workspaceId: string; turnIndex: number }[];
  commitTurn: string[];
  releaseToPool: string[];
  cleanupWorkspace: string[];
}

interface FakeHostOptions {
  acquireResult?: WorkspaceDTO;
  acquireError?: string;
  beginTurnError?: string;
  commitTurnError?: string;
  releaseError?: string;
}

function createFakeHost(opts: FakeHostOptions = {}): {
  host: HostBridge;
  calls: FakeHostCalls;
} {
  const calls: FakeHostCalls = {
    acquire: [],
    beginTurn: [],
    commitTurn: [],
    releaseToPool: [],
    cleanupWorkspace: [],
  };
  const acquireResult: WorkspaceDTO = opts.acquireResult ?? {
    id: "default__circuit__0",
    path: WS_PATH,
    branch: "main",
    headCommit: "deadbeef",
    userId: "default",
    repoUrl: `file://${REPO.path}`,
  };

  const host: HostBridge = {
    // unrelated host methods left undefined — runner only needs the workspace
    // surface for these tests.
    openRepositoryDialog: async () => null,
    scanSkills: async () => [],
    loadRepositories: async () => null,
    saveRepositories: async () => {},
    listWorkflows: async () => [],
    loadWorkflow: async () => "",
    saveWorkflow: async () => {},

    async acquireWorkspace(userId, repoUrl) {
      calls.acquire.push({ userId, repoUrl });
      if (opts.acquireError) throw new Error(opts.acquireError);
      return acquireResult;
    },
    async beginTurn(workspaceId, turnIndex) {
      calls.beginTurn.push({ workspaceId, turnIndex });
      if (opts.beginTurnError) throw new Error(opts.beginTurnError);
    },
    async commitTurn(workspaceId) {
      calls.commitTurn.push(workspaceId);
      if (opts.commitTurnError) throw new Error(opts.commitTurnError);
    },
    async releaseToPool(workspaceId) {
      calls.releaseToPool.push(workspaceId);
      if (opts.releaseError) throw new Error(opts.releaseError);
    },
    async cleanupWorkspace(workspaceId) {
      calls.cleanupWorkspace.push(workspaceId);
    },
    async prewarm() {},
  };
  return { host, calls };
}

beforeEach(() => {
  useRunLogStore.getState().reset();
  useRunStore.getState().reset();
});

describe("RealWorkflowRunner workspace integration (CIR-35)", () => {
  it("acquires + begin_turn on the first node, rewrites cwd to ws.path", async () => {
    const node = workflowNode("a");
    const bridge = createMockRuntimeBridge({
      files: { [`${WS_PATH}/${SKILL_PATH}`]: SKILL_CONTENT },
    });
    const registry = new AdapterRegistry();
    const adapter = new FakeAgentAdapter({
      provider: "claude",
      result: { status: "success" },
    });
    registry.register(adapter);

    const { host, calls } = createFakeHost();
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: (id) => (id === "a" ? node : null),
      getRepository: () => REPO,
      getRunMeta: () => ({ runId: "run_1", workflowId: "wf" }),
    });

    const result = await runner.runNode(runnable(node));
    expect(result).toEqual({ ok: true });

    expect(calls.acquire).toEqual([
      { userId: "default", repoUrl: `file://${REPO.path}` },
    ]);
    expect(calls.beginTurn).toEqual([
      { workspaceId: "default__circuit__0", turnIndex: 1 },
    ]);
    // adapter saw the workspace path as cwd, not the original repo path
    expect(adapter.seenContexts).toHaveLength(1);
    expect(adapter.seenContexts[0].execution.cwd).toBe(WS_PATH);
    expect(adapter.seenContexts[0].repository.path).toBe(WS_PATH);
    // id/name preserved
    expect(adapter.seenContexts[0].repository.id).toBe(REPO.id);
    expect(adapter.seenContexts[0].repository.name).toBe(REPO.name);
  });

  it("does not re-acquire on subsequent nodes within the same run", async () => {
    const a = workflowNode("a");
    const b = workflowNode("b");
    const bridge = createMockRuntimeBridge({
      files: { [`${WS_PATH}/${SKILL_PATH}`]: SKILL_CONTENT },
    });
    const registry = new AdapterRegistry();
    registry.register(
      new FakeAgentAdapter({
        provider: "claude",
        result: { status: "success" },
      }),
    );

    const { host, calls } = createFakeHost();
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: (id) => (id === "a" ? a : id === "b" ? b : null),
      getRepository: () => REPO,
      getRunMeta: () => ({ runId: "run_1", workflowId: "wf" }),
    });

    await runner.runNode(runnable(a));
    await runner.runNode(runnable(b));

    expect(calls.acquire).toHaveLength(1);
    expect(calls.beginTurn).toHaveLength(1);
  });

  it("endRun(success) commits + releases to pool", async () => {
    const node = workflowNode("a");
    const bridge = createMockRuntimeBridge({
      files: { [`${WS_PATH}/${SKILL_PATH}`]: SKILL_CONTENT },
    });
    const registry = new AdapterRegistry();
    registry.register(
      new FakeAgentAdapter({
        provider: "claude",
        result: { status: "success" },
      }),
    );

    const { host, calls } = createFakeHost();
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: () => node,
      getRepository: () => REPO,
      getRunMeta: () => ({ runId: "run_1", workflowId: "wf" }),
    });

    await runner.runNode(runnable(node));
    await runner.endRun("success");

    expect(calls.commitTurn).toEqual(["default__circuit__0"]);
    expect(calls.releaseToPool).toEqual(["default__circuit__0"]);
    expect(calls.cleanupWorkspace).toEqual([]);
  });

  it("endRun(failed) commits then cleans up instead of releasing", async () => {
    const node = workflowNode("a");
    const bridge = createMockRuntimeBridge({
      files: { [`${WS_PATH}/${SKILL_PATH}`]: SKILL_CONTENT },
    });
    const registry = new AdapterRegistry();
    registry.register(
      new FakeAgentAdapter({
        provider: "claude",
        result: { status: "failed", exitCode: 1 },
      }),
    );

    const { host, calls } = createFakeHost();
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: () => node,
      getRepository: () => REPO,
      getRunMeta: () => ({ runId: "run_1", workflowId: "wf" }),
    });

    await runner.runNode(runnable(node));
    await runner.endRun("failed");

    expect(calls.commitTurn).toEqual(["default__circuit__0"]);
    expect(calls.releaseToPool).toEqual([]);
    expect(calls.cleanupWorkspace).toEqual(["default__circuit__0"]);
  });

  it("acquire failure surfaces as RunResult ok=false", async () => {
    const node = workflowNode("a");
    const bridge = createMockRuntimeBridge({});
    const registry = new AdapterRegistry();

    const { host } = createFakeHost({
      acquireError: "workspace already attached",
    });
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: () => node,
      getRepository: () => REPO,
      getRunMeta: () => ({ runId: "run_1", workflowId: "wf" }),
    });

    const result = await runner.runNode(runnable(node));
    expect(result).toEqual({
      ok: false,
      reason: "workspace already attached",
    });
  });

  it("runWorkflow integration: end-to-end one run threads acquire→begin→commit→release", async () => {
    const node = workflowNode("a");
    const bridge = createMockRuntimeBridge({
      files: { [`${WS_PATH}/${SKILL_PATH}`]: SKILL_CONTENT },
    });
    const registry = new AdapterRegistry();
    registry.register(
      new FakeAgentAdapter({
        provider: "claude",
        result: { status: "success" },
      }),
    );

    const { host, calls } = createFakeHost();
    const runner = new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
      getNode: () => node,
      getRepository: () => REPO,
      getRunMeta: () => {
        const s = useRunStore.getState();
        return { runId: s.runId ?? "run_1", workflowId: s.workflowId };
      },
    });

    const nodes: RunnableNode[] = [runnable(node)];
    const edges: RunnableEdge[] = [];
    const outcome = await runWorkflow({
      nodes,
      edges,
      workflowId: "wf",
      runner,
      store: useRunStore,
    });

    expect(outcome).toEqual({ kind: "started", status: "success" });
    expect(calls.acquire).toHaveLength(1);
    expect(calls.beginTurn).toHaveLength(1);
    expect(calls.commitTurn).toEqual(["default__circuit__0"]);
    expect(calls.releaseToPool).toEqual(["default__circuit__0"]);
  });
});
