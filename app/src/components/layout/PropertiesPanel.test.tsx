import { beforeEach, describe, expect, it, vi } from "vitest";
const bridgeMock = vi.hoisted(() => ({
  changeRepositorySkillProvider: vi.fn(),
  scanSkills: vi.fn(),
}));

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRunStore } from "../../runner/runStore";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => {
  bridgeMock.changeRepositorySkillProvider.mockReset();
  bridgeMock.scanSkills.mockReset();
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useSkillStore.setState({
    byRepo: {},
    defaultSkills: [],
    systemSkills: [],
    loading: {},
    creating: {},
    deleting: {},
    changingProvider: {},
    errors: {},
  });
});

describe("PropertiesPanel", () => {
  it("PP1: shows empty state when nothing is selected", () => {
    render(<PropertiesPanel />);
    expect(screen.getByTestId("node-properties-panel")).toBeInTheDocument();
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("calls onCollapse from the header Hide button", () => {
    const onCollapse = vi.fn();

    render(<PropertiesPanel onCollapse={onCollapse} />);
    fireEvent.click(screen.getByTestId("properties-panel-collapse"));

    expect(onCollapse).toHaveBeenCalledTimes(1);
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

  it("edits selected node model without changing input", () => {
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
    useWorkflowStore.getState().setNodeInput(id, { prompt: "Keep me" });
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    const model = screen.getByTestId("node-execution-model");
    expect(model).toHaveAttribute(
      "placeholder",
      "sonnet, opus, or full model name",
    );
    expect(readModelOptions()).toEqual(["sonnet", "opus"]);
    fireEvent.change(model, { target: { value: " claude-sonnet-4-6 " } });

    expect(useWorkflowStore.getState().nodes[0].data.execution).toEqual({
      model: "claude-sonnet-4-6",
    });
    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      prompt: "Keep me",
    });
  });

  it("removes selected node model when the field is cleared", () => {
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
    useWorkflowStore.getState().setNodeModel(id, "gpt-5.4");
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);

    const model = screen.getByTestId("node-execution-model");
    expect(model).toHaveAttribute("placeholder", "Codex model name");
    expect(readModelOptions()).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
    ]);
    fireEvent.change(model, { target: { value: "" } });

    expect(useWorkflowStore.getState().nodes[0].data.execution).toBeUndefined();
  });

  it("shows provider Change for repository skills only", () => {
    const repositoryNodeId = useWorkflowStore.getState().addSkillNode(
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
    useWorkflowStore.getState().selectNode(repositoryNodeId);

    const { rerender } = render(<PropertiesPanel />);
    expect(screen.getByTestId("node-provider-change")).toHaveTextContent(
      "Switch to Codex",
    );

    const systemNodeId = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:imagegen",
        provider: "codex",
        source: "system",
        name: "imagegen",
        description: "",
        rootDir: "",
        skillFile: "",
        systemSkillId: "codex:imagegen",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().selectNode(systemNodeId);
    rerender(<PropertiesPanel />);

    expect(screen.queryByTestId("node-provider-change")).not.toBeInTheDocument();

    const defaultNodeId = useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/planning",
        provider: "codex",
        source: "default",
        name: "planning",
        description: "",
        rootDir: ".codex/skills/planning",
        skillFile: ".codex/skills/planning/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().selectNode(defaultNodeId);
    rerender(<PropertiesPanel />);

    expect(screen.queryByTestId("node-provider-change")).not.toBeInTheDocument();
  });

  it("confirms provider change, moves the skill, and updates active node refs", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "repo-1",
          name: "repo",
          path: "/repo",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "repo-1",
      hydrated: true,
    });
    bridgeMock.changeRepositorySkillProvider.mockResolvedValueOnce({
      provider: "codex",
      dirName: "foo",
      rootDir: ".codex/skills/foo",
      skillFile: ".codex/skills/foo/SKILL.md",
      skillFileAbsPath: "/repo/.codex/skills/foo/SKILL.md",
      content: "---\nname: Foo Skill\ndescription:\n---\n",
    });
    bridgeMock.scanSkills.mockResolvedValueOnce([
      {
        provider: "codex",
        dirName: "foo",
        rootDir: ".codex/skills/foo",
        skillFile: ".codex/skills/foo/SKILL.md",
        skillFileAbsPath: "/repo/.codex/skills/foo/SKILL.md",
        content: "---\nname: Foo Skill\ndescription:\n---\n",
      },
    ]);
    const id = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo Skill",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
        skillFileAbsPath: "/repo/.claude/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    useWorkflowStore.getState().setNodeInput(id, { prompt: "Keep me" });
    useWorkflowStore.getState().setNodeModel(id, "sonnet");
    useWorkflowStore.getState().selectNode(id);

    render(<PropertiesPanel />);
    fireEvent.click(screen.getByTestId("node-provider-change"));

    expect(screen.getByTestId("provider-change-confirm")).toHaveTextContent(
      "Switch to Codex",
    );
    expect(screen.getByTestId("provider-change-confirm")).toHaveTextContent(
      ".claude/skills/foo/SKILL.md",
    );
    expect(screen.getByTestId("provider-change-confirm")).toHaveTextContent(
      ".codex/skills/foo/SKILL.md",
    );
    fireEvent.click(screen.getByTestId("provider-change-confirm-change"));

    await waitFor(() =>
      expect(screen.queryByTestId("provider-change-confirm")).not.toBeInTheDocument(),
    );
    expect(bridgeMock.changeRepositorySkillProvider).toHaveBeenCalledWith("/repo", {
      provider: "claude",
      slug: "foo",
      targetProvider: "codex",
    });
    expect(useWorkflowStore.getState().nodes[0].data.skillRef).toEqual({
      source: "repository",
      provider: "codex",
      skillFile: ".codex/skills/foo/SKILL.md",
      skillFileAbsPath: "/repo/.codex/skills/foo/SKILL.md",
    });
    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      prompt: "Keep me",
    });
    expect(useWorkflowStore.getState().nodes[0].data.execution).toBeUndefined();
  });

  it("keeps the active node unchanged when provider change fails", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "repo-1",
          name: "repo",
          path: "/repo",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "repo-1",
      hydrated: true,
    });
    bridgeMock.changeRepositorySkillProvider.mockRejectedValueOnce(
      new Error("skill already exists"),
    );
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
    fireEvent.click(screen.getByTestId("node-provider-change"));
    fireEvent.click(screen.getByTestId("provider-change-confirm-change"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("skill already exists"),
    );
    expect(useWorkflowStore.getState().nodes[0].data.skillRef).toEqual({
      source: "repository",
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
  });
});

function readModelOptions(): string[] {
  return [
    ...screen
      .getByTestId("node-execution-model-options")
      .querySelectorAll("option"),
  ].map((option) => option.value);
}
