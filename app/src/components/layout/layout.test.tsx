import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  ConnectionMode,
  MarkerType,
  ReactFlowProvider,
  type Edge,
  type NodeProps,
} from "@xyflow/react";

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => ({
    openRepositoryDialog: vi.fn(),
    scanSkills: vi.fn(async () => []),
    scanDefaultSkills: vi.fn(async () => []),
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
import {
  CANVAS_DEFAULT_EDGE_OPTIONS,
  CANVAS_CONNECTION_MODE,
  CANVAS_EDGE_MARKER,
  CANVAS_FIT_VIEW_OPTIONS,
  CANVAS_NODE_ORIGIN,
  Canvas,
  getCanvasNodeIdAtPoint,
  resolveEdgeHandleOverlap,
  toCanvasDropPosition,
  toNodeDropConnection,
  toRenderedCanvasEdges,
} from "./Canvas";
import { edgeTypes } from "../canvas/DependencyEdge";
import { SkillNode, nodeTypes } from "../canvas/SkillNode";
import { useRunLogStore } from "../../runner/runLogStore";
import { useRunStore } from "../../runner/runStore";
import { useSkillStore } from "../../stores/skillStore";
import {
  WORKFLOW_CYCLE_WARNING_MESSAGE,
  useWorkflowStore,
  type SkillNode as SkillNodeType,
} from "../../stores/workflowStore";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
  useRunLogStore.getState().reset();
  useRunStore.getState().reset();
  useSkillStore.setState({ byRepo: {}, defaultSkills: [], systemSkills: [], loading: {}, errors: {} });
  window.localStorage.clear();
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

  it("LogPanel header shows loop iteration only for cycle runs", () => {
    useRunStore.getState().beginRun({
      runId: "run_abcdef123",
      workflowId: "wf",
      nodeIds: ["node-1"],
      startedAt: "t",
      runMode: "cycle",
    });
    useRunStore.getState().setIteration(3);

    const { rerender } = render(<LogPanel />);

    expect(screen.getByTestId("run-log-run-state")).toHaveTextContent(
      /run run_abcd.*running.*loop 3/,
    );

    useRunStore.getState().beginRun({
      runId: "run_abcdef456",
      workflowId: "wf",
      nodeIds: ["node-1"],
      startedAt: "t",
      runMode: "dag",
    });
    rerender(<LogPanel />);

    expect(screen.getByTestId("run-log-run-state")).not.toHaveTextContent(
      /loop \d+/,
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
    const nodeA = useWorkflowStore.getState().addSkillNode(
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
    useRunLogStore.getState().appendEvent(nodeA, {
      type: "stdout",
      timestamp: "t1",
      text: "hello from stdout",
    });
    useRunLogStore.getState().appendEvent("node-b", {
      type: "status",
      timestamp: "t2",
      status: "running command",
    });
    useRunLogStore.getState().setNodeResult(nodeA, {
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
    expect(copied).toContain("Foo\tstdout\thello from stdout");
    expect(copied).toContain("node-b\tstatus\trunning command");
    expect(copied).toContain("Foo\tresult\tsuccess (exit 0)");
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

  it("LogPanel renders column headers above log rows", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "status",
      timestamp: "t1",
      status: "running command",
    });

    render(<LogPanel />);

    const header = screen.getByTestId("run-log-column-header");
    expect(header).toHaveTextContent("Provider");
    expect(header).toHaveTextContent("Skill");
    expect(header).toHaveTextContent("Type");
    expect(header).toHaveTextContent("Message");
    expect(screen.getByTestId("run-log").firstElementChild).toBe(header);
  });

  it("LogPanel resizes a column and persists the selected width", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "status",
      timestamp: "t1",
      status: "running command",
    });

    render(<LogPanel />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("run-log-resize-skill"), {
        clientX: 100,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 140 });
    });

    const log = screen.getByTestId("run-log");
    expect(log).toHaveStyle({ "--run-log-skill-width": "190px" });
    expect(window.localStorage.getItem("circuit.runLog.columns.v1")).toContain(
      '"skill":190',
    );
  });

  it("LogPanel restores persisted column widths from localStorage", () => {
    window.localStorage.setItem(
      "circuit.runLog.columns.v1",
      JSON.stringify({ provider: 120, skill: 260, type: 90, message: 640 }),
    );
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "status",
      timestamp: "t1",
      status: "running command",
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log")).toHaveStyle({
      "--run-log-provider-width": "120px",
      "--run-log-skill-width": "260px",
      "--run-log-type-width": "90px",
      "--run-log-message-width": "640px",
    });
  });

  it("LogPanel shows provider chips and skill names when available", () => {
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
    const skills = screen.getAllByTestId("run-log-skill");
    expect(skills).toHaveLength(2);
    expect(skills[0]).toHaveTextContent("Foo");
    expect(skills[0]).toHaveAttribute("title", id);
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

  it("LogPanel shows the full one-line CIRCUIT_SUMMARY in stream summaries", () => {
    const summaryText =
      "Planning is blocked because the provided prompt/arguments do not describe an implementable feature or concrete code change yet";
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().appendEvent("node-a", {
      type: "stderr",
      timestamp: "t1",
      text: `CIRCUIT_SUMMARY: ${summaryText}\n`,
    });

    render(<LogPanel />);

    const group = screen.getByTestId("run-log-stream-group");
    expect(group).toHaveTextContent(`1 line - ${summaryText}`);
    expect(group).not.toHaveTextContent("implementable fe...");
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

  it("LogPanel includes node result summaries in the result row", () => {
    useRunLogStore.getState().beginRun({ runId: "run_42", workflowId: "wf" });
    useRunLogStore.getState().setNodeResult("node-a", {
      status: "failed",
      exitCode: 0,
      summary:
        "Planning is blocked because the provided prompt/arguments do not describe an implementable feature or concrete code change yet",
      logs: [],
      startedAt: "t1",
      finishedAt: "t2",
    });

    render(<LogPanel />);

    expect(screen.getByTestId("run-log-result")).toHaveTextContent(
      "failed (exit 0) - Planning is blocked because the provided prompt/arguments do not describe an implementable feature or concrete code change yet",
    );
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

  it("Canvas shows and dismisses connection warning toast", () => {
    vi.useFakeTimers();
    try {
      useWorkflowStore.setState({
        connectionWarning: {
          id: "warning-1",
          message: WORKFLOW_CYCLE_WARNING_MESSAGE,
        },
      });

      render(<Canvas />);

      expect(screen.getByTestId("canvas-connection-warning")).toHaveTextContent(
        WORKFLOW_CYCLE_WARNING_MESSAGE,
      );

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByTestId("canvas-connection-warning")).toBeNull();
      expect(useWorkflowStore.getState().connectionWarning).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Canvas caps fitView zoom so a single node is not enlarged", () => {
    expect(CANVAS_FIT_VIEW_OPTIONS.maxZoom).toBe(1);
  });

  it("Canvas uses the node card center as the coordinate origin", () => {
    expect(CANVAS_NODE_ORIGIN).toEqual([0.5, 0.5]);
  });

  it("Canvas converts the drop pointer position without top-left offset", () => {
    const screenToFlowPosition = vi.fn(() => ({ x: 123, y: 456 }));

    const position = toCanvasDropPosition(screenToFlowPosition, {
      clientX: 123,
      clientY: 456,
    });

    expect(screenToFlowPosition).toHaveBeenCalledWith({
      x: 123,
      y: 456,
    });
    expect(position).toEqual({ x: 123, y: 456 });
  });

  it("Canvas uses an arrow marker for workflow edge ends", () => {
    expect(CANVAS_EDGE_MARKER).toMatchObject({
      type: MarkerType.ArrowClosed,
    });
  });

  it("Canvas registers a dependency edge renderer by default", () => {
    expect(edgeTypes.dependency).toBeDefined();
    expect(CANVAS_DEFAULT_EDGE_OPTIONS).toMatchObject({
      type: "dependency",
      markerEnd: CANVAS_EDGE_MARKER,
      interactionWidth: 18,
    });
  });

  it("Canvas uses loose connection mode so either handle can be a drop target", () => {
    expect(CANVAS_CONNECTION_MODE).toBe(ConnectionMode.Loose);
  });

  it("Canvas renders workflow edges as dependency edges with arrow markers", () => {
    const edges: Edge[] = [{ id: "a-b", source: "a", target: "b" }];

    expect(toRenderedCanvasEdges(edges)).toEqual([
      {
        id: "a-b",
        source: "a",
        target: "b",
        type: "dependency",
        data: {
          routeSlot: {
            source: { index: 0, count: 1 },
            target: { index: 0, count: 1 },
          },
        },
        markerEnd: CANVAS_EDGE_MARKER,
      },
    ]);
  });

  it("Canvas assigns separate route slots to edges sharing a source", () => {
    const edges: Edge[] = [
      { id: "a-b", source: "a", target: "b" },
      { id: "a-c", source: "a", target: "c" },
    ];

    expect(toRenderedCanvasEdges(edges).map((edge) => edge.data)).toEqual([
      {
        routeSlot: {
          source: { index: 0, count: 2 },
          target: { index: 0, count: 1 },
        },
      },
      {
        routeSlot: {
          source: { index: 1, count: 2 },
          target: { index: 0, count: 1 },
        },
      },
    ]);
  });

  it("Canvas separates overlapping input and output handle hints", () => {
    expect(
      resolveEdgeHandleOverlap({
        target: { side: "bottom", offset: 1 },
        source: { side: "bottom", offset: 3 },
      }),
    ).toEqual({
      target: { side: "bottom", offset: -5 },
      source: { side: "bottom", offset: 9 },
    });
  });

  it("Canvas separates a routed input handle from the default output handle", () => {
    expect(
      resolveEdgeHandleOverlap({
        target: { side: "bottom", offset: 0 },
      }),
    ).toEqual({
      target: { side: "bottom", offset: -7 },
      source: { side: "bottom", offset: 7 },
    });
  });

  it("Canvas keeps handle hints unchanged when they are on different sides", () => {
    const hints = {
      target: { side: "top" as const, offset: 0 },
      source: { side: "right" as const, offset: 0 },
    };

    expect(resolveEdgeHandleOverlap(hints)).toEqual(hints);
  });

  it("Canvas finds a workflow node under a connection drop point", () => {
    const node = document.createElement("div");
    node.dataset.nodeId = "target-node";
    const child = document.createElement("button");
    node.appendChild(child);
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => child);

    expect(getCanvasNodeIdAtPoint(12, 34)).toBe("target-node");

    document.elementFromPoint = originalElementFromPoint;
  });

  it("Canvas converts invalid connection drops on nodes into node-to-node connections", () => {
    expect(
      toNodeDropConnection(
        {
          isValid: false,
          fromNode: { id: "source-node" },
        } as Parameters<typeof toNodeDropConnection>[0],
        "target-node",
      ),
    ).toEqual({
      source: "source-node",
      target: "target-node",
      sourceHandle: null,
      targetHandle: null,
    });
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

  it("SkillNode shows a viewport-fixed description tooltip when hovered", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "taxiing",
        description: "plan.md 따라 워크트리에서 구현 및 중간 커밋",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/taxiing/SKILL.md",
        },
      },
    });

    const description = screen.getByTestId("skill-node-description");
    expect(description).toHaveClass("skill-node__description");
    expect(
      screen.queryByTestId("skill-node-description-tooltip"),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(description);

    const tooltip = screen.getByTestId("skill-node-description-tooltip");
    expect(tooltip).toHaveClass("hover-tooltip");
    expect(tooltip).toHaveStyle({ position: "fixed" });
    expect(tooltip).toHaveTextContent(
      "plan.md 따라 워크트리에서 구현 및 중간 커밋",
    );
    expect(screen.getByText("taxiing")).toHaveClass("skill-node__name");
  });

  it("SkillNode falls back to scanned skill metadata for saved nodes", () => {
    useSkillStore.setState({
      byRepo: {
        repo: [
          {
            id: "claude:.claude/skills/taxiing",
            provider: "claude",
            name: "taxiing",
            description: "항공기 이륙 3단계 — plan.md 따라 구현",
            rootDir: ".claude/skills/taxiing",
            skillFile: ".claude/skills/taxiing/SKILL.md",
          },
        ],
      },
    });

    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "taxiing",
        skillRef: {
          provider: "claude",
          skillFile: ".claude/skills/taxiing/SKILL.md",
        },
      },
    });

    expect(screen.getByTestId("skill-node-description")).toHaveTextContent(
      "항공기 이륙 3단계 — plan.md 따라 구현",
    );
  });

  it("SkillNode hides empty skill descriptions", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        description: "",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    expect(
      document.querySelector(".skill-node__description"),
    ).not.toBeInTheDocument();
  });

  it("SkillNode shows the configured execution model", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
        execution: {
          model: "gpt-5.4-mini",
        },
      },
    });

    const model = screen.getByTestId("skill-node-model");
    expect(model).toHaveTextContent("model: gpt-5.4-mini");
    expect(model).toHaveClass("skill-node__input-token--model");
    expect(screen.getByTestId("skill-node-input-summary")).toHaveTextContent(
      "model: gpt-5.4-mini",
    );
  });

  it("SkillNode hides the model summary when no execution model is configured", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        skillRef: {
          provider: "claude",
          skillFile: ".claude/skills/foo/SKILL.md",
        },
      },
    });

    expect(screen.queryByTestId("skill-node-model")).not.toBeInTheDocument();
  });

  it("SkillNode keeps input and output handles visible at top and bottom without edges", () => {
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

    const targetHandle = screen.getByTestId("skill-node-target-handle");
    const sourceHandle = screen.getByTestId("skill-node-source-handle");

    expect(targetHandle).toHaveClass("react-flow__handle-top");
    expect(sourceHandle).toHaveClass("react-flow__handle-bottom");
    expect(targetHandle).not.toHaveClass("skill-node__handle--route-active");
    expect(sourceHandle).not.toHaveClass("skill-node__handle--route-active");
  });

  it("SkillNode moves the output handle to the routed edge side", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        edgeHandleHints: {
          source: { side: "right", offset: 12 },
        },
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    const activeHandle = document.querySelector(
      ".skill-node__handle--source.skill-node__handle--route-active",
    );

    expect(activeHandle).not.toHaveClass("skill-node__handle--side");
    expect(activeHandle).toHaveStyle({
      right: "0px",
      top: "calc(50% + 12px)",
    });
    expect(screen.getAllByTestId("skill-node-source-handle")).toHaveLength(1);
  });

  it("SkillNode moves the input handle to bottom routed endpoints", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "Foo",
        edgeHandleHints: {
          target: { side: "bottom", offset: -10 },
        },
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/foo/SKILL.md",
        },
      },
    });

    const activeHandle = document.querySelector(
      ".skill-node__handle--target.skill-node__handle--route-active",
    );

    expect(activeHandle).not.toHaveClass("skill-node__handle--side");
    expect(activeHandle).toHaveStyle({
      bottom: "0px",
      left: "calc(50% - 10px)",
    });
    expect(screen.getAllByTestId("skill-node-target-handle")).toHaveLength(1);
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
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            label: "ISSUE-ID",
            placeholder: "<ISSUE-ID> [--force]",
          },
        ],
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

  it("SkillNode input popover edits legacy starter system nodes as arguments", () => {
    useSkillStore.setState({
      defaultSkills: [
        {
          id: "codex:.codex/skills/planning",
          provider: "codex",
          source: "default",
          name: "planning",
          description: "Plan the feature",
          rootDir: ".codex/skills/planning",
          skillFile: ".codex/skills/planning/SKILL.md",
          inputHints: [
            {
              kind: "command",
              key: "arguments",
              label: "task, request, or issue",
              placeholder: "<task, request, or issue>",
            },
          ],
        },
      ],
    });
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:starter/boarding",
        provider: "codex",
        source: "system",
        name: "planning",
        description: "",
        rootDir: "system://codex:starter/boarding",
        skillFile: "",
        systemSkillId: "codex:starter/boarding",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().setNodeInput(id, { prompt: "legacy prompt" });
    const node = useWorkflowStore.getState().nodes[0];
    renderSkillNode({
      id,
      selected: false,
      data: node.data,
    });

    fireEvent.click(screen.getByTestId("skill-node-input-edit"));
    expect(screen.getByTestId("skill-node-input-arguments")).toHaveValue("");
    expect(screen.getByTestId("skill-node-input-prompt")).toHaveValue(
      "legacy prompt",
    );
    fireEvent.change(screen.getByTestId("skill-node-input-arguments"), {
      target: { value: "CIR-68" },
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-68",
      prompt: "legacy prompt",
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
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            label: "ISSUE-ID",
            placeholder: "<ISSUE-ID> [--force]",
          },
        ],
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

  it("SkillNode stacks arguments and prompt input summaries", () => {
    renderSkillNode({
      id: "node-1",
      selected: false,
      data: {
        label: "planning",
        skillRef: {
          provider: "codex",
          skillFile: ".codex/skills/planning/SKILL.md",
        },
        input: {
          arguments: "Hello_world.md 적용하기",
          prompt: "한국어로 작성할 것",
        },
      },
    });

    const summary = screen.getByTestId("skill-node-input-summary");
    const innerSummary = summary.querySelector(".skill-node__input-summary");
    const tokens = summary.querySelectorAll(".skill-node__input-token");

    expect(innerSummary).toHaveClass("skill-node__input-summary--stacked");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toHaveClass("skill-node__input-token--arguments");
    expect(tokens[0]).toHaveTextContent("arguments: Hello_world.md 적용하기");
    expect(tokens[1]).toHaveTextContent("prompt: 한국어로 작성할 것");
    expect(summary).not.toHaveTextContent(", prompt");
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
