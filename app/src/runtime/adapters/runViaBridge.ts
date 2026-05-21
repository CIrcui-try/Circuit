import { detectApprovalPromptsInChunk } from "../bridge/approvalProtocol";
import type { RuntimeBridge, RuntimeProcessEvent } from "../bridge/RuntimeBridge";
import {
  cliResolveError,
  resolveCliCommand,
} from "../bridge/resolveCliCommand";
import type {
  AdapterAvailability,
  AgentRunEvent,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";

const STDIN_WAITING_RE = /Reading additional input from stdin/i;
const CIRCUIT_SUMMARY_RE = /^CIRCUIT_SUMMARY:\s*(.+)$/i;
const FAILURE_SUMMARY_RE =
  /(실패|중단|차단|불가|오류|에러|실행할 수 없어|할 수 없어|부재|진행 방향.*(?:묻|대기)|사용자(?:에게)?.*(?:묻|확인|입력|대기)|(?:승인|확인)(?:이|가)?\s*필요|failed|failure|blocked|aborted|stopped|cannot|could not|unable|invalid|error|needs? user input|requires? approval)/i;

export interface BridgeCommand {
  command: string;
  args: string[];
  stdinMode?: "piped" | "null";
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
      .then(async () => {
        const resolved = await resolveCliCommand(bridge, cmd);
        if (resolved.resolve && !resolved.resolve.ok) {
          finish({
            ok: false,
            reason: `CLI resolve failed: ${cliResolveError(resolved.resolve)}`,
            details: {
              command: cmd,
              args,
              resolve: resolved.resolve,
            },
          });
          return;
        }
        return bridge.spawn({
          runId,
          command: resolved.command,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs,
          stdinMode: command.stdinMode,
        });
      })
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
  let spawnCommand = cmd;
  const startedAt = new Date().toISOString();

  const logs: AgentRunEvent[] = [];
  let summary: string | undefined;
  const emit = (ev: AgentRunEvent) => {
    logs.push(ev);
    sink(ev);
  };
  const recordSummary = (text: string) => {
    const extracted = extractCircuitSummary(text);
    if (extracted != null) summary = extracted;
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
        summary,
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
            message: `spawn ${spawnCommand}`,
            command: spawnCommand,
            args,
            spawnType: "process",
          });
          return;
        case "stdout":
          emit({ type: "stdout", timestamp: ev.timestamp, text: ev.text });
          recordSummary(ev.text);
          return;
        case "stderr": {
          emit({ type: "stderr", timestamp: ev.timestamp, text: ev.text });
          recordSummary(ev.text);
          if (STDIN_WAITING_RE.test(ev.text)) {
            void bridge.closeInput(runId).catch((err: unknown) => {
              if (settled) return;
              const message = err instanceof Error ? err.message : String(err);
              emit({
                type: "error",
                timestamp: new Date().toISOString(),
                message: `stdin close failed: ${message}`,
              });
            });
          }
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
          const semanticFailure = ev.exitCode === 0 && isFailureSummary(summary);
          if (semanticFailure) {
            emit({
              type: "status",
              timestamp: ev.timestamp,
              status:
                "semantic failure: CIRCUIT_SUMMARY reported a blocker even though the process exited with code 0",
            });
          }
          emit({ type: "finish", timestamp: ev.timestamp, exitCode });
          finish({
            status: ev.exitCode === 0 && !semanticFailure ? "success" : "failed",
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
      .then(async () => {
        const resolved = await resolveCliCommand(bridge, cmd);
        if (resolved.resolve && !resolved.resolve.ok) {
          emit({
            type: "error",
            timestamp: new Date().toISOString(),
            message: `CLI resolve failed: ${cliResolveError(resolved.resolve)}`,
          });
          finish({ status: "failed" });
          return;
        }
        spawnCommand = resolved.command;
        return bridge.spawn({
          runId,
          command: spawnCommand,
          args,
          cwd: ctx.execution.cwd,
          env: ctx.execution.env,
          timeoutMs: ctx.execution.timeoutMs,
          stdinMode: command.stdinMode,
        });
      })
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

function extractCircuitSummary(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = CIRCUIT_SUMMARY_RE.exec(lines[i].trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function isFailureSummary(summary: string | undefined): boolean {
  return summary != null && FAILURE_SUMMARY_RE.test(summary);
}
