import type { RunnableNode, RunResult, WorkflowRunner } from "./runner";

export const FAIL_LABEL_PREFIX = "[fail]";

export type MockRunnerOptions = {
  delayMs?: number;
  shouldFail?: (node: RunnableNode) => boolean;
};

export function createMockRunner(options: MockRunnerOptions = {}): WorkflowRunner {
  const delayMs = options.delayMs ?? 0;
  const shouldFail =
    options.shouldFail ?? ((node) => node.label.startsWith(FAIL_LABEL_PREFIX));

  return {
    async runNode(node): Promise<RunResult> {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        await Promise.resolve();
      }
      if (shouldFail(node)) {
        return { ok: false, reason: `mock fail: ${node.label}` };
      }
      return { ok: true };
    },
  };
}
