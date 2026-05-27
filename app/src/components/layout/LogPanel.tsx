import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import type {
  AgentRunEvent,
  SkillExecutionResult,
  TokenUsage,
} from "../../runtime/contracts/SkillExecution";
import type { WorkflowSkillProvider } from "../../workflow/schema";
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

type RunLogColumnKey = "provider" | "skill" | "model" | "type" | "message";
type RunLogColumnWidths = Record<RunLogColumnKey, number>;
type RunLogNodeMeta = {
  provider?: WorkflowSkillProvider;
  skillLabel: string;
  model?: string;
};

const RUN_LOG_COLUMN_STORAGE_KEY = "circuit.runLog.columns.v1";
const RUN_LOG_COLUMN_DEFAULTS: RunLogColumnWidths = {
  provider: 90,
  skill: 150,
  model: 110,
  type: 70,
  message: 520,
};
const RUN_LOG_COLUMN_BOUNDS: Record<
  RunLogColumnKey,
  { min: number; max: number }
> = {
  provider: { min: 72, max: 160 },
  skill: { min: 96, max: 340 },
  model: { min: 72, max: 220 },
  type: { min: 56, max: 140 },
  message: { min: 180, max: 1200 },
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
  loopLabel,
  activeNodeLabel,
  activeNodeState,
  activeNodeIdle,
  elapsedLabel,
  tokenUsageLabel,
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
  loopLabel: string | null;
  activeNodeLabel: string | null;
  activeNodeState: string | null;
  activeNodeIdle: boolean;
  elapsedLabel: string | null;
  tokenUsageLabel: string | null;
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
          {tokenUsageLabel ? ` · ${tokenUsageLabel}` : ""}
          {loopLabel ? ` · ${loopLabel}` : ""}
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
  repositoryId,
  repoPath,
  workflowId,
  isRunning,
}: {
  repositoryId: string;
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
      store.beginRun({ runId, workflowId, repositoryId });
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
  const [columnWidths, setColumnWidths] = useRunLogColumnWidths();
  const [activeResize, setActiveResize] = useState<{
    column: RunLogColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const repo = useRepositoryStore((s) =>
    s.selectedId
      ? s.repositories.find((r) => r.id === s.selectedId) ?? null
      : null,
  );
  const logRecord = useRunLogStore((s) =>
    repo?.id ? s.getLogForRepository(repo.id) : s,
  );
  const runRecord = useRunStore((s) =>
    repo?.id ? s.getRunForRepository(repo.id) : s,
  );
  const resetLog = useRunLogStore((s) => s.reset);
  const resolvePendingApproval = useRunLogStore(
    (s) => s.resolvePendingApproval,
  );
  const elapsedLabel = useRunElapsedLabel(repo?.id);
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId);
  const workflowNodes = useWorkflowStore((s) => s.nodes);

  const visibleRunStatus = runRecord.status;
  const visibleRunId = runRecord.runId;
  const visibleLogRunId = logRecord.runId;
  const visibleEvents = logRecord.events;
  const visibleNodeResults = logRecord.nodeResults;
  const visiblePendingApprovals = logRecord.pendingApprovals;
  const visibleActiveNodeId = runRecord.activeNodeId;
  const visibleNodeStates = runRecord.nodeStates;
  const visibleNodeDebug = runRecord.nodeDebug;
  const showPicker = repo && workflowId;
  const approvals = Object.values(visiblePendingApprovals);
  const activeNodeLabel = visibleActiveNodeId
    ? workflowNodes.find((n) => n.id === visibleActiveNodeId)?.data.label ??
      visibleActiveNodeId
    : null;
  const activeNodeState = visibleActiveNodeId
    ? visibleNodeStates[visibleActiveNodeId] ?? null
    : null;
  const activeNodeIdle = visibleActiveNodeId
    ? Boolean(visibleNodeDebug[visibleActiveNodeId]?.idleSince)
    : false;
  const headerRunId = visibleRunId ?? visibleLogRunId;
  const loopLabel = formatLoopLabel(runRecord.runMode, runRecord.iteration);
  const visibleElapsedLabel = elapsedLabel;
  const visibleTokenUsageLabel = formatTokenUsageLabel(
    getConfirmedRunTokenUsage(visibleEvents, visibleNodeResults),
  );
  const canCopyLog =
    visibleEvents.length > 0 || Object.keys(visibleNodeResults).length > 0;
  const hasLogContent = canCopyLog || approvals.length > 0;
  const canClearLog = hasLogContent && visibleRunStatus !== "running";
  const displayItems = buildRunLogDisplayItems(
    visibleEvents,
    new Set(approvals.map((a) => a.requestId)),
  );
  const getNodeMeta = (nodeId: string): RunLogNodeMeta => {
    const node = workflowNodes.find((n) => n.id === nodeId);
    return {
      provider: node?.data.skillRef.provider,
      skillLabel: node?.data.label ?? nodeId,
      model: readRunLogModel(node?.data.execution?.model),
    };
  };

  const logColumnStyle = toRunLogColumnStyle(columnWidths);

  useEffect(() => {
    if (!activeResize) return;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - activeResize.startX;
      setColumnWidths((current) => ({
        ...current,
        [activeResize.column]: clampRunLogColumnWidth(
          activeResize.column,
          activeResize.startWidth + delta,
        ),
      }));
    };
    const handlePointerUp = () => setActiveResize(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeResize, setColumnWidths]);

  const handleResizeStart =
    (column: RunLogColumnKey) =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setActiveResize({
        column,
        startX: event.clientX,
        startWidth: columnWidths[column],
      });
    };

  const handleHeaderKeyDown =
    (column: RunLogColumnKey) =>
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const delta = event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
      if (delta === 0) return;
      event.preventDefault();
      setColumnWidths((current) => ({
        ...current,
        [column]: clampRunLogColumnWidth(column, current[column] + delta),
      }));
    };

  const handleRespond = async (request: PendingApproval, text: string) => {
    if (!visibleLogRunId) return;
    const bridge = runtimeBridgeOverride ?? getRuntimeBridge();
    try {
      await bridge.sendInput(visibleLogRunId, text);
    } catch (err) {
      console.error("[LogPanel] sendInput failed", err);
    }
    resolvePendingApproval(request.requestId, repo?.id);
  };

  const handleCopyLog = async () => {
    if (!canCopyLog) return;
    try {
      await navigator.clipboard.writeText(
        formatRunLogForClipboard(visibleEvents, visibleNodeResults, getNodeMeta),
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
    resetLog(repo?.id);
  };

  if (
    visibleEvents.length === 0 &&
    Object.keys(visibleNodeResults).length === 0 &&
    approvals.length === 0
  ) {
    return (
      <footer className="workspace__log">
        <LogHeader
          isRunning={visibleRunStatus === "running"}
          status={visibleRunStatus}
          runId={headerRunId}
          loopLabel={loopLabel}
          activeNodeLabel={activeNodeLabel}
          activeNodeState={activeNodeState}
          activeNodeIdle={activeNodeIdle}
          elapsedLabel={visibleElapsedLabel}
          tokenUsageLabel={visibleTokenUsageLabel}
          copyDisabled={!canCopyLog}
          copyFeedback={copyFeedback}
          onCopyLog={handleCopyLog}
          clearDisabled={!canClearLog}
          onClearLog={handleClearLog}
          onCollapse={onCollapse}
        />
        {showPicker ? (
          <PastRunsPicker
            repositoryId={repo.id}
            repoPath={repo.path}
            workflowId={workflowId}
            isRunning={visibleRunStatus === "running"}
          />
        ) : null}
        <div className="empty-state">No runs yet.</div>
      </footer>
    );
  }

  return (
    <footer className="workspace__log">
      <LogHeader
        isRunning={visibleRunStatus === "running"}
        status={visibleRunStatus}
        runId={headerRunId}
        loopLabel={loopLabel}
        activeNodeLabel={activeNodeLabel}
        activeNodeState={activeNodeState}
        activeNodeIdle={activeNodeIdle}
        elapsedLabel={visibleElapsedLabel}
        tokenUsageLabel={visibleTokenUsageLabel}
        copyDisabled={!canCopyLog}
        copyFeedback={copyFeedback}
        onCopyLog={handleCopyLog}
        clearDisabled={!canClearLog}
        onClearLog={handleClearLog}
        onCollapse={onCollapse}
      />
      {showPicker ? (
        <PastRunsPicker
          repositoryId={repo.id}
          repoPath={repo.path}
          workflowId={workflowId}
          isRunning={visibleRunStatus === "running"}
        />
      ) : null}
      <ul className="run-log" data-testid="run-log" style={logColumnStyle}>
        <RunLogColumnHeader
          onResizeStart={handleResizeStart}
          onResizeKeyDown={handleHeaderKeyDown}
        />
        {displayItems.map((item, i) =>
          item.kind === "stream" ? (
            <StreamLogGroup
              key={`ev-${i}`}
              item={item}
              nodeMeta={getNodeMeta(item.nodeId)}
            />
          ) : (
            <li
              key={`ev-${i}`}
              className={`run-log__line run-log__line--${item.event.type}`}
              data-testid="run-log-line"
            >
              <RunLogProviderCell provider={getNodeMeta(item.nodeId).provider} />
              <RunLogModelCell model={getNodeMeta(item.nodeId).model} />
              <RunLogSkillCell
                nodeId={item.nodeId}
                label={getNodeMeta(item.nodeId).skillLabel}
              />
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
            provider={getNodeMeta(approval.nodeId).provider}
            skillLabel={getNodeMeta(approval.nodeId).skillLabel}
            model={getNodeMeta(approval.nodeId).model}
            onRespond={(text) => handleRespond(approval, text)}
            onDismiss={() => resolvePendingApproval(approval.requestId)}
          />
        ))}
        {Object.entries(visibleNodeResults).map(([nodeId, r]) => (
          <li
            key={`result-${nodeId}`}
            className={`run-log__line run-log__line--result run-log__line--result-${r.status}`}
            data-testid="run-log-result"
          >
            <RunLogProviderCell provider={getNodeMeta(nodeId).provider} />
            <RunLogModelCell model={getNodeMeta(nodeId).model} />
            <RunLogSkillCell nodeId={nodeId} label={getNodeMeta(nodeId).skillLabel} />
            <span className="run-log__type">result</span>
            <span className="run-log__payload">
              {r.status}
              {r.exitCode != null ? ` (exit ${r.exitCode})` : ""}
              {r.usage ? ` · ${formatTokenUsageLabel(r.usage)}` : ""}
              {r.summary ? ` - ${r.summary}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
}

function RunLogColumnHeader({
  onResizeStart,
  onResizeKeyDown,
}: {
  onResizeStart: (
    column: RunLogColumnKey,
  ) => (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown: (
    column: RunLogColumnKey,
  ) => (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <li className="run-log__header" data-testid="run-log-column-header">
      {(["provider", "model", "skill", "type", "message"] as RunLogColumnKey[]).map(
        (column) => (
          <span key={column} className={`run-log__header-cell run-log__header-cell--${column}`}>
            <span className="run-log__header-label">
              {formatRunLogColumnLabel(column)}
            </span>
            <button
              type="button"
              className="run-log__resize-handle"
              data-testid={`run-log-resize-${column}`}
              aria-label={`Resize ${formatRunLogColumnLabel(column)} column`}
              onPointerDown={onResizeStart(column)}
              onKeyDown={onResizeKeyDown(column)}
            />
          </span>
        ),
      )}
    </li>
  );
}

function StreamLogGroup({
  item,
  nodeMeta,
}: {
  item: Extract<RunLogDisplayItem, { kind: "stream" }>;
  nodeMeta: RunLogNodeMeta;
}) {
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
          <RunLogProviderCell provider={nodeMeta.provider} />
          <RunLogModelCell model={nodeMeta.model} />
          <RunLogSkillCell nodeId={item.nodeId} label={nodeMeta.skillLabel} />
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

function RunLogProviderCell({
  provider,
}: {
  provider?: WorkflowSkillProvider;
}) {
  if (provider) {
    return (
      <span
        className={`run-log__node run-log__provider skill-list__chip skill-list__chip--${provider}`}
        data-testid="run-log-provider"
      >
        {provider}
      </span>
    );
  }

  return <span className="run-log__provider run-log__provider--empty">-</span>;
}

function RunLogSkillCell({
  nodeId,
  label,
}: {
  nodeId: string;
  label: string;
}) {
  return (
    <span className="run-log__skill" data-testid="run-log-skill" title={nodeId}>
      {label}
    </span>
  );
}

function RunLogModelCell({ model }: { model?: string }) {
  if (!model) return <span className="run-log__model run-log__model--empty">-</span>;
  return (
    <span className="run-log__model" data-testid="run-log-model" title={model}>
      {model}
    </span>
  );
}

function buildRunLogDisplayItems(
  events: { nodeId: string; event: AgentRunEvent }[],
  pendingApprovalIds: Set<string>,
): RunLogDisplayItem[] {
  const items: RunLogDisplayItem[] = [];

  for (const entry of events) {
    if (entry.event.type === "token_usage") continue;

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
  if (ev.type === "token_usage") return "tokens";
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
    case "token_usage":
      return formatTokenUsageLabel(ev.usage) ?? "";
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
  const circuitSummary = extractCircuitSummary(lines);
  if (circuitSummary.length > 0) return circuitSummary;

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

  if (bestLine.length > 0) return bestLine;
  return "";
}

function extractCircuitSummary(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^CIRCUIT_SUMMARY:\s*(.+)$/i.exec(lines[i]);
    if (match?.[1]) return match[1].trim();
  }
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
    /^\s*"[^"]+"\s*:\s*/.test(line) ||
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

function useRunLogColumnWidths() {
  const [widths, setWidths] = useState<RunLogColumnWidths>(() =>
    readStoredRunLogColumnWidths(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      RUN_LOG_COLUMN_STORAGE_KEY,
      JSON.stringify(widths),
    );
  }, [widths]);

  return [widths, setWidths] as const;
}

function readStoredRunLogColumnWidths(): RunLogColumnWidths {
  if (typeof window === "undefined") return RUN_LOG_COLUMN_DEFAULTS;

  try {
    const raw = window.localStorage.getItem(RUN_LOG_COLUMN_STORAGE_KEY);
    if (!raw) return RUN_LOG_COLUMN_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<RunLogColumnKey, unknown>>;
    return {
      provider: parseStoredRunLogColumnWidth("provider", parsed.provider),
      skill: parseStoredRunLogColumnWidth("skill", parsed.skill),
      model: parseStoredRunLogColumnWidth("model", parsed.model),
      type: parseStoredRunLogColumnWidth("type", parsed.type),
      message: parseStoredRunLogColumnWidth("message", parsed.message),
    };
  } catch {
    return RUN_LOG_COLUMN_DEFAULTS;
  }
}

function parseStoredRunLogColumnWidth(
  column: RunLogColumnKey,
  value: unknown,
): number {
  return typeof value === "number"
    ? clampRunLogColumnWidth(column, value)
    : RUN_LOG_COLUMN_DEFAULTS[column];
}

function clampRunLogColumnWidth(
  column: RunLogColumnKey,
  width: number,
): number {
  const bounds = RUN_LOG_COLUMN_BOUNDS[column];
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

function toRunLogColumnStyle(
  widths: RunLogColumnWidths,
): CSSProperties & Record<string, string> {
  return {
    "--run-log-provider-width": `${resolveRunLogColumnWidth("provider", widths.provider)}px`,
    "--run-log-skill-width": `${resolveRunLogColumnWidth("skill", widths.skill)}px`,
    "--run-log-model-width": `${resolveRunLogColumnWidth("model", widths.model)}px`,
    "--run-log-type-width": `${resolveRunLogColumnWidth("type", widths.type)}px`,
    "--run-log-message-width": `${resolveRunLogColumnWidth("message", widths.message)}px`,
  } as CSSProperties & Record<string, string>;
}

function resolveRunLogColumnWidth(
  column: RunLogColumnKey,
  width: unknown,
): number {
  return typeof width === "number" && Number.isFinite(width)
    ? clampRunLogColumnWidth(column, width)
    : RUN_LOG_COLUMN_DEFAULTS[column];
}

function formatRunLogColumnLabel(column: RunLogColumnKey): string {
  switch (column) {
    case "provider":
      return "Provider";
    case "skill":
      return "Skill";
    case "model":
      return "Model";
    case "type":
      return "Type";
    case "message":
      return "Message";
  }
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
    case "token_usage":
      return formatTokenUsageLabel(ev.usage) ?? "";
    default:
      return "";
  }
}

function formatRunLogForClipboard(
  events: { nodeId: string; event: AgentRunEvent }[],
  nodeResults: Record<string, SkillExecutionResult>,
  getNodeMeta: (nodeId: string) => RunLogNodeMeta,
): string {
  const lines = events.map((entry) =>
    [
      getNodeMeta(entry.nodeId).skillLabel,
      getNodeMeta(entry.nodeId).model ?? "",
      entry.event.type,
      formatPayload(entry.event),
    ].join("\t"),
  );
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const payload =
      result.exitCode != null
        ? `${result.status} (exit ${result.exitCode})`
        : result.status;
    const usage = result.usage ? formatTokenUsageLabel(result.usage) : null;
    const meta = getNodeMeta(nodeId);
    lines.push(
      [
        meta.skillLabel,
        meta.model ?? "",
        "result",
        usage ? `${payload} · ${usage}` : payload,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function getConfirmedRunTokenUsage(
  events: { nodeId: string; event: AgentRunEvent }[],
  nodeResults: Record<string, SkillExecutionResult>,
): TokenUsage | null {
  const byNode = new Map<string, TokenUsage>();
  for (const entry of events) {
    if (entry.event.type === "token_usage") {
      byNode.set(entry.nodeId, entry.event.usage);
    }
  }
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    if (result.usage) byNode.set(nodeId, result.usage);
  }
  if (byNode.size === 0) return null;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningOutputTokens = 0;
  let hasInput = false;
  let hasOutput = false;
  let hasCached = false;
  let hasReasoning = false;
  for (const usage of byNode.values()) {
    totalTokens += usage.totalTokens;
    if (usage.inputTokens != null) {
      inputTokens += usage.inputTokens;
      hasInput = true;
    }
    if (usage.outputTokens != null) {
      outputTokens += usage.outputTokens;
      hasOutput = true;
    }
    if (usage.cachedInputTokens != null) {
      cachedInputTokens += usage.cachedInputTokens;
      hasCached = true;
    }
    if (usage.reasoningOutputTokens != null) {
      reasoningOutputTokens += usage.reasoningOutputTokens;
      hasReasoning = true;
    }
  }
  return {
    totalTokens,
    ...(hasInput ? { inputTokens } : {}),
    ...(hasOutput ? { outputTokens } : {}),
    ...(hasCached ? { cachedInputTokens } : {}),
    ...(hasReasoning ? { reasoningOutputTokens } : {}),
  };
}

function formatTokenUsageLabel(usage: TokenUsage | null): string | null {
  if (!usage) return null;
  return `${formatTokenCount(usage.totalTokens)} tokens`;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function readRunLogModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatLoopLabel(
  runMode: "dag" | "cycle",
  iteration: number | null,
): string | null {
  if (runMode !== "cycle" || iteration == null) return null;
  return `loop ${iteration}`;
}
