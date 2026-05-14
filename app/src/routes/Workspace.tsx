import { useCallback, useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  ChevronsRight,
  Ellipsis,
  FolderOpen,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import claudeAppIcon from "../assets/claude-app-icon.png";
import codexAppIcon from "../assets/codex-app-icon.png";
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
import { getHostBridge } from "../host/bridge";
import {
  isTutorialRepositoryPath,
  tutorialResultPath,
} from "../tutorial";
import { fromWorkflow } from "../workflow/serialize";
import { createCodexStarterWorkflow } from "../workflow/starterFlow";
import { listForRepo, loadById, saveCurrent } from "../workflow/workflowService";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";
import { consumeStarterFlowPrompt } from "../workflow/starterFlowPrompt";
import { useRunLogStore } from "../runner/runLogStore";
import { useRunStore } from "../runner/runStore";
import { analyzeWorkflowGraph, topoSort } from "../runner/topoSort";
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
  const continueOnFailure = useWorkflowStore((s) => s.continueOnFailure);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const setContinueOnFailure = useWorkflowStore((s) => s.setContinueOnFailure);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const runRecord = useRunStore((s) =>
    repo?.id ? s.getRunForRepository(repo.id) : s,
  );
  const logRecord = useRunLogStore((s) =>
    repo?.id ? s.getLogForRepository(repo.id) : s,
  );
  const runStatus = runRecord.status;
  const isRunningHere = runStatus === "running";
  const runId = runRecord.runId;
  const acknowledgeRun = useRunStore((s) => s.acknowledgeRun);
  const lastRunSnapshot = runRecord.snapshot;
  const lastRunNodeStates = runRecord.nodeStates;
  const lastRunNodeResults = logRecord.nodeResults;
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useLayoutStore((s) => s.setSidebarCollapsed);
  const propsCollapsed = useLayoutStore((s) => s.propsCollapsed);
  const setPropsCollapsed = useLayoutStore((s) => s.setPropsCollapsed);
  const logCollapsed = useLayoutStore((s) => s.logCollapsed);
  const setLogCollapsed = useLayoutStore((s) => s.setLogCollapsed);
  const activeRunSnapshot =
    runRecord.status === "running" ? runRecord.snapshot : null;

  const [workflows, setWorkflows] = useState<WorkflowSummaryDTO[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [starterGoal, setStarterGoal] = useState("");
  const [showStarterFlowPrompt, setShowStarterFlowPrompt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const consumedStarterPromptRepoIds = useRef(new Set<string>());
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
    if (!repo?.id || !runId) return;
    if (runStatus !== "success") return;
    acknowledgeRun(runId, repo.id);
  }, [acknowledgeRun, repo?.id, runId, runStatus]);

  useEffect(() => {
    resetWorkflow();
    setWorkflows([]);
    setShowStarterFlowPrompt(false);
    if (!repo) return;
    if (isRunningHere && activeRunSnapshot) {
      useWorkflowStore.getState().replaceCanvas({
        nodes: activeRunSnapshot.nodes.map(toCanvasNode),
        edges: activeRunSnapshot.edges.map((edge) => ({ ...edge })),
        workflowId: activeRunSnapshot.workflowId,
        workflowName: activeRunSnapshot.workflowName,
        continueOnFailure: activeRunSnapshot.continueOnFailure,
      });
      return;
    }
    const draft = loadWorkflowDraft(repo.id);
    if (!draft) {
      const shouldShowStarterPrompt =
        consumedStarterPromptRepoIds.current.has(repo.id) ||
        consumeStarterFlowPrompt(repo.id);
      if (shouldShowStarterPrompt) {
        consumedStarterPromptRepoIds.current.add(repo.id);
      }
      setShowStarterFlowPrompt(shouldShowStarterPrompt);
      return;
    }
    useWorkflowStore.getState().replaceCanvas({
      nodes: draft.nodes,
      edges: draft.edges,
      workflowId: draft.workflowId,
      workflowName: draft.workflowName,
      continueOnFailure: draft.continueOnFailure,
    });
  }, [repoId, repo, resetWorkflow]);

  useEffect(() => {
    if (!repo) return;
    return useWorkflowStore.subscribe((state) => {
      saveWorkflowDraft(repo.id, {
        workflowId: state.currentWorkflowId,
        workflowName: state.workflowName,
        continueOnFailure: state.continueOnFailure,
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

  const handleOpenRepository = useCallback(async (
    errorTitle: string,
    appName?: string,
  ) => {
    if (!repo) return;
    try {
      if (appName) {
        await openPath(repo.path, appName);
      } else {
        await openPath(repo.path);
      }
    } catch (err) {
      notifyAppError(err, errorTitle);
    }
  }, [repo]);

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
        continueOnFailure: snapshot.continueOnFailure,
      });
      if (outcome.kind === "rejected") {
        notifyAppError(
          outcome.message ?? formatRunRejection(outcome.reason),
          options.errorTitle ?? "Start Circuit failed",
        );
        return;
      }
      if (outcome.status === "failed" || outcome.status === "timeout") {
        notifyAppError(
          describeLastRunFailure(snapshot.repository.id) ??
            "Workflow failed. Check the run log for details.",
          options.errorTitle ?? "Start Circuit failed",
        );
      }
      if (outcome.status === "success") {
        void openTutorialResult(snapshot.repository.path);
      }
    } catch (err) {
      notifyAppError(err, options.errorTitle ?? "Start Circuit failed");
    }
  }, [setLogCollapsed]);

  const handleStart = useCallback(async () => {
    if (!repo) return;
    const snapshot = buildRunSnapshot(repo);
    const graph = analyzeWorkflowGraph(
      snapshot.nodes.map((node) => node.id),
      snapshot.edges,
    );
    if (!graph.valid) {
      notifyAppError(
        formatRunRejection("invalid-graph"),
        "Start Circuit failed",
      );
      return;
    }
    if (graph.hasCycle) {
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
      continueOnFailure: restored.meta.continueOnFailure,
    });
    consumedStarterPromptRepoIds.current.delete(repo.id);
    setShowStarterFlowPrompt(false);
  }, [repo, starterGoal]);

  const handleCancel = useCallback(() => {
    if (!isRunningHere) return;
    setCancelling(true);
    void cancelWorkflowRun(repo?.id);
  }, [isRunningHere, repo?.id]);

  useEffect(() => {
    if (!isRunningHere) setCancelling(false);
  }, [isRunningHere]);

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
        <span className="workspace__repository-label">
          {repo ? repo.name : "No repository selected"}
        </span>
        <div className="workspace__settings">
          <button
            type="button"
            data-testid="workflow-settings"
            className="workspace__settings-trigger"
            aria-label="Repository settings"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
            disabled={!repo}
          >
            <Ellipsis size={17} strokeWidth={2} aria-hidden="true" />
          </button>
          {settingsOpen && repo ? (
            <div
              className="workspace__settings-menu"
              role="menu"
              data-testid="workflow-settings-menu"
            >
              <div className="workspace__settings-section">
                <button
                  type="button"
                  className="workspace__settings-action"
                  role="menuitem"
                  data-testid="show-repository-in-finder"
                  onClick={() => {
                    setSettingsOpen(false);
                    void handleOpenRepository("Show repository in Finder failed");
                  }}
                >
                  <FolderOpen
                    className="workspace__settings-item-icon"
                    size={15}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  Show in Finder
                </button>
                <button
                  type="button"
                  className="workspace__settings-action"
                  role="menuitem"
                  onClick={() => {
                    setSettingsOpen(false);
                    void handleOpenRepository("Open Codex app failed", "Codex");
                  }}
                >
                  <img
                    className="workspace__settings-app-icon"
                    src={codexAppIcon}
                    alt=""
                    aria-hidden="true"
                  />
                  Open Codex app
                </button>
                <button
                  type="button"
                  className="workspace__settings-action"
                  role="menuitem"
                  onClick={() => {
                    setSettingsOpen(false);
                    void handleOpenRepository("Open Claude app failed", "Claude");
                  }}
                >
                  <img
                    className="workspace__settings-app-icon"
                    src={claudeAppIcon}
                    alt=""
                    aria-hidden="true"
                  />
                  Open Claude app
                </button>
              </div>
              <div className="workspace__settings-section">
                <button
                  type="button"
                  className="workspace__settings-option workspace__settings-switch"
                  role="switch"
                  aria-checked={continueOnFailure}
                  onClick={() => setContinueOnFailure(!continueOnFailure)}
                >
                  <ChevronsRight
                    className="workspace__settings-item-icon"
                    size={15}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span>Continue on failure</span>
                  <span
                    className="workspace__settings-switch-track"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          ) : null}
        </div>
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
          disabled={!repo || isRunningHere || nodeCount === 0}
        >
          {isRunningHere ? (
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
            disabled={isRunningHere}
          >
            Rerun from failed
          </button>
        ) : null}
        <button
          type="button"
          data-testid="workflow-cancel"
          onClick={handleCancel}
          disabled={!isRunningHere || cancelling}
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
              Run workflow loop
            </h2>
            <p className="modal__message">
              This workflow contains a loop and will repeat until it fails,
              is cancelled, or a skill stops the loop.
            </p>
            <p className="modal__message">Start repeated execution?</p>
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
      {repo && nodeCount === 0 && showStarterFlowPrompt ? (
        <section className="starter-flow-empty" data-testid="starter-flow-empty">
          <button
            type="button"
            className="starter-flow-empty__dismiss"
            data-testid="starter-flow-dismiss"
            aria-label="Dismiss starter flow prompt"
            onClick={() => {
              consumedStarterPromptRepoIds.current.delete(repo.id);
              setShowStarterFlowPrompt(false);
            }}
          >
            ×
          </button>
          <h2 className="starter-flow-empty__title">Add starter flow</h2>
          <p className="starter-flow-empty__copy">
            This flow will run against <strong>{repo.name}</strong> at{" "}
            <code>{repo.path}</code>.
          </p>
          <label className="starter-flow-empty__field">
            <span>What would you like to build?</span>
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
            Add Starter Flow
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

async function openTutorialResult(repoPath: string): Promise<void> {
  if (!isTutorialRepositoryPath(repoPath)) return;

  const htmlPath = tutorialResultPath(repoPath);
  try {
    const htmlExists = await getHostBridge().pathExists?.(htmlPath);
    if (!htmlExists) return;
    await openPath(htmlPath);
  } catch (err) {
    notifyAppError(err, "Open tutorial result failed");
  }
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
    case "invalid-graph":
      return "Workflow graph must have exactly one root. Connect every node into one entry flow before starting Circuit.";
    case "repository-preflight":
      return "Repository environment is not ready.";
    default:
      return reason;
  }
}

function buildRunSnapshot(repo: {
  id: string;
  name: string;
  path: string;
}): WorkflowRunSnapshot {
  const { nodes, edges, currentWorkflowId, continueOnFailure } =
    useWorkflowStore.getState();
  return {
    repository: { id: repo.id, name: repo.name, path: repo.path },
    workflowId: currentWorkflowId,
    workflowName: useWorkflowStore.getState().workflowName,
    continueOnFailure,
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

function describeLastRunFailure(repositoryId: string): string | null {
  const { nodeResults, events } =
    useRunLogStore.getState().getLogForRepository(repositoryId);
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
