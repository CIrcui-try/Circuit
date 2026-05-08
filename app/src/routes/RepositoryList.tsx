import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notifyAppError } from "../components/AppErrorAlert";
import { CliStatusPanel } from "../components/CliStatusPanel";
import { getHostBridge } from "../host/bridge";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore, type Skill } from "../stores/skillStore";

export function RepositoryList() {
  const repositories = useRepositoryStore((s) => s.repositories);
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const addRepository = useRepositoryStore((s) => s.addRepository);
  const removeRepository = useRepositoryStore((s) => s.removeRepository);
  const byRepo = useSkillStore((s) => s.byRepo);
  const loading = useSkillStore((s) => s.loading);
  const scanRepository = useSkillStore((s) => s.scanRepository);
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
        {repositories.length > 0 && (
          <button type="button" onClick={handleRefreshAll}>Refresh</button>
        )}
      </div>

      {repositories.length === 0 ? (
        <p className="repository-list__hint">
          No repositories yet. Click <strong>Add Repository</strong> to choose a local folder.
        </p>
      ) : (
        <ul className="repository-list__items" data-testid="repository-list">
          {repositories.map((repo) => {
            const skills = byRepo[repo.id];
            const isLoading = loading[repo.id];
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
