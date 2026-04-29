import { Link } from "react-router-dom";

export function RepositoryList() {
  return (
    <div className="repository-list">
      <h1 className="repository-list__heading">Repositories</h1>
      <p className="repository-list__hint">
        No repositories yet. Phase 1 will add the picker that scans
        <code> .claude/skills</code> and <code>.codex/skills</code>.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled>Add Repository</button>
        <Link to="/workspace/preview">
          <button type="button">Open preview workspace</button>
        </Link>
      </div>
    </div>
  );
}
