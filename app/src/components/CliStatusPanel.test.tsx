import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMockRuntimeBridge,
  type MockRuntimeBridgeOptions,
  type MockRuntimeBridge,
  type SpawnScenario,
} from "../runtime/bridge/RuntimeBridge.mock";
import { useCliStatusStore } from "../stores/cliStatusStore";
import { resetCliSettingsCacheForTest } from "../stores/cliSettingsStore";
import { CliStatusPanel } from "./CliStatusPanel";

function resetStore() {
  useCliStatusStore.setState({
    entries: { claude: { status: "idle" }, codex: { status: "idle" } },
    isChecking: false,
  });
}

function installBridge(
  scenario: SpawnScenario,
  resolveCli?: MockRuntimeBridgeOptions["resolveCli"],
): MockRuntimeBridge {
  const bridge = createMockRuntimeBridge({ scenario, resolveCli });
  window.__CIRCUIT_RUNTIME__ = bridge;
  return bridge;
}

describe("CliStatusPanel", () => {
  beforeEach(() => {
    resetStore();
    resetCliSettingsCacheForTest();
  });
  afterEach(() => {
    delete window.__CIRCUIT_RUNTIME__;
    delete window.__CIRCUIT_BRIDGE__;
    resetCliSettingsCacheForTest();
  });

  it("triggers a probe on mount and renders ok rows when both CLIs respond", async () => {
    let claudeCalls = 0;
    installBridge((opts) => {
      if (opts.command === "claude") claudeCalls += 1;
      return [
        { event: { type: "stdout", text: `${opts.command} 1.0.0\n` } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    });

    render(<CliStatusPanel />);

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe("ok");
    });

    const claudeRow = screen.getByTestId("cli-status-row-claude");
    expect(claudeRow.getAttribute("data-status")).toBe("ok");
    expect(claudeRow.textContent).toContain("claude 1.0.0");
    expect(screen.queryByTestId("cli-status-detail-claude")).not.toBeInTheDocument();
    const codexRow = screen.getByTestId("cli-status-row-codex");
    expect(codexRow.getAttribute("data-status")).toBe("ok");
    expect(screen.queryByTestId("cli-status-detail-codex")).not.toBeInTheDocument();
    expect(claudeCalls).toBe(1);
  });

  it("renders a missing row for ENOENT and opens the detail log", async () => {
    installBridge((opts) => {
      if (opts.command === "claude") {
        return [{ event: { type: "error", message: "spawn claude ENOENT" } }];
      }
      return [
        { event: { type: "stdout", text: "codex 1.0.0\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    });

    render(<CliStatusPanel />);

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe(
        "missing",
      );
    });

    const claudeRow = screen.getByTestId("cli-status-row-claude");
    expect(claudeRow.getAttribute("data-status")).toBe("missing");
    expect(claudeRow.textContent).toContain("ENOENT");

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("cli-status-detail-claude"));
    });

    expect(screen.getByTestId("cli-status-detail-modal")).toBeInTheDocument();
    expect(screen.getByText("Claude CLI details")).toBeInTheDocument();
    const log = screen.getByTestId("cli-status-detail-log");
    expect(log).toHaveTextContent("Command: claude --version");
    expect(log).toHaveTextContent("Reason: missing");
    expect(log).toHaveTextContent("spawn claude ENOENT");
  });

  it("shows resolver details for app-environment misses", async () => {
    installBridge(
      () => [
        { event: { type: "stdout", text: "codex 1.0.0\n" } },
        { event: { type: "exited", exitCode: 0 } },
      ],
      (command) => {
        if (command === "claude") {
          return {
            command,
            ok: false,
            resolvedPath: null,
            source: null,
            errorMessage: "claude was not found in the app environment",
            processPath: "/usr/bin:/bin",
            loginShell: "/bin/zsh",
            attempts: [
              {
                source: "processPath",
                ok: false,
                detail: "not found in current PATH",
                path: null,
              },
              {
                source: "knownLocation",
                ok: false,
                detail: "not found in known CLI location",
                path: "/opt/homebrew/bin/claude",
              },
            ],
          };
        }
        return {
          command,
          ok: true,
          resolvedPath: command,
          source: "processPath",
          errorMessage: null,
          processPath: "/usr/bin:/bin",
          loginShell: null,
          attempts: [],
        };
      },
    );

    render(<CliStatusPanel />);

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe(
        "missing",
      );
    });

    expect(screen.getByTestId("cli-status-row-claude")).toHaveTextContent(
      "claude was not found in the app environment",
    );

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("cli-status-detail-claude"));
    });

    const log = screen.getByTestId("cli-status-detail-log");
    expect(log).toHaveTextContent("CLI Resolution:");
    expect(log).toHaveTextContent("Process PATH: /usr/bin:/bin");
    expect(log).toHaveTextContent("/opt/homebrew/bin/claude");
  });

  it("saves a manual path and re-runs checks", async () => {
    let savedSettings: unknown = null;
    let lastManualPath: string | null | undefined;
    window.__CIRCUIT_BRIDGE__ = {
      loadCliSettings: async () => ({}),
      saveCliSettings: async (settings) => {
        savedSettings = settings;
      },
    } as typeof window.__CIRCUIT_BRIDGE__;

    installBridge(
      (opts) => [
        { event: { type: "stdout", text: `${opts.command} 1.0.0\n` } },
        { event: { type: "exited", exitCode: 0 } },
      ],
      (command, manualPath) => {
        if (command === "claude") lastManualPath = manualPath;
        if (command === "claude" && !manualPath) {
          return {
            command,
            ok: false,
            resolvedPath: null,
            source: null,
            errorMessage: "claude was not found in the app environment",
            processPath: "",
            loginShell: null,
            attempts: [
              {
                source: "processPath",
                ok: false,
                detail: "not found in current PATH",
                path: null,
              },
            ],
          };
        }
        return {
          command,
          ok: true,
          resolvedPath: manualPath ?? command,
          source: manualPath ? "manualOverride" : "processPath",
          errorMessage: null,
          processPath: "",
          loginShell: null,
          attempts: [],
        };
      },
    );

    render(<CliStatusPanel />);

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe(
        "missing",
      );
    });

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("cli-status-set-path-claude"));
      await user.type(
        screen.getByTestId("cli-status-path-input"),
        "/opt/homebrew/bin/claude",
      );
      await user.click(screen.getByTestId("cli-status-path-save"));
    });

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe("ok");
    });
    expect(savedSettings).toEqual({ claudePath: "/opt/homebrew/bin/claude" });
    expect(lastManualPath).toBe("/opt/homebrew/bin/claude");
  });

  it("re-runs checks when 'refresh' is clicked", async () => {
    let probeCount = 0;
    installBridge((opts) => {
      if (opts.command === "claude") probeCount += 1;
      return [
        { event: { type: "stdout", text: `${opts.command} 1.0.0\n` } },
        { event: { type: "exited", exitCode: 0 } },
      ];
    });

    render(<CliStatusPanel />);

    await waitFor(() => {
      expect(useCliStatusStore.getState().entries.claude.status).toBe("ok");
    });
    expect(probeCount).toBe(1);

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("cli-status-refresh"));
    });

    await waitFor(() => {
      expect(probeCount).toBe(2);
    });
    expect(useCliStatusStore.getState().entries.claude.status).toBe("ok");
  });

  it("disables the refresh button while checking", async () => {
    installBridge(() => [
      { delayMs: 50, event: { type: "exited", exitCode: 0 } },
    ]);

    render(<CliStatusPanel />);

    const button = screen.getByTestId(
      "cli-status-refresh",
    ) as HTMLButtonElement;

    await waitFor(() => {
      expect(button.disabled).toBe(true);
    });

    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });
});
