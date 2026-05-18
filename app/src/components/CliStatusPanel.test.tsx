import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMockRuntimeBridge,
  type MockRuntimeBridge,
  type SpawnScenario,
} from "../runtime/bridge/RuntimeBridge.mock";
import { useCliStatusStore } from "../stores/cliStatusStore";
import { CliStatusPanel } from "./CliStatusPanel";

function resetStore() {
  useCliStatusStore.setState({
    entries: { claude: { status: "idle" }, codex: { status: "idle" } },
    isChecking: false,
  });
}

function installBridge(scenario: SpawnScenario): MockRuntimeBridge {
  const bridge = createMockRuntimeBridge({ scenario });
  window.__CIRCUIT_RUNTIME__ = bridge;
  return bridge;
}

describe("CliStatusPanel", () => {
  beforeEach(resetStore);
  afterEach(() => {
    delete window.__CIRCUIT_RUNTIME__;
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
