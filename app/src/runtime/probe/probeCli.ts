import type { RuntimeBridge } from "../bridge/RuntimeBridge";

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
  reason?: CliProbeReason;
  errorMessage?: string;
  durationMs: number;
}

export interface ProbeCliOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  runId?: string;
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
    let settled = false;

    const finish = (result: Omit<CliProbeResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const unsubscribe = bridge.subscribe(runId, (ev) => {
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
            reason: "cancelled",
            errorMessage: "probe cancelled",
          });
          return;
        default:
          return;
      }
    });

    bridge
      .spawn({
        runId,
        command,
        args,
        cwd: opts.cwd,
        env: opts.env,
        timeoutMs,
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        finish({
          ok: false,
          exitCode: null,
          stdout,
          stdoutFirstLine: firstLine(stdout),
          stderr,
          reason: classifyErrorMessage(message),
          errorMessage: message,
        });
      });
  });
}
