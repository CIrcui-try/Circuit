import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { ResizeHandle } from "../components/layout/ResizeHandle";
import { Sidebar } from "../components/layout/Sidebar";
import {
  RunPreviewModal,
  type RunPreviewNode,
} from "../components/run/RunPreviewModal";
import { detectSensitiveAction } from "../runtime/safety/sensitiveAction";
import {
  DEFAULT_PROVIDER_ALLOWLIST,
  createDefaultRegistry,
} from "../runtime/adapters/createDefaultRegistry";
import { DEFAULT_TIMEOUT_MS } from "../runtime/context/buildSkillExecutionContext";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { getHostBridge, type WorkflowSummaryDTO } from "../host/bridge";
import { serializeRunLogJsonl } from "../runner/runLogPersistence";
import { listForRepo, loadById, saveCurrent } from "../workflow/workflowService";
import { RealWorkflowRunner } from "../runner/RealWorkflowRunner";
import { useRunLogStore } from "../runner/runLogStore";
import { useRunStore } from "../runner/runStore";
import { runWorkflow } from "../runner/runWorkflow";
import type { RunnableEdge, RunnableNode } from "../runner/runner";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNodes, setPreviewNodes] = useState<RunPreviewNode[]>([]);
  const [cancelling, setCancelling] = useState(false);

  const runner = useMemo(() => {
    if (!repo) return null;
    const bridge = getRuntimeBridge();
    const host = getHostBridge();
    const registry = createDefaultRegistry({ bridge });
    return new RealWorkflowRunner({
      registry,
      bridge,
      host,
      logStore: useRunLogStore,
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
  }, [repoId, resetWorkflow, resetRun, resetRunLog]);

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

  const handleStart = useCallback(() => {
    if (!runner || !repo) return;
    const { nodes } = useWorkflowStore.getState();
    const skillsForRepo = useSkillStore.getState().byRepo[repo.id] ?? [];
    const skillByFile = new Map(skillsForRepo.map((s) => [s.skillFile, s]));

    const previewItems: RunPreviewNode[] = nodes.map((n) => {
      const skill = skillByFile.get(n.data.skillRef.skillFile) ?? null;
      const promptValue =
        typeof n.data.input === "object" && n.data.input !== null
          ? (n.data.input as Record<string, unknown>).prompt
          : undefined;
      const timeoutValue =
        typeof n.data.input === "object" && n.data.input !== null
          ? (n.data.input as Record<string, unknown>).timeoutMs
          : undefined;
      const sensitive = detectSensitiveAction({
        skillName: skill?.name ?? n.data.label,
        prompt: typeof promptValue === "string" ? promptValue : undefined,
      });
      const provider = n.data.skillRef.provider;
      return {
        id: n.id,
        label: n.data.label,
        provider,
        skillFile: n.data.skillRef.skillFile,
        commandSummary: `${provider}: ${n.data.skillRef.skillFile}`,
        timeoutMs:
          typeof timeoutValue === "number" && Number.isFinite(timeoutValue)
            ? timeoutValue
            : DEFAULT_TIMEOUT_MS,
        sensitiveKeywords: sensitive.keywords,
      };
    });

    setPreviewNodes(previewItems);
    setPreviewOpen(true);
  }, [runner, repo]);

  const handleConfirmStart = useCallback(async () => {
    setPreviewOpen(false);
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
    await runWorkflow({
      nodes: runnable,
      edges: runnableEdges,
      workflowId: currentWorkflowId,
      runner,
      store: useRunStore,
    });
  }, [runner]);

  const handlePreviewCancel = useCallback(() => {
    setPreviewOpen(false);
  }, []);

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
          onClick={handleStart}
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
      <RunPreviewModal
        open={previewOpen}
        workflowName={workflowName}
        repoPath={repo?.path ?? ""}
        nodes={previewNodes}
        allowedProviders={DEFAULT_PROVIDER_ALLOWLIST}
        onConfirm={() => void handleConfirmStart()}
        onCancel={handlePreviewCancel}
      />
    </div>
  );
}
