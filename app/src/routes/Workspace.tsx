import { Link, useParams } from "react-router-dom";
import { Canvas } from "../components/layout/Canvas";
import { LogPanel } from "../components/layout/LogPanel";
import { PropertiesPanel } from "../components/layout/PropertiesPanel";
import { Sidebar } from "../components/layout/Sidebar";

export function Workspace() {
  const { repoId } = useParams<{ repoId?: string }>();

  return (
    <div className="workspace">
      <header className="workspace__toolbar">
        <Link to="/" aria-label="Back to repository list">←</Link>
        <span className="workspace__toolbar-title">Circuit</span>
        <span style={{ color: "#8a8a92" }}>
          {repoId ? `Repository: ${repoId}` : "No repository selected"}
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
