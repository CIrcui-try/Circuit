import { create } from "zustand";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import { probeCli, type CliProbeResult } from "../runtime/probe/probeCli";

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
  durationMs?: number;
  checkedAt?: number;
}

const PROBE_COMMANDS: Record<CliId, { command: string; args: string[] }> = {
  claude: { command: "claude", args: ["--version"] },
  codex: { command: "codex", args: ["--version"] },
};

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CWD = "/";

const INITIAL_ENTRY: CliEntry = { status: "idle" };

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

function mapResult(result: CliProbeResult, now: number): CliEntry {
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
        claude: { status: "checking" },
        codex: { status: "checking" },
      },
    });

    const ids: CliId[] = ["claude", "codex"];
    const results = await Promise.all(
      ids.map((id) =>
        probeCli(bridge, PROBE_COMMANDS[id].command, PROBE_COMMANDS[id].args, {
          cwd,
          timeoutMs,
        }),
      ),
    );

    const now = Date.now();
    set({
      isChecking: false,
      entries: {
        claude: mapResult(results[0], now),
        codex: mapResult(results[1], now),
      },
    });
  },
}));
