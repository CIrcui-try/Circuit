import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => ({
    openRepositoryDialog: vi.fn(),
    scanSkills: vi.fn(async () => []),
    loadRepositories: vi.fn(async () => null),
    saveRepositories: vi.fn(async () => {}),
    listWorkflows: vi.fn(async () => []),
    loadWorkflow: vi.fn(async () => "{}"),
    saveWorkflow: vi.fn(async () => {}),
  }),
}));

import { Sidebar } from "./Sidebar";
import { PropertiesPanel } from "./PropertiesPanel";
import { LogPanel } from "./LogPanel";
import { CANVAS_FIT_VIEW_OPTIONS, Canvas } from "./Canvas";
import { SkillNode, nodeTypes } from "../canvas/SkillNode";
import { useWorkflowStore } from "../../stores/workflowStore";
import { useRunLogStore } from "../../runner/runLogStore";
import { useRunStore } from "../../runner/runStore";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
  useRunLogStore.getState().reset();
  useRunStore.getState().reset();
});

describe("Layout shell", () => {
  it("Sidebar renders header and 'no repository selected' empty hint", () => {
    render(<Sidebar />);
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(/No repository selected/i)).toBeInTheDocument();
  });

  it("PropertiesPanel renders header and empty hint", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("LogPanel renders header and empty hint", () => {
    render(<LogPanel />);
    expect(screen.getByText("Run Log")).toBeInTheDocument();
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.getByTestId("run-log-copy")).toBeDisabled();
    expect(screen.getByTestId("run-log-clear")).toBeDisabled();
  });

  it("LogPanel header identifies active waiting and idle node", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useRunStore.getState().beginRun({
      runId: "run_abcdef123",
      workflowId: "wf",
      nodeIds: [id],
      startedAt: "t",
    });
    useRunStore.getState().setActiveNode(id);
    useRunStore.getState().setNodeState(id, "waiting_input");
    useRunStore.getState().patchNodeDebug(id, { idleSince: "t2" });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-run-state")).toHaveTextContent(
      /run run_abcd.*running.*Foo.*waiting for input.*idle/,
    );
  });

  it("LogPanel header shows terminal elapsed time", () => {
    useRunStore.setState({
      status: "success",
      runId: "run_abcdef123",
      workflowId: "wf",
      workflowName: null,
      repositoryId: null,
      repositoryName: null,
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:05.000Z",
      activeNodeId: null,
      nodeStates: {},
      nodeDebug: {},
      snapshot: null,
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-run-state")).toHaveTextContent(
      "run run_abcd · success · 0:05",
    );
  });

  it("LogPanel copies the visible run log and node results", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: "hello from stdout",
    });
    useRunLogStore.getState().appendEvent("node-b", {
      type: "status",
      timestamp: "t2",
      status: "running command",
    });
    useRunLogStore.getState().setNodeResult("node-a", {
      status: "success",
      exitCode: 0,
      logs: [],
      startedAt: "t1",
      finishedAt: "t3",
    });

    render(<LogPanel />);

    fireEvent.click(screen.getByTestId("run-log-copy"));
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("node-a\tstdout\thello from stdout");
    expect(copied).toContain("node-b\tstatus\trunning command");
    expect(copied).toContain("node-a\tresult\tsuccess (exit 0)");
    expect(await screen.findByTestId("run-log-copy-feedback")).toHaveTextContent(
      "Copied",
    );
  });

  it("LogPanel groups consecutive stdout and stderr entries behind summaries", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: "first stdout\n",
    });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t2",
      text: "second stdout\n",
    });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t3",
      text: "first stderr\n",
    });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t4",
      text: "second stderr\n",
    });

    render(<LogPanel />);

    const groups = screen.getAllByTestId("run-log-stream-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent("node-a");
    expect(groups[0]).toHaveTextContent("stdout");
    expect(groups[0]).toHaveTextContent("2 lines - first stdout");
    expect(groups[1]).toHaveTextContent("stderr");
    expect(groups[1]).toHaveTextContent("2 lines - first stderr");
    expect(screen.queryAllByTestId("run-log-line")).toHaveLength(0);
  });

  it("LogPanel shows provider chips instead of workflow node ids when available", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent(id, {
      type: "stdout",
      timestamp: "t1",
      text: "hello from codex\n",
    });
    useRunLogStore.getState().setNodeResult(id, {
      status: "success",
      exitCode: 0,
      logs: [],
      startedAt: "t1",
      finishedAt: "t2",
    });

    render(<LogPanel />);

    const providers = screen.getAllByTestId("run-log-provider");
    expect(providers).toHaveLength(2);
    expect(providers[0]).toHaveTextContent("codex");
    expect(providers[0]).toHaveClass("skill-list__chip--codex");
    expect(screen.getByTestId("run-log")).not.toHaveTextContent(id);
  });

  it("LogPanel summarizes stderr with the user-facing line after Codex metadata", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t1",
      text: [
        "Reading additional input from stdin...",
        "OpenAI Codex v0.128.0 (research preview)",
        "--------",
        "workdir: /Users/kai.lee/Documents/Github/Others/Circuit",
        "`landing`을 중단했습니다. PR 머지 확인이 불가능했습니다.",
      ].join("\n"),
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-stream-group")).toHaveTextContent(
      "5 lines - `landing`을 중단했습니다. PR 머지 확인이 불가능했습니다.",
    );
  });

  it("LogPanel prefers CIRCUIT_SUMMARY lines over heuristic stream summaries", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: [
        "현재 상태를 확인합니다.",
        "`taxiing` 실행을 중단했습니다. 입력에 이슈 ID가 없습니다.",
        "CIRCUIT_SUMMARY: taxiing 중단 - 이슈 ID 입력이 필요합니다.",
      ].join("\n"),
    });

    const { container } = render(<LogPanel />);
    const summary = container.querySelector(".run-log__summary-row");

    expect(summary).toHaveTextContent(
      "3 lines - taxiing 중단 - 이슈 ID 입력이 필요합니다.",
    );
    expect(summary).not.toHaveTextContent("CIRCUIT_SUMMARY:");
  });

  it("LogPanel skips tokens used and token counts when picking a stream summary", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t1",
      text: ["tokens used", "22,708", "현재 상태: PR 머지 확인 불가"].join(
        "\n",
      ),
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-stream-group")).toHaveTextContent(
      "3 lines - 현재 상태: PR 머지 확인 불가",
    );
  });

  it("LogPanel prefers failure summaries over ordinary progress lines", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: [
        "현재 상태를 확인합니다.",
        "`taxiing` 실행을 중단했습니다. 입력에 이슈 ID가 없습니다.",
      ].join("\n"),
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-stream-group")).toHaveTextContent(
      "2 lines - `taxiing` 실행을 중단했습니다. 입력에 이슈 ID가 없습니다.",
    );
  });

  it("LogPanel falls back to only the line count when every stream line is noise", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t1",
      text: ["Reading additional input from stdin...", "tokens used", "22,708"].join(
        "\n",
      ),
    });

    render(<LogPanel />);

    const group = screen.getByTestId("run-log-stream-group");
    expect(group).toHaveTextContent("3 lines");
    expect(group).not.toHaveTextContent(" - ");
  });

  it("LogPanel keeps approval prompts actionable instead of folding them into the summary", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "approval_required",
      timestamp: "t1",
      requestId: "approval-1",
      prompt: "Allow this command?",
      approvalKind: "command",
    });

    render(<LogPanel runtimeBridgeOverride={{ sendInput: vi.fn() }} />);

    expect(screen.getByTestId("approval-prompt")).toHaveTextContent(
      "Allow this command?",
    );
    expect(screen.getByTestId("approval-allow")).toBeEnabled();
    expect(screen.queryAllByTestId("run-log-line")).toHaveLength(0);
  });

  it("LogPanel highlights failed node results in the summary timeline", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().setNodeResult("node-a", {
      status: "failed",
      exitCode: 2,
      logs: [],
      startedAt: "t1",
      finishedAt: "t2",
    });

    render(<LogPanel />);

    const result = screen.getByTestId("run-log-result");
    expect(result).toHaveTextContent("node-a");
    expect(result).toHaveTextContent("failed (exit 2)");
    expect(result).toHaveClass("run-log__line--result-failed");
  });

  it("LogPanel clears visible run log entries when the run is idle", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: "hello from stdout",
    });
    useRunLogStore.getState().setNodeResult("node-a", {
      status: "success",
      exitCode: 0,
      logs: [],
      startedAt: "t1",
      finishedAt: "t2",
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-clear")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("run-log-clear"));

    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("run-log-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-log-result")).not.toBeInTheDocument();
    expect(useRunLogStore.getState().events).toEqual([]);
    expect(useRunLogStore.getState().nodeResults).toEqual({});
  });

  it("LogPanel keeps clear disabled while a run is active", () => {
    useRunStore.getState().beginRun({
      runId: "run_42",
      workflowId: "wf",
      nodeIds: ["node-a"],
      startedAt: "t1",
    });
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: "still running",
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-clear")).toBeDisabled();
  });

  it("LogPanel keeps the header outside the scrollable log list", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stdout",
      timestamp: "t1",
      text: "first line",
    });

    const { container } = render(<LogPanel />);

    const panel = container.querySelector(".workspace__log");
    const header = container.querySelector(".panel-header");
    const log = screen.getByTestId("run-log");

    expect(panel?.firstElementChild).toBe(header);
    expect(log.parentElement).toBe(panel);
    expect(header?.contains(log)).toBe(false);
  });

  it("Canvas mounts a ReactFlow surface", () => {
    const { container } = render(<Canvas />);
    expect(container.querySelector(".react-flow")).not.toBeNull();
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });

  it("Canvas caps fitView zoom so a single node is not enlarged", () => {
    expect(CANVAS_FIT_VIEW_OPTIONS.maxZoom).toBe(1);
  });

  it("nodeTypes registers a 'skill' custom node", () => {
    expect(nodeTypes.skill).toBeDefined();
  });

  it("SkillNode shows when no input is configured", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    expect(screen.getByTestId("workflow-node")).toHaveAttribute(
      "data-input-state",
      "none",
    );
    expect(screen.getByTestId("skill-node-input-summary")).toHaveTextContent(
      "No input configured",
    );
  });

  it("SkillNode Edit selects the node for input editing", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));

    expect(useWorkflowStore.getState().selectedNodeId).toBe("node-1");
    expect(screen.getByTestId("skill-node-input-popover")).toBeInTheDocument();
  });

  it("SkillNode input popover edits command-style node arguments", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/takeoff",
        provider: "codex",
        name: "takeoff",
        description: "",
        rootDir: ".codex/skills/takeoff",
        skillFile: ".codex/skills/takeoff/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    const node = useWorkflowStore.getState().nodes[0];
    renderSkillNode({
      id,
      selected: false,
      data: node.data,
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));
    fireEvent.change(screen.getByTestId("skill-node-input-arguments"), {
      target: { value: "CIR-43 --force" },
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-43 --force",
    });
  });

  it("SkillNode input popover closes from its close button", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));
    fireEvent.click(screen.getByLabelText("Close input editor"));

    expect(screen.queryByTestId("skill-node-input-popover")).not.toBeInTheDocument();
  });

  it("SkillNode input popover closes from Done", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));
    fireEvent.click(screen.getByTestId("skill-node-input-done"));

    expect(screen.queryByTestId("skill-node-input-popover")).not.toBeInTheDocument();
  });

  it("SkillNode input popover saves and closes on Enter", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/takeoff",
        provider: "codex",
        name: "takeoff",
        description: "",
        rootDir: ".codex/skills/takeoff",
        skillFile: ".codex/skills/takeoff/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    const node = useWorkflowStore.getState().nodes[0];
    renderSkillNode({
      id,
      selected: false,
      data: node.data,
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));
    fireEvent.change(screen.getByTestId("skill-node-input-arguments"), {
      target: { value: "CIR-46" },
    });
    fireEvent.keyDown(screen.getByTestId("skill-node-input-arguments"), {
      key: "Enter",
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-46",
    });
    expect(screen.queryByTestId("skill-node-input-popover")).not.toBeInTheDocument();
  });

  it("SkillNode summarizes configured input on one line", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
        input: {
          prompt: "Summarize a very long upstream output before running",
          timeoutMs: 120000,
        },
      },
    });

    expect(screen.getByTestId("workflow-node")).toHaveAttribute(
      "data-input-state",
      "present",
    );
    expect(screen.queryByText("Input set")).not.toBeInTheDocument();
    expect(screen.getByText("prompt")).toHaveClass("skill-node__input-key");
    expect(screen.getByText(/Summarize a very long/).closest(".skill-node__input-summary")).toHaveAttribute(
      "title",
      expect.stringContaining("timeoutMs: 120000"),
    );
  });

  it("SkillNode marks non-object input as invalid", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
        input: "bad",
      },
    });

    expect(screen.getByTestId("workflow-node")).toHaveAttribute(
      "data-input-state",
      "invalid",
    );
    expect(screen.getByText("Input data cannot be previewed")).toBeInTheDocument();
  });

  it("LogPanel renders an inline ApprovalPrompt for each pendingApproval and routes Allow → sendInput", async () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "approval_required",
      timestamp: "t",
      requestId: "rq-1",
      prompt: "Do you trust this directory?",
      approvalKind: "trust",
    });

    const sendInput = vi.fn(async () => {});
    render(<LogPanel runtimeBridgeOverride={{ sendInput }} />);

    const prompt = screen.getByTestId("approval-prompt");
    expect(prompt).toHaveAttribute("data-request-id", "rq-1");
    expect(prompt.textContent).toContain("Do you trust this directory?");

    fireEvent.click(screen.getByTestId("approval-allow"));
    // Microtask flush for the await inside handleRespond.
    await Promise.resolve();
    await Promise.resolve();

    expect(sendInput).toHaveBeenCalledWith("run_42", "y\n");
    expect(useRunLogStore.getState().pendingApprovals).toEqual({});
  });
});

function renderSkillNode(props: Partial<NodeProps<SkillNodeType>>) {
  render(
    <ReactFlowProvider>
      <SkillNode {...(props as NodeProps<SkillNodeType>)} />
    </ReactFlowProvider>,
  );
}
