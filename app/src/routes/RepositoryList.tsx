import { open } from "@tauri-apps/plugin-dialog";
import { Link } from "react-router-dom";
import { useRepositoryStore } from "../stores/repositoryStore";

export function RepositoryList() {
  const repositories = useRepositoryStore((s) => s.repositories);
  const addRepository = useRepositoryStore((s) => s.addRepository);

  async function handleAdd() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await addRepository(selected);
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
          {repositories.map((repo) => (
            <li key={repo.id}>
              <Link to={`/workspace/${repo.id}`} className="repository-list__item">
                <span className="repository-list__item-name">{repo.name}</span>
                <span className="repository-list__item-path">{repo.path}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
