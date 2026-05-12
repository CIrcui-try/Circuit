import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRunStore } from "../../runner/runStore";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
  useSkillStore.setState({
    byRepo: {},
    defaultSkills: [],
    systemSkills: [],
    loading: {},
    errors: {},
  });
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

  it("PP5: edits selected node input arguments", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo Skill",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
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
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    const input = screen.getByTestId("node-input-arguments");
    fireEvent.change(input, { target: { value: "CIR-43 --force" } });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-43 --force",
    });
  });

  it("PP6: edits the full selected node input as JSON", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo Skill",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
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
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTestId("node-input-mode-json"));
    fireEvent.change(screen.getByTestId("node-input-json"), {
      target: {
        value: JSON.stringify({
          arguments: "CIR-45",
          timeoutMs: 5000,
          idleTimeoutMs: 1000,
          env: { DEBUG: true },
        }),
      },
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-45",
      timeoutMs: 5000,
      idleTimeoutMs: 1000,
      env: { DEBUG: true },
    });
  });

  it("PP7: rejects invalid JSON without replacing the last valid input", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo Skill",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
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
    useWorkflowStore.getState().setNodeInput(id, {
      arguments: "CIR-45",
      timeoutMs: 5000,
    });
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTestId("node-input-mode-json"));
    fireEvent.change(screen.getByTestId("node-input-json"), {
      target: { value: '{"arguments": ' },
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-45",
      timeoutMs: 5000,
    });
  });

  it("PP8: friendly argument edits preserve advanced JSON fields", () => {
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/foo",
        provider: "codex",
        name: "Foo Skill",
        description: "",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
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
    useWorkflowStore.getState().setNodeInput(id, {
      arguments: "CIR-44",
      timeoutMs: 5000,
      idleTimeoutMs: 1000,
    });
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTestId("node-input-mode-json"));
    expect(screen.getByTestId("node-input-json")).toHaveValue(
      JSON.stringify(
        {
          arguments: "CIR-44",
          timeoutMs: 5000,
          idleTimeoutMs: 1000,
        },
        null,
        2,
      ),
    );

    fireEvent.click(screen.getByTestId("node-input-mode-friendly"));
    fireEvent.change(screen.getByTestId("node-input-arguments"), {
      target: { value: "CIR-45 --force" },
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-45 --force",
      timeoutMs: 5000,
      idleTimeoutMs: 1000,
    });
  });

  it("PP9: edits legacy starter system skill input as arguments", () => {
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
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    expect(screen.getByTestId("node-input-arguments")).toHaveValue("");
    expect(screen.getByTestId("node-input-prompt")).toHaveValue("legacy prompt");
    fireEvent.change(screen.getByTestId("node-input-arguments"), {
      target: { value: "CIR-68" },
    });

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-68",
      prompt: "legacy prompt",
    });
  });
});
