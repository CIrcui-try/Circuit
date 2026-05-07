import { useEffect, useState } from "react";
import { getHostBridge, type RunLogEntryDTO } from "../../host/bridge";
import { parseRunLogJsonl } from "../../runner/runLogPersistence";
import {
  useRunLogStore,
  type PendingApproval,
} from "../../runner/runLogStore";
import { useRunStore } from "../../runner/runStore";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { getRuntimeBridge } from "../../runtime/bridge/RuntimeBridge";
import type { AgentRunEvent } from "../../runtime/contracts/SkillExecution";
import { ApprovalPrompt } from "./ApprovalPrompt";

export interface LogPanelProps {
  /** Override the runtime bridge — used by tests / Storybook. */
  runtimeBridgeOverride?: { sendInput: (runId: string, text: string) => Promise<void> };
}

function LogHeader({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="panel-header panel-header--with-status">
      <span>Run Log</span>
      {isRunning ? (
        <span className="panel-header__running" data-testid="run-log-running">
          <span
            className="cli-status-spinner cli-status-spinner--inline"
            aria-hidden="true"
            role="presentation"
          />
          running…
        </span>
      ) : null}
    </div>
  );
}

function PastRunsPicker({
  repoPath,
  workflowId,
  isRunning,
}: {
  repoPath: string;
  workflowId: string;
  isRunning: boolean;
}) {
  const [entries, setEntries] = useState<RunLogEntryDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = getHostBridge();
    if (!host.listRunLogs) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await host.listRunLogs!(repoPath, workflowId);
        if (!cancelled) setEntries(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, workflowId]);

  const handleSelect = async (runId: string) => {
    if (runId === "") return;
    const host = getHostBridge();
    if (!host.loadRunLog) return;
    try {
      const jsonl = await host.loadRunLog(repoPath, workflowId, runId);
      const parsed = parseRunLogJsonl(jsonl);
      const store = useRunLogStore.getState();
      store.beginRun({ runId, workflowId });
      for (const e of parsed.events) {
        store.appendEvent(e.nodeId, e.event);
      }
      for (const [nodeId, r] of Object.entries(parsed.nodeResults)) {
        store.setNodeResult(nodeId, r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (entries.length === 0 && !error) return null;

  return (
    <div className="run-log__past" data-testid="run-log-past-runs">
      <label className="run-log__past-label">Past runs:</label>
      <select
        data-testid="run-log-past-select"
        defaultValue=""
        disabled={isRunning}
        onChange={(e) => void handleSelect(e.target.value)}
      >
        <option value="">— select —</option>
        {entries.map((e) => (
          <option key={e.runId} value={e.runId}>
            {e.runId}
          </option>
        ))}
      </select>
      {error ? (
        <span className="run-log__past-error" data-testid="run-log-past-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function LogPanel({ runtimeBridgeOverride }: LogPanelProps = {}) {
  const events = useRunLogStore((s) => s.events);
  const nodeResults = useRunLogStore((s) => s.nodeResults);
  const pendingApprovals = useRunLogStore((s) => s.pendingApprovals);
  const runId = useRunLogStore((s) => s.runId);
  const resolvePendingApproval = useRunLogStore(
    (s) => s.resolvePendingApproval,
  );
  const isRunning = useRunStore((s) => s.status === "running");
  const repo = useRepositoryStore((s) =>
    s.selectedId
      ? s.repositories.find((r) => r.id === s.selectedId) ?? null
      : null,
  );
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId);

  const showPicker = repo && workflowId;
  const approvals = Object.values(pendingApprovals);

  const handleRespond = async (request: PendingApproval, text: string) => {
    if (!runId) return;
    const bridge = runtimeBridgeOverride ?? getRuntimeBridge();
    try {
      await bridge.sendInput(runId, text);
    } catch (err) {
      console.error("[LogPanel] sendInput failed", err);
    }
    resolvePendingApproval(request.requestId);
  };

  if (
    events.length === 0 &&
    Object.keys(nodeResults).length === 0 &&
    approvals.length === 0
  ) {
    return (
      <footer className="workspace__log">
        <LogHeader isRunning={isRunning} />
        {showPicker ? (
          <PastRunsPicker
            repoPath={repo.path}
            workflowId={workflowId}
            isRunning={isRunning}
          />
        ) : null}
        <div className="empty-state">No runs yet.</div>
      </footer>
    );
  }

  return (
    <footer className="workspace__log">
      <LogHeader isRunning={isRunning} />
      {showPicker ? (
        <PastRunsPicker
          repoPath={repo.path}
          workflowId={workflowId}
          isRunning={isRunning}
        />
      ) : null}
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
        {approvals.map((approval) => (
          <ApprovalPrompt
            key={`approval-${approval.requestId}`}
            request={approval}
            onRespond={(text) => handleRespond(approval, text)}
            onDismiss={() => resolvePendingApproval(approval.requestId)}
          />
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
    case "approval_required":
      return ev.prompt;
    default:
      return "";
  }
}
