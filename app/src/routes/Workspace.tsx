import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { notifyAppError } from "../components/AppErrorAlert";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { ResizeHandle } from "../components/layout/ResizeHandle";
import { Sidebar } from "../components/layout/Sidebar";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkflowStore, type SkillNode } from "../stores/workflowStore";
import type { WorkflowSummaryDTO } from "../host/bridge";
import { fromWorkflow } from "../workflow/serialize";
import { createCodexStarterWorkflow } from "../workflow/starterFlow";
import { listForRepo, loadById, saveCurrent } from "../workflow/workflowService";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";
import { useRunLogStore } from "../runner/runLogStore";
import { useRunStore } from "../runner/runStore";
import { topoSort } from "../runner/topoSort";
import {
  cancelWorkflowRun,
  startWorkflowRun,
} from "../runner/runController";
import type { WorkflowRunSnapshot } from "../runner/runStore";
import type { RunWorkflowOutcome } from "../runner/runWorkflow";
import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";

const NEW_WORKFLOW_VALUE = "__new__";

export function Workspace() {
  const { repoId } = useParams<{ repoId?: string }>();
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const repo = useRepositoryStore((s) =>
    repoId ? s.repositories.find((r) => r.id === repoId) ?? null : null,
  );
  const selectRepository = useRepositoryStore((s) => s.selectRepository);
  const scanRepository = useSkillStore((s) => s.scanRepository);
  const scanDefaultCatalog = useSkillStore((s) => s.scanDefaultCatalog);
  const resetWorkflow = useWorkflowStore((s) => s.resetWorkflow);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const runStatus = useRunStore((s) => s.status);
  const isRunning = runStatus === "running";
  const runRepositoryId = useRunStore((s) => s.repositoryId);
  const lastRunSnapshot = useRunStore((s) => s.snapshot);
  const lastRunNodeStates = useRunStore((s) => s.nodeStates);
  const lastRunNodeResults = useRunLogStore((s) => s.nodeResults);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useLayoutStore((s) => s.setSidebarCollapsed);
  const propsCollapsed = useLayoutStore((s) => s.propsCollapsed);
  const setPropsCollapsed = useLayoutStore((s) => s.setPropsCollapsed);
  const logCollapsed = useLayoutStore((s) => s.logCollapsed);
  const setLogCollapsed = useLayoutStore((s) => s.setLogCollapsed);
  const activeRunSnapshot = useRunStore((s) =>
    s.status === "running" ? s.snapshot : null,
  );
  const isRunningHere = Boolean(
    isRunning && repo?.id && runRepositoryId === repo.id,
  );

  const [workflows, setWorkflows] = useState<WorkflowSummaryDTO[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [starterGoal, setStarterGoal] = useState("");
  const [pendingCycleRun, setPendingCycleRun] =
    useState<WorkflowRunSnapshot | null>(null);

  const rerunCandidate = buildRerunCandidate({
    repoId: repo?.id,
    status: runStatus,
    snapshot: lastRunSnapshot,
    nodeStates: lastRunNodeStates,
    nodeResults: lastRunNodeResults,
  });

  useEffect(() => {
    selectRepository(repoId ?? null);
  }, [repoId, selectRepository]);

  useEffect(() => {
    resetWorkflow();
    setWorkflows([]);
    if (!repo) return;
    if (isRunningHere && activeRunSnapshot) {
      useWorkflowStore.getState().replaceCanvas({
        nodes: activeRunSnapshot.nodes.map(toCanvasNode),
        edges: activeRunSnapshot.edges.map((edge) => ({ ...edge })),
        workflowId: activeRunSnapshot.workflowId,
        workflowName: activeRunSnapshot.workflowName,
      });
      return;
    }
    const draft = loadWorkflowDraft(repo.id);
    if (!draft) return;
    useWorkflowStore.getState().replaceCanvas({
      nodes: draft.nodes,
      edges: draft.edges,
      workflowId: draft.workflowId,
      workflowName: draft.workflowName,
    });
  }, [repoId, repo, resetWorkflow]);

  useEffect(() => {
    if (!repo) return;
    return useWorkflowStore.subscribe((state) => {
      saveWorkflowDraft(repo.id, {
        workflowId: state.currentWorkflowId,
        workflowName: state.workflowName,
        nodes: state.nodes,
        edges: state.edges,
      });
    });
  }, [repo]);

  useEffect(() => {
    if (repo) {
      scanRepository(repo.id, repo.path);
    }
  }, [repo, scanRepository]);

  useEffect(() => {
    if (repo) {
      void scanDefaultCatalog();
    }
  }, [repo, scanDefaultCatalog]);

  const refreshWorkflows = useCallback(async () => {
    if (!repo) return;
    const list = await listForRepo(repo.path);
    setWorkflows(list);
  }, [repo]);

  useEffect(() => {
    if (repo) {
      void refreshWorkflows();
    }
  }, [repo, refreshWorkflows]);

  const handleSave = useCallback(async () => {
    if (!repo) return;
    try {
      await saveCurrent({
        repoPath: repo.path,
        repositoryId: repo.id,
      });
      await refreshWorkflows();
    } catch (err) {
      notifyAppError(err, "Save workflow failed");
    }
  }, [repo, refreshWorkflows]);

  const startSnapshot = useCallback(async (
    snapshot: WorkflowRunSnapshot,
    options: StartSnapshotOptions = {},
  ) => {
    setLogCollapsed(false);
    try {
      const outcome = await startWorkflowRun({
        snapshot,
        allowCycles: options.allowCycles,
        startFromNodeId: options.startFromNodeId,
        seedPreviousOutputs: options.seedPreviousOutputs,
      });
      if (outcome.kind === "rejected") {
        notifyAppError(
          formatRunRejection(outcome.reason),
          options.errorTitle ?? "Start Circuit failed",
        );
        return;
      }
      if (outcome.status === "failed" || outcome.status === "timeout") {
        notifyAppError(
          describeLastRunFailure() ?? "Workflow failed. Check the run log for details.",
          options.errorTitle ?? "Start Circuit failed",
        );
      }
    } catch (err) {
      notifyAppError(err, options.errorTitle ?? "Start Circuit failed");
    }
  }, [setLogCollapsed]);

  const handleStart = useCallback(async () => {
    if (!repo) return;
    const snapshot = buildRunSnapshot(repo);
    const hasCycle = topoSort(
      snapshot.nodes.map((node) => node.id),
      snapshot.edges,
    ).cycle;
    if (hasCycle) {
      setPendingCycleRun(snapshot);
      return;
    }
    void startSnapshot(snapshot);
  }, [repo, startSnapshot]);

  const handleAddStarterFlow = useCallback(() => {
    if (!repo) return;
    const initialRequest = starterGoal.trim();
    const workflow = createCodexStarterWorkflow({
      repositoryId: repo.id,
      initialRequest,
    });
    const restored = fromWorkflow(workflow);
    useWorkflowStore.getState().replaceCanvas({
      nodes: restored.nodes,
      edges: restored.edges,
      workflowId: restored.meta.id,
      workflowName: restored.meta.name,
    });
  }, [repo, starterGoal]);

  const handleCancel = useCallback(() => {
    setCancelling(true);
    void cancelWorkflowRun();
  }, []);

  useEffect(() => {
    if (!isRunning) setCancelling(false);
  }, [isRunning]);

  const handleSelectWorkflow = useCallback(
    async (value: string) => {
      if (!repo) return;
      if (value === NEW_WORKFLOW_VALUE) {
        resetWorkflow();
        return;
      }
      try {
        await loadById({ repoPath: repo.path, workflowId: value });
      } catch (err) {
        notifyAppError(err, "Load workflow failed");
      }
    },
    [repo, resetWorkflow],
  );

  if (repoId && hydrated && !repo) {
    return (
      <div className="repository-list">
        <h1 className="repository-list__heading">Repository not found</h1>
        <p className="repository-list__hint">
          The repository <code>{repoId}</code> is not registered.
        </p>
        <Link to="/">
          <button type="button">Back to repositories</button>
        </Link>
      </div>
    );
  }

  return (
    <div
      className={[
        "workspace",
        sidebarCollapsed ? "workspace--sidebar-collapsed" : "",
        propsCollapsed ? "workspace--props-collapsed" : "",
        logCollapsed ? "workspace--log-collapsed" : "",
      ].filter(Boolean).join(" ")}
      data-testid="workspace-root"
    >
      <header className="workspace__toolbar">
        <Link to="/" aria-label="Back to repository list">←</Link>
        <span className="workspace__toolbar-title">Circuit</span>
        <span style={{ color: "#8a8a92" }}>
          {repo ? `Repository: ${repo.name}` : "No repository selected"}
        </span>
        <span className="workspace__toolbar-spacer" />
        <input
          type="text"
          aria-label="Workflow name"
          data-testid="workflow-name-input"
          className="workspace__toolbar-input"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          disabled={!repo}
        />
        <select
          aria-label="Workflow"
          data-testid="workflow-menu"
          value={currentWorkflowId ?? NEW_WORKFLOW_VALUE}
          onChange={(e) => void handleSelectWorkflow(e.target.value)}
          disabled={!repo}
        >
          <option value={NEW_WORKFLOW_VALUE}>New workflow</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name || "(untitled)"}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="workflow-save"
          onClick={() => void handleSave()}
          disabled={!repo}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="workflow-start"
          className="workspace__toolbar-start"
          onClick={() => void handleStart()}
          disabled={!repo || isRunning || nodeCount === 0}
        >
          {isRunning ? (
            <>
              <span
                className="cli-status-spinner cli-status-spinner--inline"
                aria-hidden="true"
                role="presentation"
              />
              Running…
            </>
          ) : (
            "Start Circuit"
          )}
        </button>
        {rerunCandidate ? (
          <button
            type="button"
            data-testid="workflow-rerun-from-failed"
            onClick={() => {
              void startSnapshot(rerunCandidate.snapshot, {
                startFromNodeId: rerunCandidate.startFromNodeId,
                seedPreviousOutputs: rerunCandidate.seedPreviousOutputs,
                errorTitle: "Rerun from failed failed",
              });
            }}
            disabled={isRunning}
          >
            Rerun from failed
          </button>
        ) : null}
        <button
          type="button"
          data-testid="workflow-cancel"
          onClick={handleCancel}
          disabled={!isRunning || cancelling}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </header>
      {pendingCycleRun ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel modal__panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cycle-run-title"
            data-testid="cycle-run-confirm"
          >
            <h2 id="cycle-run-title" className="modal__title">
              Workflow loop warning
            </h2>
            <p className="modal__message">
              This workflow contains a loop and may run indefinitely.
            </p>
            <p className="modal__message">Do you want to continue?</p>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setPendingCycleRun(null)}
                data-testid="cycle-run-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => {
                  const snapshot = pendingCycleRun;
                  setPendingCycleRun(null);
                  void startSnapshot(snapshot, { allowCycles: true });
                }}
                data-testid="cycle-run-confirm-proceed"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sidebarCollapsed ? (
        <button
          type="button"
          className="workspace__sidebar-restore"
          data-testid="skills-sidebar-restore"
          aria-label="Show skills sidebar"
          onClick={() => setSidebarCollapsed(false)}
        >
          Skills
        </button>
      ) : (
        <Sidebar
          repoId={repo?.id}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}
      <Canvas />
      {repo && nodeCount === 0 ? (
        <section className="starter-flow-empty" data-testid="starter-flow-empty">
          <div className="starter-flow-empty__eyebrow">First workflow</div>
          <h2 className="starter-flow-empty__title">Build your first Circuit</h2>
          <p className="starter-flow-empty__copy">
            This workspace runs against <strong>{repo.name}</strong> at{" "}
            <code>{repo.path}</code>.
          </p>
          <ol className="starter-flow-empty__steps">
            <li>
              Repository skills are scanned from{" "}
              <code>.claude/skills/*/SKILL.md</code> and{" "}
              <code>.codex/skills/*/SKILL.md</code>.
            </li>
            <li>Add one Claude skill and one Codex skill from the Skills panel.</li>
            <li>Connect the nodes with a dependency edge on the canvas.</li>
            <li>Name and save the workflow, then run it with <strong>Start Circuit</strong>.</li>
            <li>Inspect status and output in <strong>Run Log</strong>.</li>
          </ol>
          <label className="starter-flow-empty__field">
            <span>Optional starter request</span>
            <input
              value={starterGoal}
              data-testid="starter-flow-goal-input"
              placeholder="Example: add a theme toggle to settings"
              onChange={(event) => setStarterGoal(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="starter-flow-empty__action"
            data-testid="starter-flow-add"
            onClick={handleAddStarterFlow}
          >
            Add mixed starter flow
          </button>
        </section>
      ) : null}
      {propsCollapsed ? (
        <button
          type="button"
          className="workspace__props-restore"
          data-testid="properties-panel-restore"
          aria-label="Show properties panel"
          onClick={() => setPropsCollapsed(false)}
        >
          Properties
        </button>
      ) : (
        <PropertiesPanel onCollapse={() => setPropsCollapsed(true)} />
      )}
      {logCollapsed ? (
        <button
          type="button"
          className="workspace__log-restore"
          data-testid="run-log-restore"
          aria-label="Show run log"
          onClick={() => setLogCollapsed(false)}
        >
          Run Log
        </button>
      ) : (
        <LogPanel onCollapse={() => setLogCollapsed(true)} />
      )}
      {sidebarCollapsed ? null : <ResizeHandle direction="sidebar" />}
      {propsCollapsed ? null : <ResizeHandle direction="props" />}
      {logCollapsed ? null : <ResizeHandle direction="log" />}
    </div>
  );
}

type StartSnapshotOptions = {
  allowCycles?: boolean;
  startFromNodeId?: string;
  seedPreviousOutputs?: Record<string, SkillExecutionResult>;
  errorTitle?: string;
};

type RerunCandidate = {
  snapshot: WorkflowRunSnapshot;
  startFromNodeId: string;
  seedPreviousOutputs: Record<string, SkillExecutionResult>;
};

function buildRerunCandidate({
  repoId,
  status,
  snapshot,
  nodeStates,
  nodeResults,
}: {
  repoId?: string;
  status: ReturnType<typeof useRunStore.getState>["status"];
  snapshot: WorkflowRunSnapshot | null;
  nodeStates: ReturnType<typeof useRunStore.getState>["nodeStates"];
  nodeResults: ReturnType<typeof useRunLogStore.getState>["nodeResults"];
}): RerunCandidate | null {
  if (!repoId || !snapshot || snapshot.repository.id !== repoId) return null;
  if (status !== "failed" && status !== "timeout" && status !== "cancelled") {
    return null;
  }
  const sorted = topoSort(
    snapshot.nodes.map((node) => node.id),
    snapshot.edges,
  );
  const runOrder = sorted.cycle
    ? snapshot.nodes.map((node) => node.id)
    : sorted.order;
  const failedNodeId = runOrder.find((id) =>
    isRerunnableNodeState(nodeStates[id]),
  );
  if (!failedNodeId) return null;

  const seedPreviousOutputs: Record<string, SkillExecutionResult> = {};
  for (const id of runOrder) {
    const result = nodeResults[id];
    if (!result) continue;
    seedPreviousOutputs[id] = result;
    if (id === failedNodeId) break;
  }

  return {
    snapshot,
    startFromNodeId: failedNodeId,
    seedPreviousOutputs,
  };
}

function isRerunnableNodeState(
  state: ReturnType<typeof useRunStore.getState>["nodeStates"][string],
): boolean {
  return state === "failed" || state === "timeout" || state === "cancelled";
}

function formatRunRejection(
  reason: Extract<RunWorkflowOutcome, { kind: "rejected" }>["reason"],
): string {
  switch (reason) {
    case "already-running":
      return "A workflow is already running.";
    case "empty":
      return "Add at least one skill before starting Circuit.";
    case "cycle":
      return "The workflow has a cycle. Remove the loop and try again.";
    default:
      return reason;
  }
}

function buildRunSnapshot(repo: {
  id: string;
  name: string;
  path: string;
}): WorkflowRunSnapshot {
  const { nodes, edges, currentWorkflowId } = useWorkflowStore.getState();
  return {
    repository: { id: repo.id, name: repo.name, path: repo.path },
    workflowId: currentWorkflowId,
    workflowName: useWorkflowStore.getState().workflowName,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: "skill",
      skillRef: {
        source: n.data.skillRef.source ?? "repository",
        provider: n.data.skillRef.provider,
        ...(n.data.skillRef.source === "system"
          ? { systemSkillId: n.data.skillRef.systemSkillId }
          : { skillFile: n.data.skillRef.skillFile }),
      },
      label: n.data.label,
      position: { x: n.position.x, y: n.position.y },
      input: (n.data.input as Record<string, unknown> | undefined) ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: "dependency",
    })),
  };
}

function toCanvasNode(node: WorkflowRunSnapshot["nodes"][number]): SkillNode {
  return {
    id: node.id,
    type: "skill" as const,
    position: { ...node.position },
    data: {
      label: node.label,
      skillRef: {
        source: node.skillRef.source ?? "repository",
        provider: node.skillRef.provider as SkillNode["data"]["skillRef"]["provider"],
        skillFile: node.skillRef.skillFile ?? "",
        ...(node.skillRef.source === "system"
          ? { systemSkillId: node.skillRef.systemSkillId }
          : {}),
      },
      ...(node.input !== undefined ? { input: node.input } : {}),
    },
  };
}

function describeLastRunFailure(): string | null {
  const { nodeResults, events } = useRunLogStore.getState();
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    if (result.status === "success") continue;
    return describeNodeFailure(nodeId, result);
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i].event;
    if (event.type === "error" && event.message.trim()) {
      return event.message;
    }
  }
  return null;
}

function describeNodeFailure(
  nodeId: string,
  result: SkillExecutionResult,
): string {
  for (let i = result.logs.length - 1; i >= 0; i -= 1) {
    const event = result.logs[i];
    if (event.type === "error" && event.message.trim()) {
      return `${nodeId}: ${event.message}`;
    }
  }
  if (result.summary) return `${nodeId}: ${result.summary}`;
  if (result.exitCode != null) {
    return `${nodeId}: ${result.status} (exit ${result.exitCode})`;
  }
  return `${nodeId}: ${result.status}`;
}
