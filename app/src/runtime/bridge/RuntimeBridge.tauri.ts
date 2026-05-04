import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  RuntimeBridge,
  RuntimeProcessEvent,
  RuntimeProcessListener,
  SpawnOptions,
  Unsubscribe,
} from "./RuntimeBridge";

const RUNTIME_EVENT_CHANNEL = "runtime://event";

export const tauriRuntimeBridge: RuntimeBridge = {
  async readFile(absPath, repoRoot) {
    return await invoke<string>("runtime_read_file", {
      path: absPath,
      repoRoot,
    });
  },
  async spawn(options: SpawnOptions) {
    await invoke<void>("runtime_spawn", {
      runId: options.runId,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env ?? null,
      timeoutMs: options.timeoutMs ?? null,
    });
    return { runId: options.runId };
  },
  async cancel(runId) {
    await invoke<void>("runtime_cancel", { runId });
  },
  subscribe(runId, listener: RuntimeProcessListener): Unsubscribe {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    void listen<RuntimeProcessEvent>(RUNTIME_EVENT_CHANNEL, (msg) => {
      if (cancelled) return;
      if (msg.payload.runId !== runId) return;
      listener(msg.payload);
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlistenFn = u;
      }
    });
    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  },
};
