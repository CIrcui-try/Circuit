import { useEffect, useState } from "react";
import {
  useCliStatusStore,
  type CliEntry,
  type CliId,
  type CliStatus,
} from "../stores/cliStatusStore";
import {
  loadCliSettings,
  manualPathForCommand,
  saveCliSettings,
  setManualPath,
} from "../stores/cliSettingsStore";
import type { CliSettingsDTO } from "../host/bridge";

const CLI_LABELS: Record<CliId, string> = {
  claude: "Claude CLI",
  codex: "Codex CLI",
};

const CLI_COMMANDS: Record<CliId, string> = {
  claude: "claude",
  codex: "codex",
};

const STATUS_LABEL: Record<CliStatus, string> = {
  idle: "Not checked",
  checking: "Checking...",
  ok: "Available",
  missing: "Not found by Circuit",
  error: "Error",
};

function describe(entry: CliEntry): string {
  switch (entry.status) {
    case "ok":
      return entry.version ?? "Available";
    case "missing":
      return entry.errorMessage ?? "Not found in app environment";
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
  const [detailId, setDetailId] = useState<CliId | null>(null);
  const [settings, setSettings] = useState<CliSettingsDTO>({});
  const [editorId, setEditorId] = useState<CliId | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [savingPath, setSavingPath] = useState(false);

  useEffect(() => {
    let active = true;
    void loadCliSettings().then((loaded) => {
      if (active) setSettings(loaded);
    });
    void runChecks();
    return () => {
      active = false;
    };
  }, [runChecks]);

  const ids: CliId[] = ["claude", "codex"];
  const detailEntry = detailId ? entries[detailId] : null;
  const detailLog = detailEntry?.detailLog;

  const openPathEditor = (id: CliId) => {
    const command = CLI_COMMANDS[id];
    setDraftPath(manualPathForCommand(settings, command) ?? "");
    setEditorId(id);
  };

  const savePath = async () => {
    if (!editorId) return;
    setSavingPath(true);
    try {
      const command = CLI_COMMANDS[editorId];
      const next = setManualPath(settings, command, draftPath);
      await saveCliSettings(next);
      setSettings(next);
      setEditorId(null);
      setDetailId(null);
      void runChecks();
    } finally {
      setSavingPath(false);
    }
  };

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
              {entry.detailLog &&
              (entry.status === "missing" || entry.status === "error") ? (
                <button
                  type="button"
                  className="cli-status-row__detail-button"
                  onClick={() => setDetailId(id)}
                  data-testid={`cli-status-detail-${id}`}
                >
                  Detail
                </button>
              ) : null}
              {entry.status === "missing" || entry.status === "error" ? (
                <button
                  type="button"
                  className="cli-status-row__detail-button"
                  onClick={() => openPathEditor(id)}
                  data-testid={`cli-status-set-path-${id}`}
                >
                  Set path
                </button>
              ) : null}
              <span className="cli-status-row__sr">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          );
        })}
      </div>
      {detailId && detailLog ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel cli-status-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cli-status-detail-title"
            data-testid="cli-status-detail-modal"
          >
            <h2 id="cli-status-detail-title" className="modal__title">
              {CLI_LABELS[detailId]} details
            </h2>
            <pre
              className="cli-status-detail-modal__log"
              data-testid="cli-status-detail-log"
            >
              {detailLog}
            </pre>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setDetailId(null)}
                data-testid="cli-status-detail-close"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {editorId ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel cli-status-path-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cli-status-path-title"
            data-testid="cli-status-path-modal"
          >
            <h2 id="cli-status-path-title" className="modal__title">
              Set {CLI_LABELS[editorId]} path
            </h2>
            <label className="cli-status-path-modal__field">
              <span>Executable path</span>
              <input
                type="text"
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                placeholder={`/opt/homebrew/bin/${CLI_COMMANDS[editorId]}`}
                data-testid="cli-status-path-input"
              />
            </label>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setEditorId(null)}
                disabled={savingPath}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setDraftPath("")}
                disabled={savingPath || draftPath.trim() === ""}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void savePath()}
                disabled={savingPath}
                data-testid="cli-status-path-save"
              >
                {savingPath ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
