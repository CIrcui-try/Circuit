import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { Sidebar } from "../components/layout/Sidebar";
import { useRepositoryStore } from "../stores/repositoryStore";

export function Workspace() {
  const { repoId } = useParams<{ repoId?: string }>();
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const repo = useRepositoryStore((s) =>
    repoId ? s.repositories.find((r) => r.id === repoId) ?? null : null,
  );
  const selectRepository = useRepositoryStore((s) => s.selectRepository);

  useEffect(() => {
    selectRepository(repoId ?? null);
  }, [repoId, selectRepository]);

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
    <div className="workspace">
      <header className="workspace__toolbar">
        <Link to="/" aria-label="Back to repository list">←</Link>
        <span className="workspace__toolbar-title">Circuit</span>
        <span style={{ color: "#8a8a92" }}>
          {repo ? `Repository: ${repo.name}` : "No repository selected"}
        </span>
        <span className="workspace__toolbar-spacer" />
        <button type="button" disabled>Workflow ▾</button>
        <button type="button" disabled>Save</button>
        <button type="button" disabled>Start Circuit</button>
      </header>
      <Sidebar />
      <Canvas />
      <PropertiesPanel />
      <LogPanel />
    </div>
  );
}
