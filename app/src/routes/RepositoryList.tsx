import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { notifyAppError } from "../components/AppErrorAlert";
import { CliStatusPanel } from "../components/CliStatusPanel";
import { getHostBridge } from "../host/bridge";
import { useRunStore } from "../runner/runStore";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore, type Skill } from "../stores/skillStore";
import {
  TUTORIAL_STARTER_PROMPT,
  TUTORIAL_REPOSITORY_NAME,
} from "../tutorial";
import { fromWorkflow } from "../workflow/serialize";
import { createCodexStarterWorkflow } from "../workflow/starterFlow";
import { saveWorkflowDraft } from "../workflow/workflowDraft";

export function RepositoryList() {
  const navigate = useNavigate();
  const repositories = useRepositoryStore((s) => s.repositories);
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const addRepository = useRepositoryStore((s) => s.addRepository);
  const removeRepository = useRepositoryStore((s) => s.removeRepository);
  const byRepo = useSkillStore((s) => s.byRepo);
  const loading = useSkillStore((s) => s.loading);
  const scanRepository = useSkillStore((s) => s.scanRepository);
  const runStatus = useRunStore((s) => s.status);
  const runRepositoryId = useRunStore((s) => s.repositoryId);
  const runRepositoryName = useRunStore((s) => s.repositoryName);
  const runWorkflowName = useRunStore((s) => s.workflowName);
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    for (const repo of repositories) {
      scanRepository(repo.id, repo.path);
    }
  }, [hydrated, repositories, scanRepository]);

  async function handleAdd() {
    const selected = await getHostBridge().openRepositoryDialog();
    if (selected) {
      const added = await addRepository(selected);
      if (added) {
        scanRepository(added.id, added.path);
      }
    }
  }

  async function handleTryTutorial() {
    try {
      const bridge = getHostBridge();
      if (!bridge.createTutorialRepository) {
        throw new Error("tutorial repository creation is not available");
      }
      const path = normalizePath(await bridge.createTutorialRepository());
      const existing = useRepositoryStore
        .getState()
        .repositories.find((repo) => normalizePath(repo.path) === path);
      const repo = existing ?? (await addRepository(path));
      if (!repo) {
        throw new Error("failed to register tutorial repository");
      }

      const workflow = createCodexStarterWorkflow({
        repositoryId: repo.id,
        initialRequest: TUTORIAL_STARTER_PROMPT,
      });
      const restored = fromWorkflow(workflow);
      saveWorkflowDraft(repo.id, {
        workflowId: restored.meta.id,
        workflowName: restored.meta.name,
        nodes: restored.nodes,
        edges: restored.edges,
      });
      scanRepository(repo.id, repo.path);
      navigate(`/workspace/${repo.id}`);
    } catch (err) {
      notifyAppError(err, "Start tutorial failed");
    }
  }

  function handleRefreshAll() {
    for (const repo of repositories) {
      scanRepository(repo.id, repo.path);
    }
  }

  function handleRemove(id: string, name: string) {
    setPendingRemoval({ id, name });
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    const { id } = pendingRemoval;
    setPendingRemoval(null);
    try {
      await removeRepository(id);
    } catch (err) {
      notifyAppError(err, "Remove repository failed");
    }
  }

  return (
    <div className="repository-list">
      <CliStatusPanel />
      <h1 className="repository-list__heading">Repositories</h1>
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleAdd}
          data-testid="add-repository-button"
        >
          Add Repository
        </button>
        <button
          type="button"
          onClick={() => void handleTryTutorial()}
          data-testid="try-tutorial-button"
        >
          Try Tutorial
        </button>
        {repositories.length > 0 && (
          <button type="button" onClick={handleRefreshAll}>Refresh</button>
        )}
      </div>
      {runStatus === "running" && runRepositoryId ? (
        <Link
          to={`/workspace/${runRepositoryId}`}
          className="repository-list__run-summary"
          data-testid="repository-run-summary"
        >
          <span className="repository-list__run-summary-label">Running</span>
          <span>
            {runRepositoryName ?? "Repository"}
            {runWorkflowName ? ` · ${runWorkflowName}` : ""}
          </span>
        </Link>
      ) : null}

      {repositories.length === 0 ? (
        <p className="repository-list__hint">
          No repositories yet. Click <strong>Add Repository</strong> to choose a local folder,
          or try the safe <strong>{TUTORIAL_REPOSITORY_NAME}</strong>.
        </p>
      ) : (
        <ul className="repository-list__items" data-testid="repository-list">
          {repositories.map((repo) => {
            const skills = byRepo[repo.id];
            const isLoading = loading[repo.id];
            const isRunRepo = runStatus === "running" && runRepositoryId === repo.id;
            return (
              <li key={repo.id} className="repository-list__row">
                <Link to={`/workspace/${repo.id}`} className="repository-list__item">
                  <span className="repository-list__item-name">{repo.name}</span>
                  <span className="repository-list__item-path">{repo.path}</span>
                  <span className="repository-list__badges">
                    <SkillBadge
                      provider="claude"
                      skills={skills}
                      loading={isLoading}
                    />
                    <SkillBadge
                      provider="codex"
                      skills={skills}
                      loading={isLoading}
                    />
                    {isRunRepo ? (
                      <span
                        className="repository-list__badge repository-list__badge--running"
                        data-testid="badge-running"
                      >
                        Running{runWorkflowName ? ` · ${runWorkflowName}` : ""}
                      </span>
                    ) : null}
                  </span>
                </Link>
                <button
                  type="button"
                  className="repository-list__remove"
                  onClick={() => handleRemove(repo.id, repo.name)}
                  aria-label={`Remove ${repo.name}`}
                  title="Remove from list"
                >
                  ×
                </button>
              </li>
            );
          })}
          <li className="repository-list__add-row">
            <button
              type="button"
              className="repository-list__add-button"
              onClick={handleAdd}
              aria-label="Add Repository"
              title="Add Repository"
              data-testid="repository-list-add-button"
            >
              +
            </button>
          </li>
        </ul>
      )}

      {pendingRemoval ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel modal__panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-repository-title"
          >
            <h2 id="remove-repository-title" className="modal__title">
              Remove repository?
            </h2>
            <p className="modal__message">
              Remove "{pendingRemoval.name}" from the list? The folder on disk is not deleted.
            </p>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setPendingRemoval(null)}
                data-testid="remove-repository-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoval()}
                data-testid="remove-repository-confirm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function SkillBadge({
  provider,
  skills,
  loading,
}: {
  provider: "claude" | "codex";
  skills: Skill[] | undefined;
  loading: boolean | undefined;
}) {
  const label = provider === "claude" ? "Claude" : "Codex";
  if (skills === undefined) {
    return (
      <span
        className={`repository-list__badge repository-list__badge--${provider}`}
        data-testid={`badge-${provider}`}
      >
        {label} · {loading ? "…" : "—"}
      </span>
    );
  }
  const count = skills.filter((s) => s.provider === provider).length;
  return (
    <span
      className={`repository-list__badge repository-list__badge--${provider}`}
      data-testid={`badge-${provider}`}
    >
      {label} · {count}
    </span>
  );
}
