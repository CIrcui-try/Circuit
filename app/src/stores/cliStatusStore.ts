import { create } from "zustand";
import {
  getHostBridge,
  type HostBridge,
  type McpConfigStatus,
  type McpServerSummary,
} from "../host/bridge";
import { getRuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import type { CliResolveResult } from "../runtime/bridge/RuntimeBridge";
import {
  probeCli,
  type CliProbeResult,
  type CliProbeStage,
} from "../runtime/probe/probeCli";

export type CliId = "claude" | "codex";
export type McpProviderId = "claude" | "codex";

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

export type McpStatus = CliStatus;

export interface McpEntry {
  status: McpStatus;
  servers?: McpServerSummary[];
  serverCount?: number;
  errorMessage?: string;
  detailLog?: string;
  checkedAt?: number;
  configPath?: string;
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

export interface RunMcpChecksOptions {
  bridge?: Pick<HostBridge, "readMcpConfigStatus">;
}

export interface RefreshAllOptions extends RunChecksOptions {
  hostBridge?: Pick<HostBridge, "readMcpConfigStatus">;
}

interface CliStatusState {
  entries: Record<CliId, CliEntry>;
  mcpEntries: Record<McpProviderId, McpEntry>;
  isChecking: boolean;
  isCheckingMcp: boolean;
  runChecks: (opts?: RunChecksOptions) => Promise<void>;
  runMcpChecks: (opts?: RunMcpChecksOptions) => Promise<void>;
  refreshAll: (opts?: RefreshAllOptions) => Promise<void>;
}

function formatTextBlock(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed || "(empty)";
}

function commandLine(meta: ProbeMeta): string {
  return [meta.command, ...meta.args].join(" ");
}

function formatResolveLog(resolve: CliResolveResult | undefined): string[] {
  if (!resolve) return ["CLI Resolution:", "(not available)"];
  return [
    "CLI Resolution:",
    `Resolved: ${resolve.ok ? "yes" : "no"}`,
    `Resolved Path: ${resolve.resolvedPath ?? "(none)"}`,
    `Source: ${resolve.source ?? "(none)"}`,
    `Process PATH: ${resolve.processPath || "(empty)"}`,
    `Login Shell: ${resolve.loginShell ?? "(none)"}`,
    "Attempts:",
    ...resolve.attempts.map((attempt) => {
      const path = attempt.path ? ` path=${attempt.path}` : "";
      return `- ${attempt.source}: ${attempt.ok ? "ok" : "failed"}${path} — ${attempt.detail}`;
    }),
  ];
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
    ...formatResolveLog(result.resolve),
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

function fileStatusLog(
  label: string,
  status: {
    path: string;
    ok: boolean;
    missing: boolean;
    message?: string | null;
  },
): string[] {
  return [
    `${label}:`,
    `Path: ${status.path}`,
    `OK: ${status.ok ? "yes" : "no"}`,
    `Missing: ${status.missing ? "yes" : "no"}`,
    `Message: ${status.message ?? "(none)"}`,
  ];
}

function formatMcpDetailLog(
  provider: McpProviderId,
  status: McpConfigStatus[McpProviderId],
  now: number,
): string {
  const lines = [
    `MCP Provider: ${provider}`,
    `Checked At: ${new Date(now).toISOString()}`,
    `Server Count: ${status.servers.length}`,
    "",
    ...fileStatusLog("Config", status.config),
  ];

  if (provider === "claude") {
    const authCache = (status as McpConfigStatus["claude"]).authCache;
    lines.push(
      "",
      ...fileStatusLog("Auth Cache", authCache),
    );
  }

  return lines.join("\n");
}

function mapMcpProvider(
  provider: McpProviderId,
  status: McpConfigStatus[McpProviderId],
  now: number,
): McpEntry {
  const detailLog = formatMcpDetailLog(provider, status, now);
  if (status.config.ok) {
    const authCache =
      provider === "claude"
        ? (status as McpConfigStatus["claude"]).authCache
        : null;
    if (authCache && !authCache.ok && !authCache.missing) {
      return {
        status: "error",
        servers: status.servers,
        serverCount: status.servers.length,
        errorMessage: authCache.message ?? "auth cache error",
        detailLog,
        checkedAt: now,
        configPath: status.config.path,
      };
    }
    return {
      status: "ok",
      servers: status.servers,
      serverCount: status.servers.length,
      checkedAt: now,
      configPath: status.config.path,
    };
  }

  return {
    status: status.config.missing ? "missing" : "error",
    servers: status.servers,
    serverCount: status.servers.length,
    errorMessage: status.config.message ?? "MCP config unavailable",
    detailLog,
    checkedAt: now,
    configPath: status.config.path,
  };
}

function mapMcpError(
  error: unknown,
  now: number,
): Record<McpProviderId, McpEntry> {
  const message = error instanceof Error ? error.message : String(error);
  const entry: McpEntry = {
    status: "error",
    errorMessage: message,
    detailLog: [
      `Checked At: ${new Date(now).toISOString()}`,
      "MCP status bridge failed",
      message,
    ].join("\n"),
    checkedAt: now,
  };
  return {
    claude: { ...entry },
    codex: { ...entry },
  };
}

export const useCliStatusStore = create<CliStatusState>((set, get) => ({
  entries: { claude: { ...INITIAL_ENTRY }, codex: { ...INITIAL_ENTRY } },
  mcpEntries: { claude: { ...INITIAL_ENTRY }, codex: { ...INITIAL_ENTRY } },
  isChecking: false,
  isCheckingMcp: false,

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

  runMcpChecks: async (opts) => {
    if (get().isCheckingMcp) return;

    const bridge = opts?.bridge ?? getHostBridge();
    set({
      isCheckingMcp: true,
      mcpEntries: {
        claude: { status: "checking", errorMessage: "Reading MCP config..." },
        codex: { status: "checking", errorMessage: "Reading MCP config..." },
      },
    });

    const now = Date.now();
    try {
      if (!bridge.readMcpConfigStatus) {
        throw new Error("MCP status bridge is not available");
      }
      const status = await bridge.readMcpConfigStatus();
      set({
        isCheckingMcp: false,
        mcpEntries: {
          claude: mapMcpProvider("claude", status.claude, now),
          codex: mapMcpProvider("codex", status.codex, now),
        },
      });
    } catch (error) {
      set({
        isCheckingMcp: false,
        mcpEntries: mapMcpError(error, now),
      });
    }
  },

  refreshAll: async (opts) => {
    await Promise.all([
      get().runChecks(opts),
      get().runMcpChecks({ bridge: opts?.hostBridge }),
    ]);
  },
}));
