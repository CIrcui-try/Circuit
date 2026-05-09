import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  RuntimeBridge,
  RuntimeProcessEvent,
  RuntimeProcessListener,
  SpawnOptions,
  Unsubscribe,
} from "./RuntimeBridge";

interface RunBinding {
  channel: Channel<unknown>;
  listeners: Set<RuntimeProcessListener>;
  spawnSent: boolean;
}

const bindings = new Map<string, RunBinding>();

function normalize(raw: Record<string, unknown>): RuntimeProcessEvent {
  const incomingRunId =
    (raw.runId as string | undefined) ?? (raw.run_id as string | undefined);
  const exitCodeRaw =
    (raw.exitCode as number | null | undefined) ??
    (raw.exit_code as number | null | undefined);
  return {
    ...raw,
    runId: incomingRunId,
    exitCode: exitCodeRaw,
  } as unknown as RuntimeProcessEvent;
}

function getOrCreateBinding(runId: string): RunBinding {
  let binding = bindings.get(runId);
  if (!binding) {
    const channel = new Channel<unknown>();
    const listeners = new Set<RuntimeProcessListener>();
    binding = { channel, listeners, spawnSent: false };
    channel.onmessage = (msg) => {
      if (!msg || typeof msg !== "object") {
        console.warn("[RuntimeBridge] event with non-object payload:", msg);
        return;
      }
      const ev = normalize(msg as Record<string, unknown>);
      // Always log in dev tools so the user can copy raw payloads when probes
      // get stuck. This is a frontend bundle so the cost is just one console
      // line per event.
      console.debug(
        `[RuntimeBridge] event received: runId=${String(ev.runId)} type=${String(
          ev.type,
        )}`,
        ev,
      );
      const current = bindings.get(runId);
      if (!current) return;
      for (const listener of current.listeners) listener(ev);
      if (
        ev.type === "exited" ||
        ev.type === "cancelled" ||
        ev.type === "timeout" ||
        ev.type === "error"
      ) {
        bindings.delete(runId);
      }
    };
    bindings.set(runId, binding);
  }
  return binding;
}

export const tauriRuntimeBridge: RuntimeBridge = {
  async readFile(absPath, repoRoot) {
    return await invoke<string>("runtime_read_file", {
      path: absPath,
      repoRoot,
    });
  },
  async spawn(options: SpawnOptions) {
    const binding = getOrCreateBinding(options.runId);
    binding.spawnSent = true;
    await invoke<void>("runtime_spawn", {
      runId: options.runId,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env ?? null,
      timeoutMs: options.timeoutMs ?? null,
      stdinMode: options.stdinMode ?? null,
      onEvent: binding.channel,
    });
    return { runId: options.runId };
  },
  async cancel(runId) {
    await invoke<void>("runtime_cancel", { runId });
  },
  async sendInput(runId, text) {
    await invoke<void>("runtime_send_input", { runId, text });
  },
  async closeInput(runId) {
    await invoke<void>("runtime_close_input", { runId });
  },
  subscribe(runId, listener: RuntimeProcessListener): Unsubscribe {
    const binding = getOrCreateBinding(runId);
    binding.listeners.add(listener);
    const unsub = (() => {
      const current = bindings.get(runId);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0 && !current.spawnSent) {
        bindings.delete(runId);
      }
    }) as Unsubscribe;
    // The Channel object exists synchronously — Rust never sees an event before
    // it has the channel handle, so there is no listener-registration race.
    unsub.ready = Promise.resolve();
    return unsub;
  },
};
