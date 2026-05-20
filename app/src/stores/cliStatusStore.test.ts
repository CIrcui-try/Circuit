import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockRuntimeBridge,
  type SpawnScenario,
} from "../runtime/bridge/RuntimeBridge.mock";
import { useCliStatusStore } from "./cliStatusStore";
import type { McpConfigStatus } from "../host/bridge";

function reset() {
  useCliStatusStore.setState({
    entries: {
      claude: { status: "idle" },
      codex: { status: "idle" },
    },
    mcpEntries: {
      claude: { status: "idle" },
      codex: { status: "idle" },
    },
    isChecking: false,
    isCheckingMcp: false,
  });
}

function mcpStatus(
  overrides: Partial<McpConfigStatus> = {},
): McpConfigStatus {
  return {
    claude: {
      config: {
        path: "/Users/me/.claude.json",
        ok: true,
        missing: false,
        message: null,
      },
      authCache: {
        path: "/Users/me/.claude/mcp-needs-auth-cache.json",
        ok: false,
        missing: true,
        message: "file not found",
      },
      servers: [
        {
          provider: "claude",
          scope: "global",
          name: "linear",
          args: [],
          hasEnv: false,
        },
      ],
    },
    codex: {
      config: {
        path: "/Users/me/.codex/config.toml",
        ok: true,
        missing: false,
        message: null,
      },
      servers: [],
    },
    ...overrides,
  };
}

describe("useCliStatusStore", () => {
  beforeEach(reset);

  it("marks both entries ok with captured version on successful probes", async () => {
    const scenario: SpawnScenario = (opts) => {
      if (opts.command === "claude") {
        return [
          { event: { type: "stdout", text: "claude 1.2.3\n" } },
          { event: { type: "exited", exitCode: 0 } },
        ];
      }
      return [
        { event: { type: "stdout", text: "codex 0.4.0\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    };
    const bridge = createMockRuntimeBridge({ scenario });

    await useCliStatusStore.getState().runChecks({ bridge });

    const { entries, isChecking } = useCliStatusStore.getState();
    expect(isChecking).toBe(false);
    expect(entries.claude.status).toBe("ok");
    expect(entries.claude.version).toBe("claude 1.2.3");
    expect(entries.codex.status).toBe("ok");
    expect(entries.codex.version).toBe("codex 0.4.0");
  });

  it("marks ENOENT result as missing and other CLI as ok independently", async () => {
    const scenario: SpawnScenario = (opts) => {
      if (opts.command === "claude") {
        return [{ event: { type: "error", message: "spawn claude ENOENT" } }];
      }
      return [
        { event: { type: "stdout", text: "codex 0.4.0\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    };
    const bridge = createMockRuntimeBridge({ scenario });

    await useCliStatusStore.getState().runChecks({ bridge });

    const { entries } = useCliStatusStore.getState();
    expect(entries.claude.status).toBe("missing");
    expect(entries.claude.errorMessage).toContain("ENOENT");
    expect(entries.claude.detailLog).toContain("Command: claude --version");
    expect(entries.claude.detailLog).toContain("Reason: missing");
    expect(entries.claude.detailLog).toContain("spawn claude ENOENT");
    expect(entries.codex.status).toBe("ok");
    expect(entries.codex.detailLog).toBeUndefined();
  });

  it("includes stderr and exit code in detail log for non-zero probes", async () => {
    const scenario: SpawnScenario = (opts) => {
      if (opts.command === "claude") {
        return [
          { event: { type: "stderr", text: "not authenticated\n" } },
          { event: { type: "exited", exitCode: 2 } },
        ];
      }
      return [
        { event: { type: "stdout", text: "codex 0.4.0\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    };
    const bridge = createMockRuntimeBridge({ scenario });

    await useCliStatusStore.getState().runChecks({ bridge });

    const { entries } = useCliStatusStore.getState();
    expect(entries.claude.status).toBe("error");
    expect(entries.claude.detailLog).toContain("Reason: non-zero");
    expect(entries.claude.detailLog).toContain("Exit Code: 2");
    expect(entries.claude.detailLog).toContain("STDERR:");
    expect(entries.claude.detailLog).toContain("not authenticated");
  });

  it("marks timeout as error", async () => {
    const scenario: SpawnScenario = () => [{ event: { type: "timeout" } }];
    const bridge = createMockRuntimeBridge({ scenario });

    await useCliStatusStore.getState().runChecks({ bridge, timeoutMs: 50 });

    const { entries } = useCliStatusStore.getState();
    expect(entries.claude.status).toBe("error");
    expect(entries.codex.status).toBe("error");
  });

  it("ignores re-entrant runChecks while one is already in-flight", async () => {
    let claudeCalls = 0;
    const scenario: SpawnScenario = (opts) => {
      if (opts.command === "claude") {
        claudeCalls += 1;
      }
      return [
        { event: { type: "stdout", text: `${opts.command} 1.0.0\n` } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    };
    const bridge = createMockRuntimeBridge({ scenario });
    const store = useCliStatusStore.getState();

    await Promise.all([
      store.runChecks({ bridge }),
      store.runChecks({ bridge }),
    ]);

    expect(claudeCalls).toBe(1);
  });

  it("transitions to checking state synchronously when runChecks starts", () => {
    const scenario: SpawnScenario = () => [
      { delayMs: 50, event: { type: "exited", exitCode: 0 } },
    ];
    const bridge = createMockRuntimeBridge({ scenario });

    const promise = useCliStatusStore.getState().runChecks({ bridge });

    const snapshot = useCliStatusStore.getState();
    expect(snapshot.isChecking).toBe(true);
    expect(snapshot.entries.claude.status).toBe("checking");
    expect(snapshot.entries.codex.status).toBe("checking");

    return promise;
  });

  it("maps MCP bridge status per provider", async () => {
    await useCliStatusStore.getState().runMcpChecks({
      bridge: {
        readMcpConfigStatus: async () => mcpStatus(),
      },
    });

    const { mcpEntries, isCheckingMcp } = useCliStatusStore.getState();
    expect(isCheckingMcp).toBe(false);
    expect(mcpEntries.claude.status).toBe("ok");
    expect(mcpEntries.claude.serverCount).toBe(1);
    expect(mcpEntries.codex.status).toBe("ok");
    expect(mcpEntries.codex.serverCount).toBe(0);
  });

  it("keeps missing and parse failures as provider-specific MCP errors", async () => {
    await useCliStatusStore.getState().runMcpChecks({
      bridge: {
        readMcpConfigStatus: async () =>
          mcpStatus({
            claude: {
              config: {
                path: "/Users/me/.claude.json",
                ok: false,
                missing: true,
                message: "file not found",
              },
              authCache: {
                path: "/Users/me/.claude/mcp-needs-auth-cache.json",
                ok: false,
                missing: true,
                message: "file not found",
              },
              servers: [],
            },
            codex: {
              config: {
                path: "/Users/me/.codex/config.toml",
                ok: false,
                missing: false,
                message: "failed to parse TOML",
              },
              servers: [],
            },
          }),
      },
    });

    const { mcpEntries } = useCliStatusStore.getState();
    expect(mcpEntries.claude.status).toBe("missing");
    expect(mcpEntries.claude.errorMessage).toBe("file not found");
    expect(mcpEntries.claude.detailLog).toContain("Config:");
    expect(mcpEntries.codex.status).toBe("error");
    expect(mcpEntries.codex.errorMessage).toBe("failed to parse TOML");
    expect(mcpEntries.codex.detailLog).toContain("failed to parse TOML");
  });

  it("refreshAll runs CLI and MCP checks together", async () => {
    const bridge = createMockRuntimeBridge({
      scenario: (opts) => [
        { event: { type: "stdout", text: `${opts.command} 1.0.0\n` } },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });
    let mcpCalls = 0;

    await useCliStatusStore.getState().refreshAll({
      bridge,
      hostBridge: {
        readMcpConfigStatus: async () => {
          mcpCalls += 1;
          return mcpStatus();
        },
      },
    });

    const { entries, mcpEntries } = useCliStatusStore.getState();
    expect(entries.claude.status).toBe("ok");
    expect(mcpEntries.claude.status).toBe("ok");
    expect(mcpCalls).toBe(1);
  });
});
