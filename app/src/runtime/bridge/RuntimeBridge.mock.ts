import { assertInsideRepoRoot } from "../safety/pathPolicy";
import type {
  RuntimeBridge,
  RuntimeProcessEvent,
  RuntimeProcessListener,
  SpawnOptions,
  Unsubscribe,
} from "./RuntimeBridge";

type ScenarioStep = {
  delayMs?: number;
  event: Omit<RuntimeProcessEvent, "runId" | "timestamp">;
};

export type SpawnScenario = (options: SpawnOptions) => ScenarioStep[];

export interface MockRuntimeBridgeOptions {
  files?: Record<string, string>;
  scenario?: SpawnScenario;
  now?: () => string;
}

interface ActiveRun {
  options: SpawnOptions;
  cancelled: boolean;
  finished: boolean;
}

export interface MockRuntimeBridge extends RuntimeBridge {
  setScenario(scenario: SpawnScenario): void;
  setFile(path: string, content: string): void;
  removeFile(path: string): void;
  pendingRunIds(): string[];
}

const TERMINAL_TYPES = new Set(["exited", "cancelled", "timeout", "error"]);

function isTerminal(type: RuntimeProcessEvent["type"]): boolean {
  return TERMINAL_TYPES.has(type);
}

export function createMockRuntimeBridge(
  initial: MockRuntimeBridgeOptions = {},
): MockRuntimeBridge {
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const runs = new Map<string, ActiveRun>();
  const listeners = new Map<string, Set<RuntimeProcessListener>>();
  let scenario: SpawnScenario | null = initial.scenario ?? null;
  const now = initial.now ?? (() => new Date().toISOString());

  function emit(runId: string, raw: Omit<RuntimeProcessEvent, "runId" | "timestamp">): void {
    const ev = { ...raw, runId, timestamp: now() } as RuntimeProcessEvent;
    const set = listeners.get(runId);
    if (set) {
      for (const listener of set) listener(ev);
    }
    if (isTerminal(ev.type)) {
      const run = runs.get(runId);
      if (run) run.finished = true;
      runs.delete(runId);
    }
  }

  async function playScenario(run: ActiveRun): Promise<void> {
    if (!scenario) {
      emit(run.options.runId, { type: "started" });
      return;
    }
    const steps = scenario(run.options);
    for (const step of steps) {
      if (run.finished || run.cancelled) break;
      if (step.delayMs && step.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, step.delayMs));
      }
      if (run.finished || run.cancelled) break;
      emit(run.options.runId, step.event);
    }
  }

  return {
    async readFile(absPath, repoRoot) {
      assertInsideRepoRoot(absPath, repoRoot);
      const content = files.get(absPath);
      if (content === undefined) {
        throw new Error(`mock: file not found ${absPath}`);
      }
      return content;
    },
    async spawn(options) {
      const run: ActiveRun = {
        options,
        cancelled: false,
        finished: false,
      };
      runs.set(options.runId, run);
      queueMicrotask(() => {
        void playScenario(run);
      });
      return { runId: options.runId };
    },
    async cancel(runId) {
      const run = runs.get(runId);
      if (!run || run.finished) return;
      run.cancelled = true;
      emit(runId, { type: "cancelled" });
    },
    subscribe(runId, listener): Unsubscribe {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);
      const unsub = (() => {
        const current = listeners.get(runId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(runId);
      }) as Unsubscribe;
      unsub.ready = Promise.resolve();
      return unsub;
    },
    setScenario(next) {
      scenario = next;
    },
    setFile(path, content) {
      files.set(path, content);
    },
    removeFile(path) {
      files.delete(path);
    },
    pendingRunIds() {
      return Array.from(runs.keys());
    },
  };
}
