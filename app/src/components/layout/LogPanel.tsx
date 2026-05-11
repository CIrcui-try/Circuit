import { useEffect, useRef, useState } from "react";
import { getHostBridge, type RunLogEntryDTO } from "../../host/bridge";
import { parseRunLogJsonl } from "../../runner/runLogPersistence";
import {
  useRunLogStore,
  type PendingApproval,
} from "../../runner/runLogStore";
import { useRunElapsedLabel } from "../../runner/runElapsed";
import { useRunStore } from "../../runner/runStore";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { getRuntimeBridge } from "../../runtime/bridge/RuntimeBridge";
import type { AgentRunEvent } from "../../runtime/contracts/SkillExecution";
import { ApprovalPrompt } from "./ApprovalPrompt";

type RunLogDisplayItem =
  | {
      kind: "event";
      nodeId: string;
      event: AgentRunEvent;
    }
  | {
      kind: "stream";
      nodeId: string;
      stream: "stdout" | "stderr";
      events: Extract<AgentRunEvent, { type: "stdout" | "stderr" }>[];
    };

export interface LogPanelProps {
  /** Override the runtime bridge — used by tests / Storybook. */
  runtimeBridgeOverride?: { sendInput: (runId: string, text: string) => Promise<void> };
  onCollapse?: () => void;
}

function LogHeader({
  isRunning,
  status,
  runId,
  activeNodeLabel,
  activeNodeState,
  activeNodeIdle,
  elapsedLabel,
  copyDisabled,
  copyFeedback,
  onCopyLog,
  clearDisabled,
  onClearLog,
  onCollapse,
}: {
  isRunning: boolean;
  status: string;
  runId: string | null;
  activeNodeLabel: string | null;
  activeNodeState: string | null;
  activeNodeIdle: boolean;
  elapsedLabel: string | null;
  copyDisabled: boolean;
  copyFeedback: string | null;
  onCopyLog: () => void | Promise<void>;
  clearDisabled: boolean;
  onClearLog: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div className="panel-header panel-header--with-status">
      <span>Run Log</span>
      <span className="panel-header__actions">
        <span className="panel-header__running" data-testid="run-log-run-state">
          {isRunning ? (
            <span
              className="cli-status-spinner cli-status-spinner--inline"
              aria-hidden="true"
              role="presentation"
            />
          ) : null}
          {runId ? `run ${shortId(runId)} · ` : ""}
          {status}
          {elapsedLabel ? ` · ${elapsedLabel}` : ""}
          {activeNodeLabel ? ` · ${activeNodeLabel}` : ""}
          {activeNodeState === "waiting_input" ? " · waiting for input" : ""}
          {activeNodeIdle ? " · idle" : ""}
        </span>
        <button
          type="button"
          className="panel-header__button panel-header__button--icon"
          data-testid="run-log-copy"
          aria-label="Copy run log"
          title="Copy run log"
          disabled={copyDisabled}
          onClick={() => void onCopyLog()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            focusable="false"
            className="panel-header__icon"
          >
            <path
              d="M5 1.75A1.75 1.75 0 0 1 6.75 0h5.5A1.75 1.75 0 0 1 14 1.75v7.5A1.75 1.75 0 0 1 12.25 11h-5.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-5.5ZM2 4.75C2 3.784 2.784 3 3.75 3H4v1.5h-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25V12H11v.25A1.75 1.75 0 0 1 9.25 14h-5.5A1.75 1.75 0 0 1 2 12.25v-7.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
        {copyFeedback ? (
          <span
            className="panel-header__feedback"
            data-testid="run-log-copy-feedback"
            role="status"
          >
            {copyFeedback}
          </span>
        ) : null}
        <button
          type="button"
          className="panel-header__button panel-header__button--icon"
          data-testid="run-log-clear"
          aria-label="Clear run log"
          title="Clear run log"
          disabled={clearDisabled}
          onClick={onClearLog}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            focusable="false"
            className="panel-header__icon"
          >
            <path
              d="M6.5 1.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V2H13v1.5H3V2h3.5v-.5ZM4 4.5h8l-.45 8.08A1.5 1.5 0 0 1 10.05 14h-4.1a1.5 1.5 0 0 1-1.5-1.42L4 4.5Zm2.25 1.25.25 6h1.25l-.25-6H6.25Zm2.5 0-.25 6h1.25l.25-6H8.75Z"
              fill="currentColor"
            />
          </svg>
        </button>
        {onCollapse ? (
          <button
            type="button"
            className="panel-header__button"
            data-testid="run-log-collapse"
            aria-label="Hide run log"
            onClick={onCollapse}
          >
            Hide
          </button>
        ) : null}
      </span>
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

export function LogPanel({ runtimeBridgeOverride, onCollapse }: LogPanelProps = {}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const events = useRunLogStore((s) => s.events);
  const nodeResults = useRunLogStore((s) => s.nodeResults);
  const pendingApprovals = useRunLogStore((s) => s.pendingApprovals);
  const runId = useRunLogStore((s) => s.runId);
  const resetLog = useRunLogStore((s) => s.reset);
  const resolvePendingApproval = useRunLogStore(
    (s) => s.resolvePendingApproval,
  );
  const runStatus = useRunStore((s) => s.status);
  const runStoreRunId = useRunStore((s) => s.runId);
  const activeNodeId = useRunStore((s) => s.activeNodeId);
  const nodeStates = useRunStore((s) => s.nodeStates);
  const nodeDebug = useRunStore((s) => s.nodeDebug);
  const elapsedLabel = useRunElapsedLabel();
  const isRunning = runStatus === "running";
  const repo = useRepositoryStore((s) =>
    s.selectedId
      ? s.repositories.find((r) => r.id === s.selectedId) ?? null
      : null,
  );
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId);
  const activeNodeLabel = useWorkflowStore((s) => {
    if (!activeNodeId) return null;
    return s.nodes.find((n) => n.id === activeNodeId)?.data.label ?? activeNodeId;
  });

  const showPicker = repo && workflowId;
  const approvals = Object.values(pendingApprovals);
  const activeNodeState = activeNodeId ? nodeStates[activeNodeId] ?? null : null;
  const activeNodeIdle = activeNodeId
    ? Boolean(nodeDebug[activeNodeId]?.idleSince)
    : false;
  const headerRunId = runStoreRunId ?? runId;
  const canCopyLog =
    events.length > 0 || Object.keys(nodeResults).length > 0;
  const hasLogContent = canCopyLog || approvals.length > 0;
  const canClearLog = hasLogContent && !isRunning;
  const displayItems = buildRunLogDisplayItems(
    events,
    new Set(approvals.map((a) => a.requestId)),
  );

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

  const handleCopyLog = async () => {
    if (!canCopyLog) return;
    try {
      await navigator.clipboard.writeText(
        formatRunLogForClipboard(events, nodeResults),
      );
      setCopyFeedback("Copied");
      if (copyFeedbackTimeoutRef.current != null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
        copyFeedbackTimeoutRef.current = null;
      }, 1600);
    } catch (err) {
      setCopyFeedback(null);
      console.error("[LogPanel] copy run log failed", err);
    }
  };

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current != null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleClearLog = () => {
    if (!canClearLog) return;
    resetLog();
  };

  if (
    events.length === 0 &&
    Object.keys(nodeResults).length === 0 &&
    approvals.length === 0
  ) {
    return (
      <footer className="workspace__log">
        <LogHeader
          isRunning={isRunning}
          status={runStatus}
          runId={headerRunId}
          activeNodeLabel={activeNodeLabel}
          activeNodeState={activeNodeState}
          activeNodeIdle={activeNodeIdle}
          elapsedLabel={elapsedLabel}
          copyDisabled={!canCopyLog}
          copyFeedback={copyFeedback}
          onCopyLog={handleCopyLog}
          clearDisabled={!canClearLog}
          onClearLog={handleClearLog}
          onCollapse={onCollapse}
        />
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
      <LogHeader
        isRunning={isRunning}
        status={runStatus}
        runId={headerRunId}
        activeNodeLabel={activeNodeLabel}
        activeNodeState={activeNodeState}
        activeNodeIdle={activeNodeIdle}
        elapsedLabel={elapsedLabel}
        copyDisabled={!canCopyLog}
        copyFeedback={copyFeedback}
        onCopyLog={handleCopyLog}
        clearDisabled={!canClearLog}
        onClearLog={handleClearLog}
        onCollapse={onCollapse}
      />
      {showPicker ? (
        <PastRunsPicker
          repoPath={repo.path}
          workflowId={workflowId}
          isRunning={isRunning}
        />
      ) : null}
      <ul className="run-log" data-testid="run-log">
        {displayItems.map((item, i) =>
          item.kind === "stream" ? (
            <StreamLogGroup key={`ev-${i}`} item={item} />
          ) : (
            <li
              key={`ev-${i}`}
              className={`run-log__line run-log__line--${item.event.type}`}
              data-testid="run-log-line"
            >
              <span className="run-log__node">{item.nodeId}</span>
              <span className="run-log__type">{formatEventType(item.event)}</span>
              <span className="run-log__payload">
                {formatSummaryPayload(item.event)}
              </span>
            </li>
          ),
        )}
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

function StreamLogGroup({ item }: { item: Extract<RunLogDisplayItem, { kind: "stream" }> }) {
  const lineCount = countStreamLines(item.events);
  const preview = summarizeStreamGroup(item.events);
  const rawText = joinStreamText(item.events);

  return (
    <li
      className={`run-log__line run-log__line--stream run-log__line--${item.stream}`}
      data-testid="run-log-stream-group"
    >
      <details className="run-log__details">
        <summary className="run-log__summary-row">
          <span className="run-log__node">{item.nodeId}</span>
          <span className="run-log__type">{item.stream}</span>
          <span className="run-log__payload">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
            {preview ? ` - ${preview}` : ""}
          </span>
        </summary>
        <pre className="run-log__raw" data-testid="run-log-stream-raw">
          {rawText}
        </pre>
      </details>
    </li>
  );
}

function buildRunLogDisplayItems(
  events: { nodeId: string; event: AgentRunEvent }[],
  pendingApprovalIds: Set<string>,
): RunLogDisplayItem[] {
  const items: RunLogDisplayItem[] = [];

  for (const entry of events) {
    if (
      entry.event.type === "approval_required" &&
      pendingApprovalIds.has(entry.event.requestId)
    ) {
      continue;
    }

    if (entry.event.type === "stdout" || entry.event.type === "stderr") {
      const prior = items[items.length - 1];
      if (
        prior?.kind === "stream" &&
        prior.nodeId === entry.nodeId &&
        prior.stream === entry.event.type
      ) {
        prior.events.push(entry.event);
      } else {
        items.push({
          kind: "stream",
          nodeId: entry.nodeId,
          stream: entry.event.type,
          events: [entry.event],
        });
      }
      continue;
    }

    items.push({
      kind: "event",
      nodeId: entry.nodeId,
      event: entry.event,
    });
  }

  return items;
}

function formatEventType(ev: AgentRunEvent): string {
  if (ev.type === "approval_required") return "approval";
  return ev.type;
}

function formatSummaryPayload(ev: AgentRunEvent): string {
  switch (ev.type) {
    case "start":
      return ev.command ? `started ${ev.command}` : ev.message;
    case "finish":
      return ev.exitCode != null
        ? ev.exitCode === 0
          ? `completed successfully (exit ${ev.exitCode})`
          : `failed (exit ${ev.exitCode})`
        : "finished";
    case "status":
      return ev.status;
    case "error":
      return ev.message;
    case "approval_required":
      return ev.prompt;
    case "stdout":
    case "stderr":
      return ev.text;
    default:
      return "";
  }
}

function countStreamLines(
  events: Extract<AgentRunEvent, { type: "stdout" | "stderr" }>[],
): number {
  let count = 0;
  for (const ev of events) {
    const trimmed = ev.text.replace(/\n$/, "");
    if (trimmed.length === 0) continue;
    count += trimmed.split(/\r?\n/).length;
  }
  return Math.max(count, events.length);
}

function summarizeStreamGroup(
  events: Extract<AgentRunEvent, { type: "stdout" | "stderr" }>[],
): string {
  const lines = events.flatMap((ev) =>
    ev.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const candidates = lines.filter((line) => !isStreamSummaryNoise(line));
  let bestLine = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestIndex = -1;

  candidates.forEach((line, index) => {
    const score = scoreStreamSummaryLine(line);
    if (
      score > bestScore ||
      (score === bestScore && score >= 100 && index > bestIndex)
    ) {
      bestLine = line;
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestLine.length > 0) return truncate(bestLine, 96);
  return "";
}

function isStreamSummaryNoise(line: string): boolean {
  if (
    /^[-=]{4,}$/.test(line) ||
    /^Reading additional input from stdin/i.test(line) ||
    /^OpenAI Codex\b/i.test(line) ||
    /^tokens used$/i.test(line) ||
    /^[\d,]+$/.test(line) ||
    /^(user|codex|exec)$/i.test(line)
  ) {
    return true;
  }

  if (
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i.test(
      line,
    ) ||
    /^\/.+\s-lc\s/.test(line) ||
    /\s+in\s+\/Users\/.+$/i.test(line) ||
    /\s+(succeeded|exited)\s+(in|with code)\s+/i.test(line)
  ) {
    return true;
  }

  return false;
}

function scoreStreamSummaryLine(line: string): number {
  let score = 0;
  if (
    /(실패|중단|불가|오류|에러|경고|없습니다|failed|failure|error|warning|cannot|could not|unable|invalid|denied|aborted|blocked)/i.test(
      line,
    )
  ) {
    score += 100;
  }
  if (/[가-힣]/.test(line)) score += 30;
  if (/`[^`]+`/.test(line)) score += 20;
  if (/[.!?。]$|다\.?$|요\.?$/.test(line)) score += 10;
  if (line.length >= 20) score += 5;
  return score;
}

function joinStreamText(
  events: Extract<AgentRunEvent, { type: "stdout" | "stderr" }>[],
): string {
  return events
    .map((ev) => ev.text)
    .reduce((joined, text) => {
      if (joined.length === 0 || joined.endsWith("\n") || text.length === 0) {
        return `${joined}${text}`;
      }
      return `${joined}\n${text}`;
    }, "");
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

function formatRunLogForClipboard(
  events: { nodeId: string; event: AgentRunEvent }[],
  nodeResults: Record<string, { status: string; exitCode?: number }>,
): string {
  const lines = events.map((entry) =>
    [entry.nodeId, entry.event.type, formatPayload(entry.event)].join("\t"),
  );
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const payload =
      result.exitCode != null
        ? `${result.status} (exit ${result.exitCode})`
        : result.status;
    lines.push([nodeId, "result", payload].join("\t"));
  }
  return lines.join("\n");
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}
