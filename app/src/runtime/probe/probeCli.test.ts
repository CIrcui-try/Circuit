import { describe, it, expect } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
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
