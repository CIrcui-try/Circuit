import { describe, it, expect, vi } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
import type {
  RuntimeBridge,
  Unsubscribe,
} from "../bridge/RuntimeBridge";
import { probeCli } from "./probeCli";

describe("probeCli", () => {
  it("captures stdout first line and exit code on success", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stdout", text: "claude 1.2.3\nextra info\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    const result = await probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutFirstLine).toBe("claude 1.2.3");
    expect(result.reason).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies ENOENT as missing", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        {
          event: {
            type: "error",
            message: "spawn claude ENOENT",
          },
        },
      ],
    });

    const result = await probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing");
    expect(result.errorMessage).toContain("ENOENT");
  });

  it("classifies command not found as missing", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        {
          event: {
            type: "error",
            message: "sh: codex: command not found",
          },
        },
      ],
    });

    const result = await probeCli(bridge, "codex", ["--version"], {
      cwd: "/tmp",
    });

    expect(result.reason).toBe("missing");
  });

  it("maps non-zero exit to reason 'non-zero' and surfaces stderr", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "boom" } },
        { event: { type: "exited", exitCode: 1 } },
      ],
    });

    const result = await probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("non-zero");
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toBe("boom");
  });

  it("maps timeout event to reason 'timeout'", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [{ event: { type: "timeout" } }],
    });

    const result = await probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timeout");
  });

  it("waits for subscribe.ready before invoking spawn (regression: dropped exit on fast commands)", async () => {
    let releaseReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });

    const spawnOrder: string[] = [];
    const subscribers = new Map<
      string,
      (ev: import("../bridge/RuntimeBridge").RuntimeProcessEvent) => void
    >();

    const bridge: RuntimeBridge = {
      readFile: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      spawn: vi.fn(async (opts) => {
        spawnOrder.push("spawn");
        // emit terminal event immediately, simulating a very fast command.
        queueMicrotask(() => {
          subscribers.get(opts.runId)?.({
            type: "exited",
            runId: opts.runId,
            timestamp: new Date().toISOString(),
            exitCode: 0,
          });
        });
        return { runId: opts.runId };
      }),
      subscribe: (runId, listener) => {
        subscribers.set(runId, listener);
        const unsub = (() => {
          subscribers.delete(runId);
        }) as Unsubscribe;
        unsub.ready = ready;
        return unsub;
      },
    };

    const probePromise = probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
    });

    // give microtasks a chance to run; spawn must NOT have been called yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(spawnOrder).toEqual([]);

    releaseReady();
    const result = await probePromise;
    expect(spawnOrder).toEqual(["spawn"]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("maps unknown error to reason 'error' rather than 'missing'", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        {
          event: {
            type: "error",
            message: "permission denied",
          },
        },
      ],
    });

    const result = await probeCli(bridge, "claude", ["--version"], {
      cwd: "/tmp",
    });

    expect(result.reason).toBe("error");
  });
});
