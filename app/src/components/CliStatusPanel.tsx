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
import type { CliSettingsDTO, McpServerSummary } from "../host/bridge";

const CLI_LABELS: Record<CliId, string> = {
  claude: "Claude CLI",
  codex: "Codex CLI",
};

const CLI_COMMANDS: Record<CliId, string> = {
  claude: "claude",
  codex: "codex",
};

const MCP_LABELS: Record<McpProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
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

function serverCountLabel(count: number): string {
  return `${count} server${count === 1 ? "" : "s"}`;
}

function mcpTotal(entries: Record<McpProviderId, McpEntry>): number {
  return (entries.claude.serverCount ?? 0) + (entries.codex.serverCount ?? 0);
}

function authRequiredCount(entries: Record<McpProviderId, McpEntry>): number {
  return (entries.claude.servers ?? []).filter(
    (server) => server.authRequired === true,
  ).length;
}

function mcpSummary(entries: Record<McpProviderId, McpEntry>): string {
  const claude = entries.claude.serverCount ?? 0;
  const codex = entries.codex.serverCount ?? 0;
  const auth = authRequiredCount(entries);
  return [
    `Claude ${claude}`,
    `Codex ${codex}`,
    auth ? `${auth} auth required` : "no auth required",
  ].join(" · ");
}

function mcpStatus(entries: Record<McpProviderId, McpEntry>): CliStatus {
  if (entries.claude.status === "checking" || entries.codex.status === "checking") {
    return "checking";
  }
  if (entries.claude.status === "error" || entries.codex.status === "error") {
    return "error";
  }
  if (entries.claude.status === "missing" || entries.codex.status === "missing") {
    return "missing";
  }
  if (entries.claude.status === "ok" || entries.codex.status === "ok") {
    return "ok";
  }
  return "idle";
}

function serverEndpoint(server: McpServerSummary): string {
  if (server.url) return server.url;
  if (server.command) {
    const args = server.args.length ? ` ${server.args.join(" ")}` : "";
    return `${server.command}${args}`;
  }
  return "no endpoint";
}

function serverSource(server: McpServerSummary): string {
  if (server.scope === "project" && server.projectPath) {
    return `project · ${server.projectPath}`;
  }
  return server.scope;
}

export function CliStatusPanel() {
  const entries = useCliStatusStore((s) => s.entries);
  const mcpEntries = useCliStatusStore((s) => s.mcpEntries);
  const isChecking = useCliStatusStore((s) => s.isChecking);
  const isCheckingMcp = useCliStatusStore((s) => s.isCheckingMcp);
  const refreshAll = useCliStatusStore((s) => s.refreshAll);
  const [detailId, setDetailId] = useState<CliId | null>(null);
  const [mcpExpanded, setMcpExpanded] = useState(false);
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
  const isRefreshing = isChecking || isCheckingMcp;
  const mcpAggregateStatus = mcpStatus(mcpEntries);

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
        <div
          className="mcp-servers-section"
          data-testid="mcp-servers-section"
          data-expanded={mcpExpanded ? "true" : "false"}
        >
          <button
            type="button"
            className="cli-status-row mcp-servers-toggle"
            onClick={() => setMcpExpanded((value) => !value)}
            aria-expanded={mcpExpanded}
            data-testid="mcp-servers-toggle"
            data-status={mcpAggregateStatus}
          >
            {isCheckingMcp ? (
              <span
                className="cli-status-spinner"
                aria-hidden="true"
                role="presentation"
              />
            ) : (
              <span
                className={`cli-status-dot cli-status-dot--${mcpAggregateStatus}`}
                aria-hidden="true"
              />
            )}
            <span className="mcp-servers-toggle__chevron" aria-hidden="true">
              {mcpExpanded ? "v" : ">"}
            </span>
            <span className="cli-status-row__name">MCP Servers</span>
            <span className="cli-status-row__detail">
              {mcpSummary(mcpEntries)}
            </span>
            <span className="cli-status-row__sr">
              {STATUS_LABEL[mcpAggregateStatus]}
            </span>
          </button>
          {mcpExpanded ? (
            <div
              className="mcp-servers-panel"
              data-testid="mcp-servers-panel"
            >
              {mcpIds.map((id) => {
                const entry = mcpEntries[id];
                return (
                  <div
                    key={id}
                    className="mcp-provider"
                    data-testid={`mcp-provider-${id}`}
                    data-status={entry.status}
                  >
                    <div className="mcp-provider__header">
                      <span className="mcp-provider__name">
                        {MCP_LABELS[id]}
                      </span>
                      <span className="mcp-provider__count">
                        {serverCountLabel(entry.serverCount ?? 0)}
                      </span>
                    </div>
                    {entry.status === "missing" || entry.status === "error" ? (
                      <div
                        className="mcp-provider__error"
                        data-testid={`mcp-provider-error-${id}`}
                      >
                        {entry.errorMessage ?? "MCP config unavailable"}
                      </div>
                    ) : null}
                    {entry.status === "ok" && !entry.servers?.length ? (
                      <div className="mcp-provider__empty">
                        No servers configured
                      </div>
                    ) : null}
                    {entry.servers?.map((server) => (
                      <div
                        key={`${server.scope}-${server.name}-${server.projectPath ?? ""}`}
                        className="mcp-server-row"
                        data-testid={`mcp-server-${id}-${server.name}`}
                      >
                        <div className="mcp-server-row__main">
                          <span className="mcp-server-row__name">
                            {server.name}
                          </span>
                          {server.authRequired ? (
                            <span
                              className="mcp-server-row__badge"
                              data-testid={`mcp-auth-required-${server.name}`}
                            >
                              auth-required
                            </span>
                          ) : null}
                        </div>
                        <div className="mcp-server-row__meta">
                          <span>{server.transport ?? "unknown"}</span>
                          <span>{serverEndpoint(server)}</span>
                          <span>{serverSource(server)}</span>
                          <span>
                            {server.authRequired ? "auth required" : "auth ok"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="mcp-servers-panel__summary">
                {serverCountLabel(mcpTotal(mcpEntries))} total
              </div>
            </div>
          ) : null}
        </div>
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
