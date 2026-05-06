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
    const ready = listen<unknown>(RUNTIME_EVENT_CHANNEL, (msg) => {
      if (cancelled) return;
      const raw = msg.payload as Record<string, unknown> | null | undefined;
      if (!raw || typeof raw !== "object") {
        console.warn("[RuntimeBridge] event with non-object payload:", msg);
        return;
      }
      const incomingRunId =
        (raw.runId as string | undefined) ??
        (raw.run_id as string | undefined);
      // Always log in dev tools so the user can copy raw payloads when probes
      // get stuck. This is a frontend bundle so the cost is just one console
      // line per event.
      console.debug(
        `[RuntimeBridge] event received: runId=${String(incomingRunId)} type=${String(
          raw.type,
        )} (filter=${runId})`,
        raw,
      );
      if (incomingRunId !== runId) return;
      const exitCodeRaw =
        (raw.exitCode as number | null | undefined) ??
        (raw.exit_code as number | null | undefined);
      const normalized = {
        ...raw,
        runId: incomingRunId,
        exitCode: exitCodeRaw,
      } as unknown as RuntimeProcessEvent;
      listener(normalized);
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlistenFn = u;
      }
    });
    const unsub = (() => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    }) as Unsubscribe;
    unsub.ready = ready;
    return unsub;
  },
};
