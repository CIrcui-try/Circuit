import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentRunEvent,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";
import { useRunLogStore } from "./runLogStore";

const start = (message = "spawn"): AgentRunEvent => ({
  type: "start",
  timestamp: "t0",
  message,
});
const stdout = (text: string): AgentRunEvent => ({
  type: "stdout",
  timestamp: "t1",
  text,
});

const result = (over: Partial<SkillExecutionResult> = {}): SkillExecutionResult => ({
  status: "success",
  logs: [],
  startedAt: "t0",
  finishedAt: "t1",
  ...over,
});

beforeEach(() => {
  useRunLogStore.getState().reset();
});

describe("runLogStore", () => {
  it("L1: beginRun resets events / nodeEvents / nodeResults and sets runId", () => {
    useRunLogStore.getState().appendEvent("a", stdout("stale"));
    useRunLogStore.getState().setNodeResult("a", result());

    useRunLogStore.getState().beginRun({ runId: "run_1", workflowId: "wf" });

    const s = useRunLogStore.getState();
    expect(s.runId).toBe("run_1");
    expect(s.workflowId).toBe("wf");
    expect(s.events).toEqual([]);
    expect(s.nodeEvents).toEqual({});
    expect(s.nodeResults).toEqual({});
  });

  it("L2: appendEvent pushes to global events and per-node nodeEvents in order", () => {
    const e1 = start("spawn claude");
    const e2 = stdout("hello");
    const e3 = stdout("world");

    useRunLogStore.getState().appendEvent("a", e1);
    useRunLogStore.getState().appendEvent("b", e2);
    useRunLogStore.getState().appendEvent("a", e3);

    const s = useRunLogStore.getState();
    expect(s.events).toEqual([
      { nodeId: "a", event: e1 },
      { nodeId: "b", event: e2 },
      { nodeId: "a", event: e3 },
    ]);
    expect(s.nodeEvents).toEqual({ a: [e1, e3], b: [e2] });
  });

  it("L3: setNodeResult writes to nodeResults without touching other nodes", () => {
    const ra = result({ status: "success", exitCode: 0 });
    const rb = result({ status: "failed", exitCode: 2 });

    useRunLogStore.getState().setNodeResult("a", ra);
    useRunLogStore.getState().setNodeResult("b", rb);

    expect(useRunLogStore.getState().nodeResults).toEqual({ a: ra, b: rb });
  });

  it("L4: reset returns to initial state", () => {
    useRunLogStore.getState().beginRun({ runId: "run_1", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("a", stdout("x"));
    useRunLogStore.getState().setNodeResult("a", result());

    useRunLogStore.getState().reset();

    const s = useRunLogStore.getState();
    expect(s.runId).toBeNull();
    expect(s.workflowId).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.nodeEvents).toEqual({});
    expect(s.nodeResults).toEqual({});
  });
});
