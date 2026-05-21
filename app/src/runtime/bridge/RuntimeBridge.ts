export type RuntimeApprovalKind = "trust" | "command" | "freeform";

export type RuntimeProcessEvent =
  | { type: "started"; runId: string; timestamp: string }
  | { type: "stdout"; runId: string; timestamp: string; text: string }
  | { type: "stderr"; runId: string; timestamp: string; text: string }
  | { type: "exited"; runId: string; timestamp: string; exitCode: number | null }
  | { type: "cancelled"; runId: string; timestamp: string }
  | { type: "timeout"; runId: string; timestamp: string }
  | { type: "error"; runId: string; timestamp: string; message: string }
  | {
      type: "approvalRequest";
      runId: string;
      timestamp: string;
      requestId: string;
      prompt: string;
      kind: RuntimeApprovalKind;
    };

export type RuntimeProcessListener = (event: RuntimeProcessEvent) => void;

export interface Unsubscribe {
  (): void;
  /**
   * Resolves once the underlying listener is fully registered with the host
   * runtime. Awaiting this before calling `spawn` avoids dropped events for
   * processes that exit faster than the IPC listener handshake completes
   * (e.g. `claude --version`).
   */
  ready: Promise<void>;
}

export interface SpawnOptions {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdinMode?: "piped" | "null";
}

export type CliResolveSource =
  | "processPath"
  | "loginShell"
  | "knownLocation"
  | "manualOverride";

export interface CliResolveAttempt {
  source: CliResolveSource;
  ok: boolean;
  detail: string;
  path?: string | null;
}

export interface CliResolveResult {
  command: string;
  ok: boolean;
  resolvedPath?: string | null;
  source?: CliResolveSource | null;
  errorMessage?: string | null;
  processPath: string;
  loginShell?: string | null;
  attempts: CliResolveAttempt[];
}

export interface RuntimeBridge {
  readFile(absPath: string, repoRoot: string): Promise<string>;
  readSystemSkill?(systemSkillId: string): Promise<string>;
  readDefaultSkill?(skillFile: string): Promise<string>;
  resolveCli?(
    command: string,
    manualPath?: string | null,
  ): Promise<CliResolveResult>;
  spawn(options: SpawnOptions): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  /**
   * Write to the child process's stdin. The runtime keeps stdin open until the
   * child exits. The caller is responsible for line termination (e.g. `y\n`).
   */
  sendInput(runId: string, text: string): Promise<void>;
  /** Close the child process's stdin so CLIs waiting for piped input receive EOF. */
  closeInput(runId: string): Promise<void>;
  subscribe(runId: string, listener: RuntimeProcessListener): Unsubscribe;
}

declare global {
  interface Window {
    __CIRCUIT_RUNTIME__?: RuntimeBridge;
  }
}

let lazyTauriBridge: RuntimeBridge | null = null;

async function loadTauriBridge(): Promise<RuntimeBridge> {
  if (lazyTauriBridge) return lazyTauriBridge;
  const mod = await import("./RuntimeBridge.tauri");
  lazyTauriBridge = mod.tauriRuntimeBridge;
  return lazyTauriBridge;
}

export function getRuntimeBridge(): RuntimeBridge {
  if (typeof window !== "undefined" && window.__CIRCUIT_RUNTIME__) {
    return window.__CIRCUIT_RUNTIME__;
  }
  return tauriRuntimeBridgeProxy;
}

const tauriRuntimeBridgeProxy: RuntimeBridge = {
  readFile: (absPath, repoRoot) =>
    loadTauriBridge().then((b) => b.readFile(absPath, repoRoot)),
  readSystemSkill: (systemSkillId) =>
    loadTauriBridge().then((b) => {
      if (!b.readSystemSkill) {
        throw new Error("system skill reader is not available");
      }
      return b.readSystemSkill(systemSkillId);
    }),
  readDefaultSkill: (skillFile) =>
    loadTauriBridge().then((b) => {
      if (!b.readDefaultSkill) {
        throw new Error("default skill reader is not available");
      }
      return b.readDefaultSkill(skillFile);
    }),
  resolveCli: (command, manualPath) =>
    loadTauriBridge().then((b) => {
      if (!b.resolveCli) {
        throw new Error("CLI resolver is not available");
      }
      return b.resolveCli(command, manualPath);
    }),
  spawn: (options) => loadTauriBridge().then((b) => b.spawn(options)),
  cancel: (runId) => loadTauriBridge().then((b) => b.cancel(runId)),
  sendInput: (runId, text) =>
    loadTauriBridge().then((b) => b.sendInput(runId, text)),
  closeInput: (runId) => loadTauriBridge().then((b) => b.closeInput(runId)),
  subscribe: (runId, listener) => {
    let inner: Unsubscribe | null = null;
    let cancelled = false;
    const ready = loadTauriBridge().then(async (b) => {
      if (cancelled) return;
      inner = b.subscribe(runId, listener);
      await inner.ready;
    });
    const unsub = (() => {
      cancelled = true;
      if (inner) inner();
    }) as Unsubscribe;
    unsub.ready = ready;
    return unsub;
  },
};
