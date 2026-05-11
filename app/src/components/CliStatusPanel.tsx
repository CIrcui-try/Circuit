import { useEffect } from "react";
import {
  useCliStatusStore,
  type CliEntry,
  type CliId,
  type CliStatus,
} from "../stores/cliStatusStore";

const CLI_LABELS: Record<CliId, string> = {
  claude: "Claude CLI",
  codex: "Codex CLI",
};

const STATUS_LABEL: Record<CliStatus, string> = {
  idle: "Not checked",
  checking: "Checking...",
  ok: "Available",
  missing: "Not installed",
  error: "Error",
};

function describe(entry: CliEntry): string {
  switch (entry.status) {
    case "ok":
      return entry.version ?? "Available";
    case "missing":
      return entry.errorMessage ?? "Not found in PATH";
    case "error":
      return entry.errorMessage ?? "Error";
    case "checking":
      return entry.progressLabel ?? "Checking...";
    case "idle":
    default:
      return "Not checked";
  }
}

export function CliStatusPanel() {
  const entries = useCliStatusStore((s) => s.entries);
  const isChecking = useCliStatusStore((s) => s.isChecking);
  const runChecks = useCliStatusStore((s) => s.runChecks);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const ids: CliId[] = ["claude", "codex"];

  return (
    <section className="cli-status-panel" data-testid="cli-status-panel">
      <header className="cli-status-panel__header">
        <span className="cli-status-panel__title">CLI Status</span>
        <button
          type="button"
          className="cli-status-panel__refresh"
          onClick={() => void runChecks()}
          disabled={isChecking}
          data-testid="cli-status-refresh"
        >
          {isChecking ? (
            <>
              <span
                className="cli-status-spinner cli-status-spinner--inline"
                aria-hidden="true"
                role="presentation"
              />
              Checking...
            </>
          ) : (
            "refresh"
          )}
        </button>
      </header>
      <div className="cli-status-panel__list">
        {ids.map((id) => {
          const entry = entries[id];
          return (
            <div
              key={id}
              className="cli-status-row"
              data-testid={`cli-status-row-${id}`}
              data-status={entry.status}
            >
              {entry.status === "checking" ? (
                <span
                  className="cli-status-spinner"
                  aria-hidden="true"
                  role="presentation"
                />
              ) : (
                <span
                  className={`cli-status-dot cli-status-dot--${entry.status}`}
                  aria-hidden="true"
                />
              )}
              <span className="cli-status-row__name">{CLI_LABELS[id]}</span>
              <span
                className="cli-status-row__detail"
                title={describe(entry)}
              >
                {describe(entry)}
              </span>
              <span className="cli-status-row__sr">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
