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
    expect(screen.getByText("Input set")).toBeInTheDocument();
    expect(screen.getByText(/prompt: Summarize/)).toHaveAttribute(
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
    expect(screen.getByText("Invalid input")).toBeInTheDocument();
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
