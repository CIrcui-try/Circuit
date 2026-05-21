import type {
  AgentRunEvent,
  SkillExecutionResult,
} from "../runtime/contracts/SkillExecution";
import type { RunLogEntry } from "./runLogStore";

export interface PersistedRunLog {
  events: RunLogEntry[];
  nodeResults: Record<string, SkillExecutionResult>;
}

type PersistedLine =
  | { kind: "event"; nodeId: string; event: AgentRunEvent }
  | { kind: "result"; nodeId: string; result: SkillExecutionResult };

export function serializeRunLogJsonl(
  events: RunLogEntry[],
  nodeResults: Record<string, SkillExecutionResult>,
): string {
  const lines: string[] = [];
  for (const e of events) {
    const payload: PersistedLine = {
      kind: "event",
      nodeId: e.nodeId,
      event: e.event,
    };
    lines.push(JSON.stringify(payload));
  }
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const payload: PersistedLine = { kind: "result", nodeId, result };
    lines.push(JSON.stringify(payload));
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

export function parseRunLogJsonl(jsonl: string): PersistedRunLog {
  const events: RunLogEntry[] = [];
  const nodeResults: Record<string, SkillExecutionResult> = {};
  for (const raw of jsonl.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Partial<PersistedLine> & Record<string, unknown>;
    if (obj.kind === "event" && typeof obj.nodeId === "string" && obj.event) {
      events.push({
        nodeId: obj.nodeId,
        event: obj.event as AgentRunEvent,
      });
    } else if (
      obj.kind === "result" &&
      typeof obj.nodeId === "string" &&
      obj.result
    ) {
      nodeResults[obj.nodeId] = obj.result as SkillExecutionResult;
    }
  }
  return { events, nodeResults };
}
