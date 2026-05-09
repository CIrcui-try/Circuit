import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRunStore } from "../../runner/runStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
});

describe("PropertiesPanel", () => {
  it("PP1: shows empty state when nothing is selected", () => {
    render(<PropertiesPanel />);
    expect(screen.getByTestId("node-properties-panel")).toBeInTheDocument();
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("PP2: shows label, provider, and skillFile when a node is selected", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo Skill",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);
    expect(screen.getByText("Foo Skill")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText(".claude/skills/foo/SKILL.md")).toBeInTheDocument();
  });

  it("PP3: returns to empty state after deselect", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/bar",
        provider: "codex",
        name: "Bar Skill",
        description: "",
        rootDir: ".codex/skills/bar",
        skillFile: ".codex/skills/bar/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().selectNode(id);
    useWorkflowStore.getState().selectNode(null);

    render(<PropertiesPanel />);
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("PP4: shows selected node run debug metadata", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo Skill",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().selectNode(id);
    useRunStore.getState().beginRun({
      runId: "run_1",
      workflowId: "wf",
      nodeIds: [id],
      startedAt: "t",
    });
    useRunStore.getState().setNodeState(id, "waiting_input");
    useRunStore.getState().patchNodeDebug(id, {
      adapter: "codex",
      command: "codex",
      spawnType: "process",
      durationMs: 42,
      exitCode: 0,
      lastLogAt: "t1",
    });

    render(<PropertiesPanel />);

    expect(screen.getByTestId("node-run-status")).toHaveTextContent(
      "waiting for input",
    );
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getByText("process")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByText("t1")).toBeInTheDocument();
  });
});
