import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkflowStore } from "../../stores/workflowStore";
import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
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
});
