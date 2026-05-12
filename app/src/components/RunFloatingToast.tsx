import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cancelWorkflowRun } from "../runner/runController";
import { useRunElapsedLabel } from "../runner/runElapsed";
import { useRunStore } from "../runner/runStore";
import type { RunStatus } from "../runner/runner";

type ToastView = {
  label: string;
  detail: string;
  tone: "active" | "success" | "danger" | "neutral";
};

const VIEWS: Record<Exclude<RunStatus, "idle"> | "waiting_input", ToastView> = {
  running: {
    label: "Running",
    detail: "Workflow is running",
    tone: "active",
  },
  waiting_input: {
    label: "Needs input",
    detail: "Respond in the workflow log",
    tone: "active",
  },
  success: {
    label: "Success",
    detail: "Workflow completed",
    tone: "success",
  },
  failed: {
    label: "Failed",
    detail: "Workflow stopped with an error",
    tone: "danger",
  },
  cancelled: {
    label: "Cancelled",
    detail: "Workflow was cancelled",
    tone: "neutral",
  },
  timeout: {
    label: "Timed out",
    detail: "Workflow exceeded its time limit",
    tone: "danger",
  },
};

export function RunFloatingToast() {
  const location = useLocation();
  const status = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);
  const repositoryId = useRunStore((s) => s.repositoryId);
  const repositoryName = useRunStore((s) => s.repositoryName);
  const runMode = useRunStore((s) => s.runMode);
  const iteration = useRunStore((s) => s.iteration);
  const elapsedLabel = useRunElapsedLabel();
  const hasWaitingNode = useRunStore((s) =>
    Object.values(s.nodeStates).some((state) => state === "waiting_input"),
  );
  const [cancelling, setCancelling] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);

  if (status === "idle") return null;
  if (status !== "running" && runId && dismissedRunId === runId) return null;
  if (isViewingRunWorkflow(location.pathname, repositoryId)) {
    return null;
  }

  const view = VIEWS[status === "running" && hasWaitingNode ? "waiting_input" : status];
  const canGoToWorkflow = Boolean(repositoryId) && (status === "running" || status === "success");
  const canCancel = status === "running";
  const isActive = status === "running";
  const canDismiss = !isActive && Boolean(runId);
  const detail = formatToastDetail(
    view.detail,
    formatLoopLabel(runMode, iteration),
    repositoryName,
    elapsedLabel,
  );

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelWorkflowRun();
    } finally {
      if (useRunStore.getState().status === "running") setCancelling(false);
    }
  }

  return (
    <aside
      className={`run-floating-toast run-floating-toast--${view.tone}`}
      aria-live="polite"
      data-testid="run-floating-toast"
    >
      <div className="run-floating-toast__status">
        <span className="run-floating-toast__dot" aria-hidden="true" />
        <div className="run-floating-toast__copy">
          <strong>{view.label}</strong>
          <span>{detail}</span>
        </div>
      </div>
      {canGoToWorkflow || canCancel ? (
        <div className="run-floating-toast__actions">
          {canGoToWorkflow && repositoryId ? (
            <Link
              className="run-floating-toast__link"
              to={`/workspace/${repositoryId}`}
            >
              Go to workflow
            </Link>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              className="run-floating-toast__cancel"
              onClick={() => void handleCancel()}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      ) : null}
      {isActive ? (
        <span
          className="run-floating-toast__progress"
          data-testid="run-floating-toast-progress"
          aria-hidden="true"
        />
      ) : null}
      {canDismiss ? (
        <button
          type="button"
          className="run-floating-toast__dismiss"
          aria-label="Dismiss run notification"
          onClick={() => setDismissedRunId(runId)}
        >
          x
        </button>
      ) : null}
    </aside>
  );
}

function formatToastDetail(
  detail: string,
  loopLabel: string | null,
  repositoryName: string | null,
  elapsedLabel: string | null,
): string {
  return [detail, loopLabel, elapsedLabel, repositoryName].filter(Boolean).join(" · ");
}

function formatLoopLabel(
  runMode: "dag" | "cycle",
  iteration: number | null,
): string | null {
  if (runMode !== "cycle" || iteration == null) return null;
  return `loop ${iteration}`;
}

function isViewingRunWorkflow(pathname: string, repositoryId: string | null): boolean {
  if (!repositoryId) return false;
  const basePath = `/workspace/${repositoryId}`;
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === basePath || normalized.startsWith(`${basePath}/`);
}
