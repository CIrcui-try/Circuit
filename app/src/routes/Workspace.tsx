import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { notifyAppError } from "../components/AppErrorAlert";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { ResizeHandle } from "../components/layout/ResizeHandle";
import { Sidebar } from "../components/layout/Sidebar";
import { createDefaultRegistry } from "../runtime/adapters/createDefaultRegistry";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { getHostBridge, type WorkflowSummaryDTO } from "../host/bridge";
import { serializeRunLogJsonl } from "../runner/runLogPersistence";
import { listForRepo, loadById, saveCurrent } from "../workflow/workflowService";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";
import { RealWorkflowRunner } from "../runner/RealWorkflowRunner";
import { useRunLogStore } from "../runner/runLogStore";
import { useRunStore } from "../runner/runStore";
import { runWorkflow, type RunWorkflowOutcome } from "../runner/runWorkflow";
import type { RunnableEdge, RunnableNode } from "../runner/runner";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";
import type { WorkflowSkillNode } from "../workflow/schema";

const NEW_WORKFLOW_VALUE = "__new__";

export function Workspace() {
  const { repoId } = useParams<{ repoId?: string }>();
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const repo = useRepositoryStore((s) =>
    repoId ? s.repositories.find((r) => r.id === repoId) ?? null : null,
  );
  const selectRepository = useRepositoryStore((s) => s.selectRepository);
  const scanRepository = useSkillStore((s) => s.scanRepository);
  const resetWorkflow = useWorkflowStore((s) => s.resetWorkflow);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const isRunning = useRunStore((s) => s.status === "running");
  const resetRun = useRunStore((s) => s.reset);
  const resetRunLog = useRunLogStore((s) => s.reset);

  const [workflows, setWorkflows] = useState<WorkflowSummaryDTO[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const runner = useMemo(() => {
    if (!repo) return null;
    const bridge = getRuntimeBridge();
    const registry = createDefaultRegistry({ bridge });
    return new RealWorkflowRunner({
      registry,
      bridge,
      logStore: useRunLogStore,
      runStore: useRunStore,
      getNode: (id) => {
        const n = useWorkflowStore.getState().nodes.find((x) => x.id === id);
        if (!n) return null;
        const fullNode: WorkflowSkillNode = {
          id: n.id,
          type: "skill",
          skillRef: n.data.skillRef,
          label: n.data.label,
          position: { x: n.position.x, y: n.position.y },
          input: (n.data.input as Record<string, unknown> | undefined) ?? {},
        };
        return fullNode;
      },
      getRepository: () => {
        const r = useRepositoryStore
          .getState()
          .repositories.find((x) => x.id === repo.id);
        return r ? { id: r.id, name: r.name, path: r.path } : null;
      },
      getRunMeta: () => {
        const s = useRunStore.getState();
        return { runId: s.runId ?? "(idle)", workflowId: s.workflowId };
      },
      persistRunLog: async ({
        runId,
        workflowId,
        repository,
        events,
        nodeResults,
      }) => {
        if (!workflowId) return;
        const host = getHostBridge();
        if (!host.saveRunLog) return;
        const jsonl = serializeRunLogJsonl(events, nodeResults);
        await host.saveRunLog(repository.path, workflowId, runId, jsonl);
      },
    });
  }, [repo]);

  useEffect(() => {
    selectRepository(repoId ?? null);
  }, [repoId, selectRepository]);

  useEffect(() => {
    resetWorkflow();
    resetRun();
    resetRunLog();
    setWorkflows([]);
    setSaveStatus(null);
    if (!repo) return;
    const draft = loadWorkflowDraft(repo.id);
    if (!draft) return;
    useWorkflowStore.getState().replaceCanvas({
      nodes: draft.nodes,
      edges: draft.edges,
      workflowId: draft.workflowId,
      workflowName: draft.workflowName,
    });
  }, [repoId, repo, resetWorkflow, resetRun, resetRunLog]);

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
    setSaveStatus("Saving…");
    try {
      const result = await saveCurrent({
        repoPath: repo.path,
        repositoryId: repo.id,
      });
      setSaveStatus(`Saved ${result.name}`);
      await refreshWorkflows();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveStatus(`Save failed: ${message}`);
    }
  }, [repo, refreshWorkflows]);

  const handleStart = useCallback(async () => {
    if (!runner) return;
    runner.reset();
    const { nodes, edges, currentWorkflowId } = useWorkflowStore.getState();
    const runnable: RunnableNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      skillRef: {
        provider: n.data.skillRef.provider,
        skillFile: n.data.skillRef.skillFile,
      },
    }));
    const runnableEdges: RunnableEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
    try {
      const outcome = await runWorkflow({
        nodes: runnable,
        edges: runnableEdges,
        workflowId: currentWorkflowId,
        runner,
        store: useRunStore,
      });
      if (outcome.kind === "rejected") {
        notifyAppError(formatRunRejection(outcome.reason), "Start Circuit failed");
        return;
      }
      if (outcome.status === "failed" || outcome.status === "timeout") {
        notifyAppError(
          describeLastRunFailure() ?? "Workflow failed. Check the run log for details.",
          "Start Circuit failed",
        );
      }
    } catch (err) {
      notifyAppError(err, "Start Circuit failed");
    }
  }, [runner]);

  const handleCancel = useCallback(() => {
    if (!runner) return;
    setCancelling(true);
    void runner.cancel();
  }, [runner]);

  useEffect(() => {
    if (!isRunning) setCancelling(false);
  }, [isRunning]);

  const handleSelectWorkflow = useCallback(
    async (value: string) => {
      if (!repo) return;
      if (value === NEW_WORKFLOW_VALUE) {
        resetWorkflow();
        setSaveStatus(null);
        return;
      }
      try {
        await loadById({ repoPath: repo.path, workflowId: value });
        setSaveStatus(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveStatus(`Load failed: ${message}`);
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
    <div className="workspace" data-testid="workspace-root">
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
        <button
          type="button"
          data-testid="workflow-cancel"
          onClick={handleCancel}
          disabled={!isRunning || cancelling}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
        {saveStatus ? (
          <span className="workspace__toolbar-status" data-testid="workflow-save-status">
            {saveStatus}
          </span>
        ) : null}
      </header>
      <Sidebar repoId={repo?.id} />
      <Canvas />
      <PropertiesPanel />
      <LogPanel />
      <ResizeHandle direction="sidebar" />
      <ResizeHandle direction="props" />
      <ResizeHandle direction="log" />
    </div>
  );
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
