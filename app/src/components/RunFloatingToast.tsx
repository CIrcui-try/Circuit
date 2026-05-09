import { useState } from "react";
import { Link } from "react-router-dom";
import { cancelWorkflowRun } from "../runner/runController";
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
  const status = useRunStore((s) => s.status);
  const repositoryId = useRunStore((s) => s.repositoryId);
  const repositoryName = useRunStore((s) => s.repositoryName);
  const hasWaitingNode = useRunStore((s) =>
    Object.values(s.nodeStates).some((state) => state === "waiting_input"),
  );
  const [cancelling, setCancelling] = useState(false);

  if (status === "idle") return null;

  const view = VIEWS[status === "running" && hasWaitingNode ? "waiting_input" : status];
  const canAct = status === "running";

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
          <span>
            {repositoryName ? `${view.detail} - ${repositoryName}` : view.detail}
          </span>
        </div>
      </div>
      {canAct ? (
        <div className="run-floating-toast__actions">
          {repositoryId ? (
            <Link
              className="run-floating-toast__link"
              to={`/workspace/${repositoryId}`}
            >
              Go to workflow
            </Link>
          ) : null}
          <button
            type="button"
            className="run-floating-toast__cancel"
            onClick={() => void handleCancel()}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
