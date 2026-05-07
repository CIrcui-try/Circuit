import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  RunPreviewModal,
  type RunPreviewNode,
} from "./RunPreviewModal";

function nodes(...overrides: Partial<RunPreviewNode>[]): RunPreviewNode[] {
  return overrides.map((o, i) => ({
    id: o.id ?? `n${i}`,
    label: o.label ?? "",
    provider: o.provider ?? "claude",
    skillFile: o.skillFile ?? `.claude/skills/n${i}/SKILL.md`,
    commandSummary: o.commandSummary ?? "claude --version",
    timeoutMs: o.timeoutMs ?? 60_000,
    sensitiveKeywords: o.sensitiveKeywords ?? [],
  }));
}

describe("RunPreviewModal", () => {
  it("M1: renders metadata and node rows when open", () => {
    render(
      <RunPreviewModal
        open
        workflowName="Demo"
        repoPath="/repo"
        nodes={nodes({}, { id: "b" })}
        allowedProviders={["claude", "codex"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("run-preview-modal")).toBeInTheDocument();
    expect(screen.getByTestId("run-preview-workflow-name")).toHaveTextContent(
      "Demo",
    );
    expect(screen.getByTestId("run-preview-repo-path")).toHaveTextContent(
      "/repo",
    );
    expect(screen.getByTestId("run-preview-allowlist")).toHaveTextContent(
      "claude, codex",
    );
    expect(screen.getAllByTestId("run-preview-node-row")).toHaveLength(2);
  });

  it("M2: renders nothing when open=false", () => {
    const { container } = render(
      <RunPreviewModal
        open={false}
        workflowName=""
        repoPath="/repo"
        nodes={[]}
        allowedProviders={["claude"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("M3: shows blocked warning and disables confirm when a node uses a non-allowed provider", () => {
    render(
      <RunPreviewModal
        open
        workflowName="X"
        repoPath="/r"
        nodes={nodes({ id: "evil", provider: "unknown" as never })}
        allowedProviders={["claude", "codex"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("run-preview-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("run-preview-confirm")).toBeDisabled();
  });

  it("M4: sensitive keywords warning + confirm only enables after ack", () => {
    render(
      <RunPreviewModal
        open
        workflowName="X"
        repoPath="/r"
        nodes={nodes({ id: "danger", sensitiveKeywords: ["push", "rm"] })}
        allowedProviders={["claude"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("run-preview-sensitive")).toBeInTheDocument();
    const confirm = screen.getByTestId("run-preview-confirm");
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByTestId("run-preview-ack"));
    expect(confirm).not.toBeDisabled();
  });

  it("M5: confirm and cancel buttons fire the right callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <RunPreviewModal
        open
        workflowName="X"
        repoPath="/r"
        nodes={nodes({})}
        allowedProviders={["claude"]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId("run-preview-confirm"));
    fireEvent.click(screen.getByTestId("run-preview-cancel"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
