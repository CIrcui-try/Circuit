import { assertInsideRepoRoot } from "../safety/pathPolicy";
import type {
  RuntimeBridge,
  RuntimeProcessEvent,
  RuntimeProcessListener,
  SpawnOptions,
  Unsubscribe,
} from "./RuntimeBridge";

export type ScenarioStep = {
  delayMs?: number;
  event: Omit<RuntimeProcessEvent, "runId" | "timestamp">;
};

export type SpawnScenario = (options: SpawnOptions) => ScenarioStep[];

export interface MockRuntimeBridgeOptions {
  files?: Record<string, string>;
  systemSkills?: Record<string, string>;
  defaultSkills?: Record<string, string>;
  scenario?: SpawnScenario;
  now?: () => string;
}

interface ActiveRun {
  options: SpawnOptions;
  cancelled: boolean;
  finished: boolean;
  inputClosed: boolean;
}

export interface MockRuntimeBridge extends RuntimeBridge {
  setScenario(scenario: SpawnScenario): void;
  setFile(path: string, content: string): void;
  removeFile(path: string): void;
  pendingRunIds(): string[];
  /** Inputs received via `sendInput`, in order. Each entry is `{ runId, text }`. */
  sentInputs(): ReadonlyArray<{ runId: string; text: string }>;
  /** Run ids received via `closeInput`, in order. */
  closedInputs(): readonly string[];
  /**
   * Register a callback invoked whenever `sendInput` is called for `runId`.
   * Returning a {@link ScenarioStep} (or array of steps) emits those steps
   * through the listener after the input is recorded — useful for scripting
   * "child progresses after the user responds" flows.
   */
  onInput(
    runId: string,
    handler: (text: string) => void | ScenarioStep | ScenarioStep[],
  ): void;
  onCloseInput(
    runId: string,
    handler: () => void | ScenarioStep | ScenarioStep[],
  ): void;
}

const TERMINAL_TYPES = new Set(["exited", "cancelled", "timeout", "error"]);

function isTerminal(type: RuntimeProcessEvent["type"]): boolean {
  return TERMINAL_TYPES.has(type);
}

export function createMockRuntimeBridge(
  initial: MockRuntimeBridgeOptions = {},
): MockRuntimeBridge {
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const systemSkills = new Map<string, string>(
    Object.entries(initial.systemSkills ?? {}),
  );
  const defaultSkills = new Map<string, string>(
    Object.entries(initial.defaultSkills ?? {}),
  );
  const runs = new Map<string, ActiveRun>();
  const listeners = new Map<string, Set<RuntimeProcessListener>>();
  const inputs: { runId: string; text: string }[] = [];
  const closedInputs: string[] = [];
  const inputHandlers = new Map<
    string,
    (text: string) => void | ScenarioStep | ScenarioStep[]
  >();
  const closeInputHandlers = new Map<
    string,
    () => void | ScenarioStep | ScenarioStep[]
  >();
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
    async readSystemSkill(systemSkillId) {
      const content = systemSkills.get(systemSkillId);
      if (content === undefined) {
        throw new Error(`mock: system skill not found ${systemSkillId}`);
      }
      return content;
    },
    async readDefaultSkill(skillFile) {
      const content = defaultSkills.get(skillFile);
      if (content === undefined) {
        throw new Error(`mock: default skill not found ${skillFile}`);
      }
      return content;
    },
    async spawn(options) {
      const run: ActiveRun = {
        options,
        cancelled: false,
        finished: false,
        inputClosed: options.stdinMode === "null",
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
    async sendInput(runId, text) {
      const run = runs.get(runId);
      if (!run || run.finished) {
        throw new Error(`mock: no active run for ${runId}`);
      }
      if (run.inputClosed) {
        throw new Error(`mock: stdin already closed for ${runId}`);
      }
      inputs.push({ runId, text });
      const handler = inputHandlers.get(runId);
      if (!handler) return;
      const out = handler(text);
      if (!out) return;
      const steps = Array.isArray(out) ? out : [out];
      for (const step of steps) {
        if (run.finished || run.cancelled) break;
        if (step.delayMs && step.delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, step.delayMs));
        }
        if (run.finished || run.cancelled) break;
        emit(runId, step.event);
      }
    },
    async closeInput(runId) {
      const run = runs.get(runId);
      if (!run || run.finished) return;
      if (run.inputClosed) return;
      run.inputClosed = true;
      closedInputs.push(runId);
      const handler = closeInputHandlers.get(runId);
      if (!handler) return;
      const out = handler();
      if (!out) return;
      const steps = Array.isArray(out) ? out : [out];
      for (const step of steps) {
        if (run.finished || run.cancelled) break;
        if (step.delayMs && step.delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, step.delayMs));
        }
        if (run.finished || run.cancelled) break;
        emit(runId, step.event);
      }
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
    sentInputs() {
      return inputs;
    },
    closedInputs() {
      return closedInputs;
    },
    onInput(runId, handler) {
      inputHandlers.set(runId, handler);
    },
    onCloseInput(runId, handler) {
      closeInputHandlers.set(runId, handler);
    },
  };
}
