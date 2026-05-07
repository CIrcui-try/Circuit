import { describe, expect, it } from "vitest";

import {
  createMockRuntimeBridge,
  type MockRuntimeBridge,
  type SpawnScenario,
} from "../bridge/RuntimeBridge.mock";
import type {
  RuntimeBridge,
  SpawnOptions,
} from "../bridge/RuntimeBridge";
import type {
  AgentRunEvent,
  SkillExecutionContext,
} from "./AgentAdapter";
import { ClaudeAdapter } from "./ClaudeAdapter";

function makeContext(over: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: "run_001",
    workflowId: "wf_001",
    nodeId: "node_implement",
    repository: {
      id: "repo_001",
      name: "sample-repo",
      path: "/abs/path/to/sample-repo",
    },
    skill: {
      provider: "claude",
      name: "implement-feature",
      rootDir: "/abs/path/to/sample-repo/.claude/skills/implement-feature",
      skillFile: ".claude/skills/implement-feature/SKILL.md",
      skillFileAbsPath:
        "/abs/path/to/sample-repo/.claude/skills/implement-feature/SKILL.md",
      content: "# implement-feature\n\nDo the thing.\n",
    },
    input: { prompt: "do the thing" },
    previousOutputs: {},
    execution: {
      timeoutMs: 300_000,
      cwd: "/abs/path/to/sample-repo",
      env: { FOO: "bar" },
    },
    ...over,
  };
}

interface SpyBridge {
  bridge: RuntimeBridge;
  mock: MockRuntimeBridge;
  spawnCalls: SpawnOptions[];
}

function spy(scenario?: SpawnScenario): SpyBridge {
  const mock = createMockRuntimeBridge({ scenario });
  const spawnCalls: SpawnOptions[] = [];
  const bridge: RuntimeBridge = {
    readFile: (p, r) => mock.readFile(p, r),
    spawn: async (opts) => {
      spawnCalls.push(opts);
      return mock.spawn(opts);
    },
    cancel: (id) => mock.cancel(id),
    sendInput: (id, text) => mock.sendInput(id, text),
    subscribe: (id, listener) => mock.subscribe(id, listener),
  };
  return { bridge, mock, spawnCalls };
}

describe("ClaudeAdapter", () => {
  it("C1 — provider is 'claude'", () => {
    const { bridge } = spy();
    const adapter = new ClaudeAdapter({ bridge });
    expect(adapter.provider).toBe("claude");
  });

  it("C2 — canRun returns ok when probe exits 0", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("claude");
    expect(spawnCalls[0].args).toEqual(["--version"]);
    expect(spawnCalls[0].cwd).toBe("/abs/path/to/sample-repo");
  });

  it("C3 — canRun returns ok=false with exitCode detail when probe exits non-zero", async () => {
    const { bridge } = spy(() => [
      { event: { type: "exited", exitCode: 127 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain("127");
    expect(availability.details).toMatchObject({ exitCode: 127 });
  });

  it("C4 — canRun returns ok=false with reason when probe emits error", async () => {
    const { bridge } = spy(() => [
      { event: { type: "error", message: "ENOENT" } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain("ENOENT");
  });

  it("C5 — canRun with skipProbe returns ok immediately and does not spawn", async () => {
    const { bridge, spawnCalls } = spy();
    const adapter = new ClaudeAdapter({ bridge, skipProbe: true });
    const availability = await adapter.canRun(makeContext());
    expect(availability).toEqual({ ok: true, details: { skipped: true } });
    expect(spawnCalls).toHaveLength(0);
  });

  it("C6 — run forwards cwd, env, timeoutMs from ctx.execution to spawn", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    await adapter.run(makeContext(), () => {});
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/abs/path/to/sample-repo");
    expect(spawnCalls[0].env).toEqual({ FOO: "bar" });
    expect(spawnCalls[0].timeoutMs).toBe(300_000);
  });

  it("C7 — default prompt contains skill name, content, and JSON-stringified input", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    await adapter.run(makeContext(), () => {});
    const args = spawnCalls[0].args;
    expect(args[0]).toBe("-p");
    const prompt = args[1];
    expect(prompt).toContain("implement-feature");
    expect(prompt).toContain("Do the thing.");
    expect(prompt).toContain(`"prompt": "do the thing"`);
  });

  it("C8 — custom buildCommand and buildPrompt are honored", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({
      bridge,
      buildPrompt: (ctx) => `PROMPT:${ctx.skill.name}`,
      buildCommand: (_ctx, prompt) => ({
        command: "/usr/local/bin/claude-wrapper",
        args: ["--prompt", prompt, "--json"],
      }),
    });
    await adapter.run(makeContext(), () => {});
    expect(spawnCalls[0].command).toBe("/usr/local/bin/claude-wrapper");
    expect(spawnCalls[0].args).toEqual([
      "--prompt",
      "PROMPT:implement-feature",
      "--json",
    ]);
  });

  it("C9 — runtime started/stdout/stderr/exited map to AgentRunEvent in order", async () => {
    const { bridge } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "stdout", text: "hello\n" } },
      { event: { type: "stderr", text: "warn\n" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    const received: AgentRunEvent[] = [];
    await adapter.run(makeContext(), (ev) => received.push(ev));
    expect(received.map((e) => e.type)).toEqual([
      "start",
      "stdout",
      "stderr",
      "finish",
    ]);
    const stdout = received[1];
    if (stdout.type === "stdout") expect(stdout.text).toBe("hello\n");
    const stderr = received[2];
    if (stderr.type === "stderr") expect(stderr.text).toBe("warn\n");
  });

  it("C10 — exited(0) yields status=success with logs, exitCode, timestamps populated", async () => {
    const { bridge } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "stdout", text: "ok" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new ClaudeAdapter({ bridge });
    const received: AgentRunEvent[] = [];
    const result = await adapter.run(makeContext(), (ev) => received.push(ev));
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.logs).toEqual(received);
    expect(typeof result.startedAt).toBe("string");
    expect(typeof result.finishedAt).toBe("string");
  });

  describe("C11 — terminal event mapping", () => {
    it("exited(2) → status=failed with exitCode=2", async () => {
      const { bridge } = spy(() => [
        { event: { type: "exited", exitCode: 2 } },
      ]);
      const adapter = new ClaudeAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(2);
    });

    it("cancelled → status=cancelled", async () => {
      const { bridge } = spy(() => [{ event: { type: "cancelled" } }]);
      const adapter = new ClaudeAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("cancelled");
      expect(result.exitCode).toBeUndefined();
    });

    it("timeout → status=timeout", async () => {
      const { bridge } = spy(() => [{ event: { type: "timeout" } }]);
      const adapter = new ClaudeAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("timeout");
      expect(result.exitCode).toBeUndefined();
    });

    it("error → status=failed with error event in logs", async () => {
      const { bridge } = spy(() => [
        { event: { type: "error", message: "boom" } },
      ]);
      const adapter = new ClaudeAdapter({ bridge });
      const received: AgentRunEvent[] = [];
      const result = await adapter.run(makeContext(), (ev) => received.push(ev));
      expect(result.status).toBe("failed");
      const last = received[received.length - 1];
      expect(last?.type).toBe("error");
      if (last && last.type === "error") expect(last.message).toBe("boom");
    });
  });
});
