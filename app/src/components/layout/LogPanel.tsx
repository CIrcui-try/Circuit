import { useRunLogStore } from "../../runner/runLogStore";
import type { AgentRunEvent } from "../../runtime/contracts/SkillExecution";

export function LogPanel() {
  const events = useRunLogStore((s) => s.events);
  const nodeResults = useRunLogStore((s) => s.nodeResults);

  if (events.length === 0 && Object.keys(nodeResults).length === 0) {
    return (
      <footer className="workspace__log">
        <div className="panel-header">Run Log</div>
        <div className="empty-state">No runs yet.</div>
      </footer>
    );
  }

  return (
    <footer className="workspace__log">
      <div className="panel-header">Run Log</div>
      <ul className="run-log" data-testid="run-log">
        {events.map((entry, i) => (
          <li
            key={`ev-${i}`}
            className={`run-log__line run-log__line--${entry.event.type}`}
            data-testid="run-log-line"
          >
            <span className="run-log__node">{entry.nodeId}</span>
            <span className="run-log__type">{entry.event.type}</span>
            <span className="run-log__payload">
              {formatPayload(entry.event)}
            </span>
          </li>
        ))}
        {Object.entries(nodeResults).map(([nodeId, r]) => (
          <li
            key={`result-${nodeId}`}
            className={`run-log__line run-log__line--result run-log__line--result-${r.status}`}
            data-testid="run-log-result"
          >
            <span className="run-log__node">{nodeId}</span>
            <span className="run-log__type">result</span>
            <span className="run-log__payload">
              {r.status}
              {r.exitCode != null ? ` (exit ${r.exitCode})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
}

function formatPayload(ev: AgentRunEvent): string {
  switch (ev.type) {
    case "stdout":
    case "stderr":
      return ev.text;
    case "start":
    case "error":
      return ev.message;
    case "finish":
      return ev.exitCode != null ? `exit ${ev.exitCode}` : "";
    case "status":
      return ev.status;
    default:
      return "";
  }
}
