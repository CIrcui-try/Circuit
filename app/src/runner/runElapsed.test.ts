import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatElapsed,
  getRunElapsedLabel,
  useRunElapsedLabel,
} from "./runElapsed";
import { useRunStore } from "./runStore";

beforeEach(() => {
  useRunStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runElapsed", () => {
  it("formats short elapsed durations", () => {
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(754)).toBe("12:34");
    expect(formatElapsed(3723)).toBe("1:02:03");
  });

  it("returns null for invalid timestamps and negative durations", () => {
    expect(
      getRunElapsedLabel({
        status: "running",
        startedAt: "not-a-date",
        finishedAt: null,
        now: Date.parse("2026-05-09T00:00:05.000Z"),
      }),
    ).toBeNull();
    expect(
      getRunElapsedLabel({
        status: "success",
        startedAt: "2026-05-09T00:00:05.000Z",
        finishedAt: "bad",
      }),
    ).toBeNull();
    expect(
      getRunElapsedLabel({
        status: "success",
        startedAt: "2026-05-09T00:00:05.000Z",
        finishedAt: "2026-05-09T00:00:04.000Z",
      }),
    ).toBeNull();
  });

  it("updates running elapsed once per second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T00:00:00.000Z"));
    useRunStore.getState().beginRun({
      runId: "run-1",
      workflowId: "wf-1",
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:00.000Z",
    });

    const { result } = renderHook(() => useRunElapsedLabel());

    expect(result.current).toBe("0:00");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe("0:01");
  });

  it("keeps terminal elapsed fixed at finishedAt", () => {
    useRunStore.setState({
      status: "success",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: null,
      repositoryId: null,
      repositoryName: null,
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:05.000Z",
      activeNodeId: null,
      nodeStates: { "node-1": "success" },
      nodeDebug: {},
      snapshot: null,
    });

    const { result } = renderHook(() => useRunElapsedLabel());

    expect(result.current).toBe("0:05");
  });
});
