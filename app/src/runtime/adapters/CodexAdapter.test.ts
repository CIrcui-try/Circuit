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
import { CodexAdapter } from "./CodexAdapter";

function makeContext(over: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: "run_001",
    workflowId: "wf_001",
    nodeId: "node_review",
    repository: {
      id: "repo_001",
      name: "sample-repo",
      path: "/abs/path/to/sample-repo",
    },
    skill: {
      provider: "codex",
      name: "review-pr",
      rootDir: "/abs/path/to/sample-repo/.codex/skills/review-pr",
      skillFile: ".codex/skills/review-pr/SKILL.md",
      skillFileAbsPath:
        "/abs/path/to/sample-repo/.codex/skills/review-pr/SKILL.md",
      content: "# review-pr\n\nReview the diff.\n",
    },
    input: { prompt: "review the diff" },
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

describe("CodexAdapter", () => {
  it("C1 — provider is 'codex'", () => {
    const { bridge } = spy();
    const adapter = new CodexAdapter({ bridge });
    expect(adapter.provider).toBe("codex");
  });

  it("C2 — canRun returns ok when probe exits 0", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("codex");
    expect(spawnCalls[0].args).toEqual(["--version"]);
    expect(spawnCalls[0].cwd).toBe("/abs/path/to/sample-repo");
  });

  it("C3 — canRun returns ok=false with exitCode detail when probe exits non-zero", async () => {
    const { bridge } = spy(() => [
      { event: { type: "exited", exitCode: 127 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain("127");
    expect(availability.details).toMatchObject({ exitCode: 127 });
  });

  it("C4 — canRun returns ok=false with reason when probe emits error", async () => {
    const { bridge } = spy(() => [
      { event: { type: "error", message: "ENOENT" } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    const availability = await adapter.canRun(makeContext());
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain("ENOENT");
  });

  it("C5 — canRun with skipProbe returns ok immediately and does not spawn", async () => {
    const { bridge, spawnCalls } = spy();
    const adapter = new CodexAdapter({ bridge, skipProbe: true });
    const availability = await adapter.canRun(makeContext());
    expect(availability).toEqual({ ok: true, details: { skipped: true } });
    expect(spawnCalls).toHaveLength(0);
  });

  it("C6 — run forwards cwd, env, timeoutMs from ctx.execution to spawn", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    await adapter.run(makeContext(), () => {});
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/abs/path/to/sample-repo");
    expect(spawnCalls[0].env).toEqual({ FOO: "bar" });
    expect(spawnCalls[0].timeoutMs).toBe(300_000);
  });

  it("C7 — default command is 'codex exec <prompt>' with full prompt content (sandbox not bypassed)", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
    await adapter.run(makeContext(), () => {});
    expect(spawnCalls[0].command).toBe("codex");
    const args = spawnCalls[0].args;
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("exec");
    // Phase 16: interactive prompts are now forwarded via stdin, so the
    // adapter must not bake `--dangerously-bypass-approvals-and-sandbox` (or
    // any sandbox-disabling flag) into the default command.
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--skip-git-repo-check");
    const prompt = args[1];
    expect(prompt).toContain("review-pr");
    expect(prompt).toContain("Review the diff.");
    expect(prompt).toContain(`"prompt": "review the diff"`);
  });

  it("C8 — custom buildCommand and buildPrompt are honored", async () => {
    const { bridge, spawnCalls } = spy(() => [
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({
      bridge,
      buildPrompt: (ctx) => `PROMPT:${ctx.skill.name}`,
      buildCommand: (_ctx, prompt) => ({
        command: "/usr/local/bin/codex-wrapper",
        args: ["chat", "--input", prompt],
      }),
    });
    await adapter.run(makeContext(), () => {});
    expect(spawnCalls[0].command).toBe("/usr/local/bin/codex-wrapper");
    expect(spawnCalls[0].args).toEqual([
      "chat",
      "--input",
      "PROMPT:review-pr",
    ]);
  });

  it("C9 — runtime started/stdout/stderr/exited map to AgentRunEvent in order", async () => {
    const { bridge } = spy(() => [
      { event: { type: "started" } },
      { event: { type: "stdout", text: "hello\n" } },
      { event: { type: "stderr", text: "warn\n" } },
      { event: { type: "exited", exitCode: 0 } },
    ]);
    const adapter = new CodexAdapter({ bridge });
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
    const adapter = new CodexAdapter({ bridge });
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
      const adapter = new CodexAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(2);
    });

    it("cancelled → status=cancelled", async () => {
      const { bridge } = spy(() => [{ event: { type: "cancelled" } }]);
      const adapter = new CodexAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("cancelled");
      expect(result.exitCode).toBeUndefined();
    });

    it("timeout → status=timeout", async () => {
      const { bridge } = spy(() => [{ event: { type: "timeout" } }]);
      const adapter = new CodexAdapter({ bridge });
      const result = await adapter.run(makeContext(), () => {});
      expect(result.status).toBe("timeout");
      expect(result.exitCode).toBeUndefined();
    });

    it("error → status=failed with error event in logs", async () => {
      const { bridge } = spy(() => [
        { event: { type: "error", message: "boom" } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      const received: AgentRunEvent[] = [];
      const result = await adapter.run(makeContext(), (ev) => received.push(ev));
      expect(result.status).toBe("failed");
      const last = received[received.length - 1];
      expect(last?.type).toBe("error");
      if (last && last.type === "error") expect(last.message).toBe("boom");
    });
  });

  describe("C13 — previousOutputs are folded into the prompt", () => {
    it("prepends an '# Upstream Outputs' section listing prior nodes' stdout", async () => {
      const { bridge, spawnCalls } = spy(() => [
        { event: { type: "exited", exitCode: 0 } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      const ctx = makeContext({
        previousOutputs: {
          a: {
            status: "success",
            exitCode: 0,
            logs: [
              {
                type: "stdout",
                timestamp: "t",
                text: "plus_one: 1\n",
              },
            ],
            startedAt: "t",
            finishedAt: "t",
          },
        },
      });
      await adapter.run(ctx, () => {});
      const prompt = spawnCalls[0].args[1];
      expect(prompt).toContain("# Upstream Outputs");
      expect(prompt).toContain("## a  (status: success, exit: 0)");
      expect(prompt).toContain("plus_one: 1");
    });

    it("omits the upstream section entirely when previousOutputs is empty", async () => {
      const { bridge, spawnCalls } = spy(() => [
        { event: { type: "exited", exitCode: 0 } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      await adapter.run(makeContext(), () => {});
      const prompt = spawnCalls[0].args[1];
      expect(prompt).not.toContain("# Upstream Outputs");
    });
  });

  describe("C12 — codex prompt-echo stderr filtering", () => {
    it("drops stderr lines between 'user' and 'codex' markers (and the markers themselves), passing other stderr through", async () => {
      const { bridge } = spy(() => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "OpenAI Codex v0.128.0" } },
        { event: { type: "stderr", text: "--------" } },
        { event: { type: "stderr", text: "user" } },
        { event: { type: "stderr", text: "# Skill: hello-world" } },
        { event: { type: "stderr", text: "<SKILL.md body line>" } },
        { event: { type: "stderr", text: "# Input" } },
        { event: { type: "stderr", text: "{}" } },
        { event: { type: "stderr", text: "codex" } },
        { event: { type: "stderr", text: "tokens used" } },
        { event: { type: "stderr", text: "1,234" } },
        { event: { type: "stdout", text: "hello world" } },
        { event: { type: "exited", exitCode: 0 } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      const received: AgentRunEvent[] = [];
      await adapter.run(makeContext(), (ev) => received.push(ev));

      const stderrTexts = received
        .filter((e): e is Extract<AgentRunEvent, { type: "stderr" }> =>
          e.type === "stderr",
        )
        .map((e) => e.text);
      expect(stderrTexts).toEqual([
        "OpenAI Codex v0.128.0",
        "--------",
        "tokens used",
        "1,234",
      ]);

      const stdouts = received.filter((e) => e.type === "stdout");
      expect(stdouts).toHaveLength(1);
    });

    it("passes stderr through unchanged when no 'user'/'codex' markers appear", async () => {
      const { bridge } = spy(() => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "warn: something" } },
        { event: { type: "stderr", text: "another note" } },
        { event: { type: "exited", exitCode: 0 } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      const received: AgentRunEvent[] = [];
      await adapter.run(makeContext(), (ev) => received.push(ev));

      const stderrTexts = received
        .filter((e): e is Extract<AgentRunEvent, { type: "stderr" }> =>
          e.type === "stderr",
        )
        .map((e) => e.text);
      expect(stderrTexts).toEqual(["warn: something", "another note"]);
    });

    it("matches markers only on exact trim equality (not substrings)", async () => {
      const { bridge } = spy(() => [
        { event: { type: "started" } },
        { event: { type: "stderr", text: "user input received" } },
        { event: { type: "stderr", text: "codex started" } },
        { event: { type: "exited", exitCode: 0 } },
      ]);
      const adapter = new CodexAdapter({ bridge });
      const received: AgentRunEvent[] = [];
      await adapter.run(makeContext(), (ev) => received.push(ev));

      const stderrTexts = received
        .filter((e): e is Extract<AgentRunEvent, { type: "stderr" }> =>
          e.type === "stderr",
        )
        .map((e) => e.text);
      expect(stderrTexts).toEqual(["user input received", "codex started"]);
    });
  });
});
