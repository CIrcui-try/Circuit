import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { Sidebar } from "../components/layout/Sidebar";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useWorkflowStore } from "../stores/workflowStore";
import type { WorkflowSummaryDTO } from "../host/bridge";
import { listForRepo, loadById, saveCurrent } from "../workflow/workflowService";

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

  const [workflows, setWorkflows] = useState<WorkflowSummaryDTO[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    selectRepository(repoId ?? null);
  }, [repoId, selectRepository]);

  useEffect(() => {
    resetWorkflow();
    setWorkflows([]);
    setSaveStatus(null);
  }, [repoId, resetWorkflow]);

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
        <button type="button" disabled>Start Circuit</button>
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
    </div>
  );
}
