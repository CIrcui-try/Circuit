import { describe, it, expect, vi } from "vitest";
import { createMockRuntimeBridge } from "./RuntimeBridge.mock";
import type { RuntimeProcessEvent } from "./RuntimeBridge";

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createMockRuntimeBridge / readFile", () => {
  it("returns content for a registered file inside repo root", async () => {
    const bridge = createMockRuntimeBridge({
      files: { "/repo/a.txt": "hello" },
    });
    expect(await bridge.readFile("/repo/a.txt", "/repo")).toBe("hello");
  });

  it("throws when reading a path outside repo root", async () => {
    const bridge = createMockRuntimeBridge({
      files: { "/repo/a.txt": "hello" },
    });
    await expect(bridge.readFile("/etc/passwd", "/repo")).rejects.toThrow(
      /outside repository root/,
    );
  });

  it("throws when reading an unregistered file", async () => {
    const bridge = createMockRuntimeBridge();
    await expect(bridge.readFile("/repo/missing", "/repo")).rejects.toThrow(
      /file not found/,
    );
  });
});

describe("createMockRuntimeBridge / spawn streaming", () => {
  it("delivers scripted stdout / stderr / exited events in order", async () => {
    const events: RuntimeProcessEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stdout", text: "line-1" } },
        { event: { type: "stderr", text: "warn" } },
        { event: { type: "stdout", text: "line-2" } },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });
    bridge.subscribe("r-1", (ev) => events.push(ev));
    await bridge.spawn({
      runId: "r-1",
      command: "echo",
      args: [],
      cwd: "/repo",
    });
    await nextTick();
    expect(events.map((e) => e.type)).toEqual([
      "started",
      "stdout",
      "stderr",
      "stdout",
      "exited",
    ]);
    const stdout1 = events[1] as Extract<RuntimeProcessEvent, { type: "stdout" }>;
    expect(stdout1.text).toBe("line-1");
  });

  it("emits cancelled event when cancel is called mid-stream", async () => {
    const events: RuntimeProcessEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { delayMs: 5, event: { type: "stdout", text: "tick-1" } },
        { delayMs: 50, event: { type: "stdout", text: "tick-2" } },
        { delayMs: 50, event: { type: "exited", exitCode: 0 } },
      ],
    });
    bridge.subscribe("r-cancel", (ev) => events.push(ev));
    await bridge.spawn({
      runId: "r-cancel",
      command: "sleep",
      args: ["5"],
      cwd: "/repo",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await bridge.cancel("r-cancel");
    await nextTick();
    expect(events.some((e) => e.type === "cancelled")).toBe(true);
    expect(events.some((e) => e.type === "exited")).toBe(false);
  });

  it("emits a timeout event when the scenario produces one", async () => {
    const events: RuntimeProcessEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "timeout" } },
      ],
    });
    bridge.subscribe("r-timeout", (ev) => events.push(ev));
    await bridge.spawn({
      runId: "r-timeout",
      command: "sleep",
      args: ["100"],
      cwd: "/repo",
      timeoutMs: 1,
    });
    await nextTick();
    expect(events.map((e) => e.type)).toEqual(["started", "timeout"]);
  });

  it("does not deliver events to a listener after unsubscribe", async () => {
    const listener = vi.fn();
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { delayMs: 5, event: { type: "stdout", text: "later" } },
        { delayMs: 5, event: { type: "exited", exitCode: 0 } },
      ],
    });
    const unsub = bridge.subscribe("r-unsub", listener);
    await bridge.spawn({
      runId: "r-unsub",
      command: "echo",
      args: [],
      cwd: "/repo",
    });
    await nextTick();
    unsub();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const calls = listener.mock.calls.map(
      (c) => (c[0] as RuntimeProcessEvent).type,
    );
    expect(calls).toContain("started");
    expect(calls).not.toContain("exited");
  });

  it("records sendInput calls and lets onInput handler emit follow-up events", async () => {
    const events: RuntimeProcessEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Do you trust this directory?" } },
      ],
    });
    bridge.subscribe("r-input", (ev) => events.push(ev));
    bridge.onInput("r-input", (text) => {
      if (text === "y\n") {
        return [
          { event: { type: "stdout", text: "ok" } },
          { event: { type: "exited", exitCode: 0 } },
        ];
      }
      return undefined;
    });
    await bridge.spawn({
      runId: "r-input",
      command: "codex",
      args: ["exec", "p"],
      cwd: "/repo",
    });
    await nextTick();
    await bridge.sendInput("r-input", "y\n");
    await nextTick();
    expect(bridge.sentInputs()).toEqual([{ runId: "r-input", text: "y\n" }]);
    expect(events.map((e) => e.type)).toEqual([
      "started",
      "stderr",
      "stdout",
      "exited",
    ]);
  });

  it("rejects sendInput when a run is spawned with null stdin", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [{ event: { type: "started" } }],
    });
    bridge.subscribe("r-null-stdin", () => {});
    await bridge.spawn({
      runId: "r-null-stdin",
      command: "codex",
      args: ["exec", "p"],
      cwd: "/repo",
      stdinMode: "null",
    });
    await nextTick();

    await expect(bridge.sendInput("r-null-stdin", "y\n")).rejects.toThrow(
      /stdin already closed/,
    );
  });

  it("rejects sendInput for an unknown or finished run", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [{ event: { type: "exited", exitCode: 0 } }],
    });
    await expect(bridge.sendInput("nope", "y\n")).rejects.toThrow(
      /no active run/,
    );
    bridge.subscribe("r-done", () => {});
    await bridge.spawn({
      runId: "r-done",
      command: "echo",
      args: [],
      cwd: "/repo",
    });
    await nextTick();
    await expect(bridge.sendInput("r-done", "y\n")).rejects.toThrow(
      /no active run/,
    );
  });

  it("records closeInput calls and lets onCloseInput handler emit follow-up events", async () => {
    const events: RuntimeProcessEvent[] = [];
    const bridge = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "Reading additional input from stdin..." } },
      ],
    });
    bridge.subscribe("r-close", (ev) => events.push(ev));
    bridge.onCloseInput("r-close", () => [
      { event: { type: "stdout", text: "after eof" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);

    await bridge.spawn({
      runId: "r-close",
      command: "codex",
      args: ["exec", "p"],
      cwd: "/repo",
    });
    await nextTick();
    await bridge.closeInput("r-close");
    await nextTick();

    expect(bridge.closedInputs()).toEqual(["r-close"]);
    expect(events.map((e) => e.type)).toEqual([
      "started",
      "stderr",
      "stdout",
      "exited",
    ]);
    await expect(bridge.sendInput("r-close", "late\n")).rejects.toThrow(
      /no active run/,
    );
  });

  it("removes finished runs from pendingRunIds after exited event", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: () => [{ event: { type: "exited", exitCode: 0 } }],
    });
    bridge.subscribe("r-done", () => {});
    await bridge.spawn({
      runId: "r-done",
      command: "echo",
      args: [],
      cwd: "/repo",
    });
    await nextTick();
    expect(bridge.pendingRunIds()).not.toContain("r-done");
  });
});
