import type { CliResolveResult, RuntimeBridge } from "../bridge/RuntimeBridge";
import {
  cliResolveError,
  resolveCliCommand,
} from "../bridge/resolveCliCommand";

export type CliProbeReason =
  | "missing"
  | "non-zero"
  | "timeout"
  | "cancelled"
  | "error";

export interface CliProbeResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stdoutFirstLine: string;
  stderr: string;
  resolve?: CliResolveResult;
  reason?: CliProbeReason;
  errorMessage?: string;
  durationMs: number;
}

export type CliProbeStage =
  | "subscribing"
  | "awaiting-listener"
  | "spawning"
  | "awaiting-output";

export interface ProbeCliOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  runId?: string;
  onStage?: (stage: CliProbeStage) => void;
}

const DEFAULT_TIMEOUT_MS = 3000;

const MISSING_HINTS = [
  "enoent",
  "no such file",
  "not found",
  "command not found",
];

function classifyErrorMessage(message: string): CliProbeReason {
  const lower = message.toLowerCase();
  if (MISSING_HINTS.some((hint) => lower.includes(hint))) {
    return "missing";
  }
  return "error";
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  if (idx === -1) return text.trim();
  return text.slice(0, idx).trim();
}

let counter = 0;
function nextRunId(command: string): string {
  counter += 1;
  return `cli-probe::${command}::${Date.now()}::${counter}`;
}

export function probeCli(
  bridge: RuntimeBridge,
  command: string,
  args: string[],
  opts: ProbeCliOptions,
): Promise<CliProbeResult> {
  const runId = opts.runId ?? nextRunId(command);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<CliProbeResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let cliResolve: CliResolveResult | undefined;
    let settled = false;

    // Diagnostic stages — included in fail-safe error message so we can tell
    // whether the bridge handshake or the spawn invoke is the culprit when
    // events go missing in the wild.
    const stages = {
      subscribed: false,
      ready: false,
      spawnCalled: false,
      spawnResolved: false,
      spawnRejected: false,
      anyEvent: false,
    };

    const finish = (result: Omit<CliProbeResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(failSafe);
      unsubscribe();
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const failSafe = setTimeout(() => {
      const message = `probe timed out after ${timeoutMs}ms (stages: ${JSON.stringify(stages)})`;
      // Surface the diagnostic dump in dev tools so it's copyable even when the
      // panel truncates the row.
      if (typeof console !== "undefined") {
        console.warn(`[probeCli] ${command} ${args.join(" ")} — ${message}`);
      }
      finish({
        ok: false,
        exitCode: null,
        stdout,
        stdoutFirstLine: firstLine(stdout),
        stderr,
        resolve: cliResolve,
        reason: "timeout",
        errorMessage: message,
      });
    }, timeoutMs + 500);

    const unsubscribe = bridge.subscribe(runId, (ev) => {
      stages.anyEvent = true;
      switch (ev.type) {
        case "stdout":
          stdout += ev.text;
          return;
        case "stderr":
          stderr += ev.text;
          return;
        case "exited": {
          const exitCode = ev.exitCode;
          const ok = exitCode === 0;
          finish({
            ok,
            exitCode,
            stdout,
            stdoutFirstLine: firstLine(stdout),
            stderr,
            resolve: cliResolve,
            reason: ok ? undefined : "non-zero",
            errorMessage: ok ? undefined : stderr.trim() || `exit ${exitCode}`,
          });
          return;
        }
        case "error":
          finish({
            ok: false,
            exitCode: null,
            stdout,
            stdoutFirstLine: firstLine(stdout),
            stderr,
            resolve: cliResolve,
            reason: classifyErrorMessage(ev.message),
            errorMessage: ev.message,
          });
          return;
        case "timeout":
          finish({
            ok: false,
            exitCode: null,
            stdout,
            stdoutFirstLine: firstLine(stdout),
            stderr,
            resolve: cliResolve,
            reason: "timeout",
            errorMessage: `probe timed out after ${timeoutMs}ms`,
          });
          return;
        case "cancelled":
          finish({
            ok: false,
            exitCode: null,
            stdout,
            stdoutFirstLine: firstLine(stdout),
            stderr,
            resolve: cliResolve,
            reason: "cancelled",
            errorMessage: "probe cancelled",
          });
          return;
        default:
          return;
      }
    });

    const reportStage = (stage: CliProbeStage) => {
      if (settled) return;
      opts.onStage?.(stage);
    };

    stages.subscribed = true;
    reportStage("awaiting-listener");

    unsubscribe.ready
      .then(async () => {
        stages.ready = true;
        stages.spawnCalled = true;
        reportStage("spawning");
        const resolved = await resolveCliCommand(bridge, command);
        cliResolve = resolved.resolve;
        if (cliResolve && !cliResolve.ok) {
          finish({
            ok: false,
            exitCode: null,
            stdout,
            stdoutFirstLine: firstLine(stdout),
            stderr,
            resolve: cliResolve,
            reason: cliResolve.attempts.some(
              (attempt) => attempt.source === "manualOverride" && !attempt.ok,
            )
              ? "error"
              : "missing",
            errorMessage: cliResolveError(cliResolve),
          });
          return;
        }
        return bridge.spawn({
          runId,
          command: resolved.command,
          args,
          cwd: opts.cwd,
          env: opts.env,
          timeoutMs,
        });
      })
      .then(() => {
        stages.spawnResolved = true;
        reportStage("awaiting-output");
      })
      .catch((err: unknown) => {
        stages.spawnRejected = true;
        const message = err instanceof Error ? err.message : String(err);
        finish({
          ok: false,
          exitCode: null,
          stdout,
          stdoutFirstLine: firstLine(stdout),
          stderr,
          resolve: cliResolve,
          reason: classifyErrorMessage(message),
          errorMessage: message,
        });
      });
  });
}
