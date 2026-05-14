import { useEffect, useRef } from "react";
import { getHostBridge } from "../host/bridge";
import type { RunStatus } from "../runner/runner";
import { useRunStore } from "../runner/runStore";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "success",
  "failed",
  "cancelled",
  "timeout",
]);

const RUN_NOTIFICATION_TITLES: Record<RunStatus, string> = {
  idle: "Workflow idle",
  running: "Workflow running",
  success: "Workflow completed",
  failed: "Workflow failed",
  cancelled: "Workflow cancelled",
  timeout: "Workflow timed out",
};

function buildNotificationBody({
  workflowName,
  repositoryName,
}: {
  workflowName: string | null;
  repositoryName: string | null;
}) {
  if (workflowName && repositoryName) return `${workflowName} in ${repositoryName}`;
  if (workflowName) return workflowName;
  if (repositoryName) return repositoryName;
  return "Circuit workflow run finished.";
}

export function AppRunCompletionNotification() {
  const status = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);
  const workflowName = useRunStore((s) => s.workflowName);
  const repositoryId = useRunStore((s) => s.repositoryId);
  const repositoryName = useRunStore((s) => s.repositoryName);
  const notifiedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runId || status === "idle" || status === "running") {
      if (!runId || status === "idle") {
        notifiedRunIdRef.current = null;
      }
      return;
    }

    if (!TERMINAL_RUN_STATUSES.has(status)) return;
    if (notifiedRunIdRef.current === runId) return;

    let active = true;

    void (async () => {
      const focused = (await getHostBridge().isAppWindowFocused?.()) ?? true;
      if (!active) return;
      notifiedRunIdRef.current = runId;
      if (focused) return;

      await getHostBridge().notifyRunFinished?.({
        title: RUN_NOTIFICATION_TITLES[status],
        body: buildNotificationBody({ workflowName, repositoryName }),
        ...(repositoryId ? { repositoryId } : {}),
      });
    })().catch((error: unknown) => {
      console.warn("[AppRunCompletionNotification] failed to send notification", error);
    });

    return () => {
      active = false;
    };
  }, [repositoryId, repositoryName, runId, status, workflowName]);

  return null;
}
