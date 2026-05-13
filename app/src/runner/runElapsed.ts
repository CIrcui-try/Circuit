import { useEffect, useState } from "react";
import type { RunStatus } from "./runner";
import { useRunStore } from "./runStore";

const SECOND_MS = 1000;

export function formatElapsed(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(secs)}`;
  }
  return `${minutes}:${pad2(secs)}`;
}

export function getRunElapsedLabel({
  status,
  startedAt,
  finishedAt,
  now = Date.now(),
}: {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  now?: number;
}): string | null {
  if (status === "idle" || !startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;

  const end =
    status === "running"
      ? now
      : finishedAt
        ? Date.parse(finishedAt)
        : Number.NaN;
  if (!Number.isFinite(end) || end < start) return null;
  return formatElapsed((end - start) / SECOND_MS);
}

export function useRunElapsedLabel(repositoryId?: string | null): string | null {
  const record = useRunStore((s) =>
    repositoryId ? s.getRunForRepository(repositoryId) : s,
  );
  const { status, startedAt, finishedAt } = record;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "running") return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => window.clearInterval(id);
  }, [status, startedAt]);

  return getRunElapsedLabel({ status, startedAt, finishedAt, now });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
