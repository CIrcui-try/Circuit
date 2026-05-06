import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockRuntimeBridge,
  type SpawnScenario,
} from "../runtime/bridge/RuntimeBridge.mock";
import { useCliStatusStore } from "./cliStatusStore";

function reset() {
  useCliStatusStore.setState({
    entries: {
      claude: { status: "idle" },
      codex: { status: "idle" },
    },
    isChecking: false,
  });
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
    expect(entries.codex.status).toBe("ok");
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
});
