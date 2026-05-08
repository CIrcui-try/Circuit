import { detectApprovalPromptsInChunk } from "../bridge/approvalProtocol";
import type { RuntimeBridge, RuntimeProcessEvent } from "../bridge/RuntimeBridge";
import type {
  AdapterAvailability,
  AgentRunEvent,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";

export interface BridgeCommand {
  command: string;
  args: string[];
}

export interface ProbeViaBridgeOptions {
  bridge: RuntimeBridge;
  ctx: SkillExecutionContext;
  runId: string;
  command: BridgeCommand;
  timeoutMs: number;
}

export function probeViaBridge(
  opts: ProbeViaBridgeOptions,
): Promise<AdapterAvailability> {
  const { bridge, ctx, runId, command, timeoutMs } = opts;
  const { command: cmd, args } = command;

  return new Promise<AdapterAvailability>((resolve) => {
    let settled = false;
    const finish = (result: AdapterAvailability) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = bridge.subscribe(runId, (ev) => {
      switch (ev.type) {
        case "exited":
          if (ev.exitCode === 0) {
            finish({ ok: true, details: { command: cmd, args } });
          } else {
            finish({
              ok: false,
              reason: `probe exited with code ${ev.exitCode}`,
              details: { command: cmd, args, exitCode: ev.exitCode },
            });
          }
          return;
        case "error":
          finish({
            ok: false,
            reason: `spawn error: ${ev.message}`,
            details: { command: cmd, args },
          });
          return;
        case "timeout":
          finish({
            ok: false,
            reason: "probe timed out",
            details: { command: cmd, args },
          });
          return;
        case "cancelled":
          finish({
            ok: false,
            reason: "probe cancelled",
            details: { command: cmd, args },
          });
          return;
        default:
          return;
      }
    });

    unsubscribe.ready
      .then(() =>
        bridge.spawn({
          runId,
          command: cmd,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs,
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        finish({
          ok: false,
          reason: `spawn rejected: ${message}`,
          details: { command: cmd, args },
        });
      });
  });
}

export interface RunViaBridgeOptions {
  bridge: RuntimeBridge;
  ctx: SkillExecutionContext;
  runId: string;
  command: BridgeCommand;
  sink: AgentRunEventSink;
}

export function runViaBridge(
  opts: RunViaBridgeOptions,
): Promise<SkillExecutionResult> {
  const { bridge, ctx, runId, command, sink } = opts;
  const { command: cmd, args } = command;
  const startedAt = new Date().toISOString();

  const logs: AgentRunEvent[] = [];
  const emit = (ev: AgentRunEvent) => {
    logs.push(ev);
    sink(ev);
  };

  return new Promise<SkillExecutionResult>((resolve) => {
    let settled = false;
    const finish = (
      partial: Pick<SkillExecutionResult, "status" | "exitCode">,
    ) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve({
        status: partial.status,
        exitCode: partial.exitCode,
        logs,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    };

    const unsubscribe = bridge.subscribe(runId, (ev: RuntimeProcessEvent) => {
      switch (ev.type) {
        case "started":
          emit({
            type: "start",
            timestamp: ev.timestamp,
            message: `spawn ${cmd}`,
            command: cmd,
            args,
            spawnType: "process",
          });
          return;
        case "stdout":
          emit({ type: "stdout", timestamp: ev.timestamp, text: ev.text });
          return;
        case "stderr": {
          emit({ type: "stderr", timestamp: ev.timestamp, text: ev.text });
          // Heuristic approval detection runs on the JS side so adapters never
          // need to know about it. Each match becomes its own non-terminal
          // approval_required event so multi-prompt sessions surface every
          // request.
          const approvals = detectApprovalPromptsInChunk(ev.text);
          for (const detected of approvals) {
            emit({
              type: "approval_required",
              timestamp: ev.timestamp,
              requestId: detected.requestId,
              prompt: detected.prompt,
              approvalKind: detected.kind,
            });
          }
          return;
        }
        case "approvalRequest":
          // Non-terminal: the child is still running and waiting for the user
          // to call bridge.sendInput(runId, response). We surface the prompt
          // through the sink so the UI can render it; the run promise stays
          // pending until the eventual exited / cancelled / timeout event.
          emit({
            type: "approval_required",
            timestamp: ev.timestamp,
            requestId: ev.requestId,
            prompt: ev.prompt,
            approvalKind: ev.kind,
          });
          return;
        case "exited": {
          const exitCode = ev.exitCode ?? undefined;
          emit({ type: "finish", timestamp: ev.timestamp, exitCode });
          finish({
            status: ev.exitCode === 0 ? "success" : "failed",
            exitCode,
          });
          return;
        }
        case "cancelled":
          emit({ type: "error", timestamp: ev.timestamp, message: "cancelled" });
          finish({ status: "cancelled" });
          return;
        case "timeout":
          emit({ type: "error", timestamp: ev.timestamp, message: "timeout" });
          finish({ status: "timeout" });
          return;
        case "error":
          emit({ type: "error", timestamp: ev.timestamp, message: ev.message });
          finish({ status: "failed" });
          return;
        default:
          return;
      }
    });

    unsubscribe.ready
      .then(() =>
        bridge.spawn({
          runId,
          command: cmd,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs: ctx.execution.timeoutMs,
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        emit({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `spawn rejected: ${message}`,
        });
        finish({ status: "failed" });
      });
  });
}
