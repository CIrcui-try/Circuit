import { useEffect, useState } from "react";
import {
  useCliStatusStore,
  type CliEntry,
  type CliId,
  type CliStatus,
  type McpEntry,
  type McpProviderId,
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

const MCP_LABELS: Record<McpProviderId, string> = {
  claude: "Claude MCP",
  codex: "Codex MCP",
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

function describeMcp(entry: McpEntry): string {
  switch (entry.status) {
    case "ok": {
      const count = entry.serverCount ?? 0;
      const label = `${count} server${count === 1 ? "" : "s"}`;
      const names = entry.servers?.map((server) => server.name).filter(Boolean);
      if (!names?.length) return label;
      return `${label}: ${names.slice(0, 3).join(", ")}${
        names.length > 3 ? ", ..." : ""
      }`;
    }
    case "missing":
      return entry.errorMessage ?? "Config file not found";
    case "error":
      return entry.errorMessage ?? "Error";
    case "checking":
      return entry.errorMessage ?? "Checking...";
    case "idle":
    default:
      return "Not checked";
  }
}

export function CliStatusPanel() {
  const entries = useCliStatusStore((s) => s.entries);
  const mcpEntries = useCliStatusStore((s) => s.mcpEntries);
  const isChecking = useCliStatusStore((s) => s.isChecking);
  const isCheckingMcp = useCliStatusStore((s) => s.isCheckingMcp);
  const refreshAll = useCliStatusStore((s) => s.refreshAll);
  const [detailId, setDetailId] = useState<CliId | null>(null);
  const [mcpDetailId, setMcpDetailId] = useState<McpProviderId | null>(null);
  const [settings, setSettings] = useState<CliSettingsDTO>({});
  const [editorId, setEditorId] = useState<CliId | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [savingPath, setSavingPath] = useState(false);

  useEffect(() => {
    let active = true;
    void loadCliSettings().then((loaded) => {
      if (active) setSettings(loaded);
    });
    void refreshAll();
    return () => {
      active = false;
    };
  }, [refreshAll]);

  const ids: CliId[] = ["claude", "codex"];
  const mcpIds: McpProviderId[] = ["claude", "codex"];
  const detailEntry = detailId ? entries[detailId] : null;
  const detailLog = detailEntry?.detailLog;
  const mcpDetailEntry = mcpDetailId ? mcpEntries[mcpDetailId] : null;
  const mcpDetailLog = mcpDetailEntry?.detailLog;
  const isRefreshing = isChecking || isCheckingMcp;

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
      void refreshAll();
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
          onClick={() => void refreshAll()}
          disabled={isRefreshing}
          data-testid="cli-status-refresh"
        >
          {isRefreshing ? (
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
        {mcpIds.map((id) => {
          const entry = mcpEntries[id];
          return (
            <div
              key={`mcp-${id}`}
              className="cli-status-row"
              data-testid={`mcp-status-row-${id}`}
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
              <span className="cli-status-row__name">{MCP_LABELS[id]}</span>
              <span
                className="cli-status-row__detail"
                title={describeMcp(entry)}
              >
                {describeMcp(entry)}
              </span>
              {entry.detailLog &&
              (entry.status === "missing" || entry.status === "error") ? (
                <button
                  type="button"
                  className="cli-status-row__detail-button"
                  onClick={() => setMcpDetailId(id)}
                  data-testid={`mcp-status-detail-${id}`}
                >
                  Detail
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
      {mcpDetailId && mcpDetailLog ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel cli-status-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-status-detail-title"
            data-testid="mcp-status-detail-modal"
          >
            <h2 id="mcp-status-detail-title" className="modal__title">
              {MCP_LABELS[mcpDetailId]} details
            </h2>
            <pre
              className="cli-status-detail-modal__log"
              data-testid="mcp-status-detail-log"
            >
              {mcpDetailLog}
            </pre>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setMcpDetailId(null)}
                data-testid="mcp-status-detail-close"
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
