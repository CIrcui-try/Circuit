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

function setAppIconRunBadgeCount(count: number) {
  const setBadgeCount = getHostBridge().setAppIconRunBadgeCount;
  if (!setBadgeCount) return;

  void setBadgeCount(count).catch((error: unknown) => {
    console.warn("[AppIconRunBadge] failed to update app icon badge", error);
  });
}

export function AppIconRunBadge() {
  const status = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);
  const unseenCountRef = useRef(0);
  const countedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const observeFocus = getHostBridge().onAppWindowFocusChanged;
    if (!observeFocus) return;

    let active = true;
    let unlisten: (() => void) | null = null;

    void observeFocus((focused) => {
      if (!focused) return;
      unseenCountRef.current = 0;
      setAppIconRunBadgeCount(0);
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
      if (status === "running") countedRunIdRef.current = null;
      if (!runId || status === "idle") {
        unseenCountRef.current = 0;
        countedRunIdRef.current = null;
      }
      setAppIconRunBadgeCount(unseenCountRef.current);
      return;
    }

    if (!TERMINAL_RUN_STATUSES.has(status)) return;
    if (countedRunIdRef.current === runId) return;

    let active = true;

    void (async () => {
      const focused = (await getHostBridge().isAppWindowFocused?.()) ?? false;
      if (!active) return;
      countedRunIdRef.current = runId;
      if (focused) {
        setAppIconRunBadgeCount(0);
        return;
      }
      unseenCountRef.current += 1;
      setAppIconRunBadgeCount(unseenCountRef.current);
    })().catch((error: unknown) => {
      console.warn("[AppIconRunBadge] failed to read app focus", error);
      if (!active) return;
      countedRunIdRef.current = runId;
      unseenCountRef.current += 1;
      setAppIconRunBadgeCount(unseenCountRef.current);
    });

    return () => {
      active = false;
    };
  }, [runId, status]);

  return null;
}
