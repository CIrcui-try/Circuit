import { useEffect } from "react";
import { getHostBridge } from "../host/bridge";
import type { RunStatus } from "../runner/runner";
import { useRunStore } from "../runner/runStore";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "success",
  "failed",
  "cancelled",
  "timeout",
]);

function setAppIconRunBadge(active: boolean) {
  const setBadge = getHostBridge().setAppIconRunBadge;
  if (!setBadge) return;

  void setBadge(active).catch((error: unknown) => {
    console.warn("[AppIconRunBadge] failed to update app icon badge", error);
  });
}

export function AppIconRunBadge() {
  const status = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);

  useEffect(() => {
    const observeFocus = getHostBridge().onAppWindowFocusChanged;
    if (!observeFocus) return;

    let active = true;
    let unlisten: (() => void) | null = null;

    void observeFocus((focused) => {
      if (focused) setAppIconRunBadge(false);
    })
      .then((nextUnlisten) => {
        if (active) {
          unlisten = nextUnlisten ?? null;
        } else {
          nextUnlisten?.();
        }
      })
      .catch((error: unknown) => {
        console.warn("[AppIconRunBadge] failed to observe app focus", error);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!runId || status === "idle" || status === "running") {
      setAppIconRunBadge(false);
      return;
    }

    if (!TERMINAL_RUN_STATUSES.has(status)) return;

    let active = true;

    void (async () => {
      const focused = (await getHostBridge().isAppWindowFocused?.()) ?? false;
      if (!active) return;
      setAppIconRunBadge(!focused);
    })().catch((error: unknown) => {
      console.warn("[AppIconRunBadge] failed to read app focus", error);
      if (active) setAppIconRunBadge(true);
    });

    return () => {
      active = false;
    };
  }, [runId, status]);

  return null;
}
