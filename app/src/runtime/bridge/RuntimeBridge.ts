export type RuntimeProcessEvent =
  | { type: "started"; runId: string; timestamp: string }
  | { type: "stdout"; runId: string; timestamp: string; text: string }
  | { type: "stderr"; runId: string; timestamp: string; text: string }
  | { type: "exited"; runId: string; timestamp: string; exitCode: number | null }
  | { type: "cancelled"; runId: string; timestamp: string }
  | { type: "timeout"; runId: string; timestamp: string }
  | { type: "error"; runId: string; timestamp: string; message: string };

export type RuntimeProcessListener = (event: RuntimeProcessEvent) => void;

export type Unsubscribe = () => void;

export interface SpawnOptions {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RuntimeBridge {
  readFile(absPath: string, repoRoot: string): Promise<string>;
  spawn(options: SpawnOptions): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
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
  spawn: (options) => loadTauriBridge().then((b) => b.spawn(options)),
  cancel: (runId) => loadTauriBridge().then((b) => b.cancel(runId)),
  subscribe: (runId, listener) => {
    let unsub: Unsubscribe = () => {};
    let cancelled = false;
    void loadTauriBridge().then((b) => {
      if (cancelled) return;
      unsub = b.subscribe(runId, listener);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  },
};
