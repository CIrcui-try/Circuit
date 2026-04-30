import { open } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore, type Skill } from "../stores/skillStore";

export function RepositoryList() {
  const repositories = useRepositoryStore((s) => s.repositories);
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const addRepository = useRepositoryStore((s) => s.addRepository);
  const byRepo = useSkillStore((s) => s.byRepo);
  const loading = useSkillStore((s) => s.loading);
  const scanRepository = useSkillStore((s) => s.scanRepository);

  useEffect(() => {
    if (!hydrated) return;
    for (const repo of repositories) {
      if (!byRepo[repo.id] && !loading[repo.id]) {
        scanRepository(repo.id, repo.path);
      }
    }
  }, [hydrated, repositories, byRepo, loading, scanRepository]);

  async function handleAdd() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      const added = await addRepository(selected);
      if (added) {
        scanRepository(added.id, added.path);
      }
    }
  }

  return (
    <div className="repository-list">
      <h1 className="repository-list__heading">Repositories</h1>
      <div style={{ marginBottom: 24 }}>
        <button type="button" onClick={handleAdd}>Add Repository</button>
      </div>

      {repositories.length === 0 ? (
        <p className="repository-list__hint">
          No repositories yet. Click <strong>Add Repository</strong> to choose a local folder.
        </p>
      ) : (
        <ul className="repository-list__items">
          {repositories.map((repo) => {
            const skills = byRepo[repo.id];
            const isLoading = loading[repo.id];
            return (
              <li key={repo.id}>
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
              </li>
            );
          })}
        </ul>
      )}
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
