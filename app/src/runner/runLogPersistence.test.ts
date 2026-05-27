import { describe, expect, it } from "vitest";
import type {
  AgentRunEvent,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";
import {
  parseRunLogJsonl,
  serializeRunLogJsonl,
} from "./runLogPersistence";
import type { RunLogEntry } from "./runLogStore";

const startEvent: AgentRunEvent = {
  type: "start",
  timestamp: "2026-05-06T00:00:00Z",
  message: "spawn",
};
const stdoutEvent: AgentRunEvent = {
  type: "stdout",
  timestamp: "2026-05-06T00:00:01Z",
  text: "hello",
};
const tokenUsageEvent: AgentRunEvent = {
  type: "token_usage",
  timestamp: "2026-05-06T00:00:01Z",
  usage: { totalTokens: 22708 },
};
const result: SkillExecutionResult = {
  status: "success",
  exitCode: 0,
  usage: { totalTokens: 22708 },
  logs: [],
  startedAt: "2026-05-06T00:00:00Z",
  finishedAt: "2026-05-06T00:00:02Z",
};

describe("runLogPersistence", () => {
  it("P1: serialize empty input returns empty string", () => {
    expect(serializeRunLogJsonl([], {})).toBe("");
  });

  it("P2: round-trips events and results", () => {
    const events: RunLogEntry[] = [
      { nodeId: "a", event: startEvent },
      { nodeId: "a", event: stdoutEvent },
      { nodeId: "a", event: tokenUsageEvent },
    ];
    const nodeResults: Record<string, SkillExecutionResult> = { a: result };

    const jsonl = serializeRunLogJsonl(events, nodeResults);
    const parsed = parseRunLogJsonl(jsonl);

    expect(parsed.events).toEqual(events);
    expect(parsed.nodeResults).toEqual(nodeResults);
  });

  it("P3: produces newline-terminated JSON lines", () => {
    const jsonl = serializeRunLogJsonl([{ nodeId: "x", event: startEvent }], {});
    expect(jsonl.endsWith("\n")).toBe(true);
    expect(jsonl.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
  });

  it("P4: skips malformed and blank lines", () => {
    const jsonl = [
      JSON.stringify({ kind: "event", nodeId: "a", event: startEvent }),
      "this is not json",
      "",
      "{ broken",
      JSON.stringify({ kind: "result", nodeId: "a", result }),
    ].join("\n");

    const parsed = parseRunLogJsonl(jsonl);
    expect(parsed.events).toEqual([{ nodeId: "a", event: startEvent }]);
    expect(parsed.nodeResults).toEqual({ a: result });
  });

  it("P5: ignores lines with unknown kind or missing nodeId", () => {
    const jsonl = [
      JSON.stringify({ kind: "event", event: startEvent }), // missing nodeId
      JSON.stringify({ kind: "noise", nodeId: "z" }),
      JSON.stringify({ kind: "result", nodeId: "a", result }),
    ].join("\n");

    const parsed = parseRunLogJsonl(jsonl);
    expect(parsed.events).toEqual([]);
    expect(parsed.nodeResults).toEqual({ a: result });
  });
});
