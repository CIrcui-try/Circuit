import { create } from "zustand";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import {
  probeCli,
  type CliProbeResult,
  type CliProbeStage,
} from "../runtime/probe/probeCli";

export type CliId = "claude" | "codex";

export type CliStatus =
  | "idle"
  | "checking"
  | "ok"
  | "missing"
  | "error";

export interface CliEntry {
  status: CliStatus;
  version?: string;
  errorMessage?: string;
  detailLog?: string;
  durationMs?: number;
  checkedAt?: number;
  /** Live progress label while status === "checking". */
  progressLabel?: string;
}

const STAGE_LABELS: Record<CliProbeStage, string> = {
  subscribing: "Preparing listener...",
  "awaiting-listener": "Registering listener...",
  spawning: "Starting process...",
  "awaiting-output": "Waiting for output...",
};

const PROBE_COMMANDS: Record<CliId, { command: string; args: string[] }> = {
  claude: { command: "claude", args: ["--version"] },
  codex: { command: "codex", args: ["--version"] },
};

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CWD = "/";

const INITIAL_ENTRY: CliEntry = { status: "idle" };

interface ProbeMeta {
  id: CliId;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface RunChecksOptions {
  bridge?: RuntimeBridge;
  cwd?: string;
  timeoutMs?: number;
}

interface CliStatusState {
  entries: Record<CliId, CliEntry>;
  isChecking: boolean;
  runChecks: (opts?: RunChecksOptions) => Promise<void>;
}

function formatTextBlock(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed || "(empty)";
}

function commandLine(meta: ProbeMeta): string {
  return [meta.command, ...meta.args].join(" ");
}

function formatDetailLog(
  meta: ProbeMeta,
  result: CliProbeResult,
  status: CliStatus,
  now: number,
): string {
  return [
    `CLI: ${meta.id}`,
    `Command: ${commandLine(meta)}`,
    `CWD: ${meta.cwd}`,
    `Timeout: ${meta.timeoutMs}ms`,
    `Duration: ${result.durationMs}ms`,
    `Checked At: ${new Date(now).toISOString()}`,
    `Status: ${status}`,
    `Reason: ${result.reason ?? "unknown"}`,
    `Exit Code: ${result.exitCode ?? "null"}`,
    `Error: ${result.errorMessage ?? "(none)"}`,
    "",
    "STDOUT:",
    formatTextBlock(result.stdout),
    "",
    "STDERR:",
    formatTextBlock(result.stderr),
  ].join("\n");
}

function mapResult(
  meta: ProbeMeta,
  result: CliProbeResult,
  now: number,
): CliEntry {
  if (result.ok) {
    return {
      status: "ok",
      version: result.stdoutFirstLine || undefined,
      durationMs: result.durationMs,
      checkedAt: now,
    };
  }
  const status: CliStatus = result.reason === "missing" ? "missing" : "error";
  return {
    status,
    errorMessage:
      result.errorMessage ?? `probe failed (${result.reason ?? "unknown"})`,
    detailLog: formatDetailLog(meta, result, status, now),
    durationMs: result.durationMs,
    checkedAt: now,
  };
}

export const useCliStatusStore = create<CliStatusState>((set, get) => ({
  entries: { claude: { ...INITIAL_ENTRY }, codex: { ...INITIAL_ENTRY } },
  isChecking: false,

  runChecks: async (opts) => {
    if (get().isChecking) return;

    const bridge = opts?.bridge ?? getRuntimeBridge();
    const cwd = opts?.cwd ?? DEFAULT_CWD;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    set({
      isChecking: true,
      entries: {
        claude: { status: "checking", progressLabel: STAGE_LABELS.subscribing },
        codex: { status: "checking", progressLabel: STAGE_LABELS.subscribing },
      },
    });

    const ids: CliId[] = ["claude", "codex"];
    const metas = ids.map((id): ProbeMeta => ({
      id,
      command: PROBE_COMMANDS[id].command,
      args: PROBE_COMMANDS[id].args,
      cwd,
      timeoutMs,
    }));
    const results = await Promise.all(
      metas.map((meta) =>
        probeCli(bridge, meta.command, meta.args, {
          cwd,
          timeoutMs,
          onStage: (stage) => {
            const current = get().entries;
            set({
              entries: {
                ...current,
                [meta.id]: {
                  ...current[meta.id],
                  status: "checking",
                  progressLabel: STAGE_LABELS[stage],
                },
              },
            });
          },
        }),
      ),
    );

    const now = Date.now();
    set({
      isChecking: false,
      entries: {
        claude: mapResult(metas[0], results[0], now),
        codex: mapResult(metas[1], results[1], now),
      },
    });
  },
}));
