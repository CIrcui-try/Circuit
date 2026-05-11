import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(async () => []),
  loadRepositories: vi.fn(async () => null),
  saveRepositories: vi.fn(async () => {}),
  listWorkflows: vi.fn(async () => []),
  loadWorkflow: vi.fn(async () => "{}"),
  saveWorkflow: vi.fn(async () => {}),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useRepositoryStore, type Repository } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { useRunStore } from "../runner/runStore";
import { useRunLogStore } from "../runner/runLogStore";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import { AppErrorAlert } from "../components/AppErrorAlert";
import { Workspace } from "./Workspace";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";

const SAMPLE: Repository = {
  id: "id-alpha",
  name: "alpha",
  path: "/Users/me/alpha",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppErrorAlert />
      <Routes>
        <Route path="/" element={<div>repo-list-stub</div>} />
        <Route path="/workspace/:repoId?" element={<Workspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  bridgeMock.scanSkills.mockReset();
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.listWorkflows.mockReset();
  bridgeMock.listWorkflows.mockResolvedValue([]);
  bridgeMock.saveWorkflow.mockReset();
  bridgeMock.saveWorkflow.mockResolvedValue(undefined);
  bridgeMock.loadWorkflow.mockReset();
  bridgeMock.loadWorkflow.mockResolvedValue("{}");

  // RuntimeBridge stub so RealWorkflowRunner can route node executions through
  // a fake spawn pipeline that always succeeds.
  const runtimeBridge = createMockRuntimeBridge({
    files: {
      "/Users/me/alpha/.claude/skills/foo/SKILL.md":
        "---\nname: Foo\n---\n\n# Foo\n",
    },
    scenario: () => [
      { event: { type: "started" } },
      { event: { type: "exited", exitCode: 0 } },
    ],
  });
  (window as unknown as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__ =
    runtimeBridge;

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
  useLayoutStore.setState({ sidebarCollapsed: false, logCollapsed: false });
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
  useRunLogStore.getState().reset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Workspace", () => {
  it("W1: shows repo name in toolbar and syncs selectedId on mount", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.getByText("Repository: alpha")).toBeInTheDocument();
    expect(useRepositoryStore.getState().selectedId).toBe("id-alpha");
  });

  it("W2: shows 'Repository not found' for unknown id once hydrated", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/missing-id");

    expect(
      screen.getByRole("heading", { name: "Repository not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to repositories/i })).toBeInTheDocument();
  });

  it("W3: does not show 'Repository not found' before hydration completes", () => {
    useRepositoryStore.setState({ repositories: [], hydrated: false });

    renderAt("/workspace/missing-id");

    expect(
      screen.queryByRole("heading", { name: "Repository not found" }),
    ).not.toBeInTheDocument();
  });

  it("W4: shows 'No repository selected' when entering /workspace without an id", () => {
    renderAt("/workspace");

    expect(screen.getByText("No repository selected")).toBeInTheDocument();
  });

  it("W5b: triggers scanSkills with the active repo path on mount", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    await vi.waitFor(() => {
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/alpha");
    });
  });

  it("W5: Save/Menu enabled with repo; Start Circuit disabled until a node exists, then enabled", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workflow-save")).not.toBeDisabled();
    expect(screen.getByTestId("workflow-menu")).not.toBeDisabled();
    const startBtn = screen.getByTestId("workflow-start");
    expect(startBtn).toBeDisabled();

    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
  });

  it("W6: workspace root and workflow-canvas testids are present", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workspace-root")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });

  it("W8: clicking Save calls saveWorkflow with serialized JSON", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("workflow-save"));

    await vi.waitFor(() => {
      expect(bridgeMock.saveWorkflow).toHaveBeenCalledTimes(1);
    });
    const args = bridgeMock.saveWorkflow.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(args[0]).toBe("/Users/me/alpha");
    expect(typeof args[1]).toBe("string");
    const parsed = JSON.parse(args[2]);
    expect(parsed.repositoryId).toBe("id-alpha");
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].skillRef).toEqual({
      source: "repository",
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
  });

  it("W8d: adds the Codex starter flow to an empty selected repo and saves as a regular workflow", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("starter-flow-empty")).toHaveTextContent(
      "Actual repository",
    );
    expect(screen.getByTestId("starter-flow-empty")).toHaveTextContent(
      "/Users/me/alpha",
    );
    expect(screen.getByTestId("starter-flow-empty")).toHaveTextContent(
      "어떤 기능을 개발해보고 싶으신가요?",
    );
    expect(screen.getByTestId("starter-flow-add")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("starter-flow-goal-input"), {
      target: { value: "Add a theme toggle" },
    });
    fireEvent.click(screen.getByTestId("starter-flow-add"));

    expect(useWorkflowStore.getState().workflowName).toBe("Codex starter flow");
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual([
      "starter_boarding",
      "starter_door_closing",
      "starter_taxiing",
      "starter_takeoff",
      "starter_landing",
    ]);
    expect(useWorkflowStore.getState().edges).toHaveLength(4);
    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "Add a theme toggle",
    });
    expect(screen.queryByTestId("starter-flow-empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workflow-save"));

    await vi.waitFor(() => {
      expect(bridgeMock.saveWorkflow).toHaveBeenCalledTimes(1);
    });
    const [, workflowId, payload] = bridgeMock.saveWorkflow.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(workflowId).toBe("codex-starter-issue-lifecycle");
    const parsed = JSON.parse(payload);
    expect(parsed.nodes[0].skillRef).toEqual({
      source: "system",
      provider: "codex",
      systemSkillId: "codex:starter/boarding",
    });
  });

  it("W8e: adds the Codex starter flow even when the feature prompt is blank", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("starter-flow-add"));

    expect(useWorkflowStore.getState().nodes).toHaveLength(5);
    expect(useWorkflowStore.getState().nodes[0].data.input).toBeUndefined();
  });

  it("W8b: edits boarding card input as issue id plus force arguments", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/boarding",
        provider: "codex",
        name: "boarding",
        description: "",
        rootDir: ".codex/skills/boarding",
        skillFile: ".codex/skills/boarding/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByTestId("skill-node-input-edit"));
    expect(screen.getByTestId("skill-node-input-popover")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("skill-node-input-issue"), {
      target: { value: "CIR-15" },
    });
    fireEvent.click(screen.getByTestId("skill-node-input-force"));

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-15 --force",
    });
  });

  it("W8c: edits generic skill input as prompt", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:.codex/skills/generic",
        provider: "codex",
        name: "Generic Skill",
        description: "",
        rootDir: ".codex/skills/generic",
        skillFile: ".codex/skills/generic/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByTestId("skill-node-input-edit"));
    fireEvent.change(screen.getByTestId("skill-node-input-prompt"), {
      target: { value: "Write a concise summary." },
    });
    fireEvent.click(screen.getByLabelText("Close input editor"));

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      prompt: "Write a concise summary.",
    });
    expect(screen.queryByTestId("skill-node-input-popover")).not.toBeInTheDocument();
  });

  it("W9: clicking Start previews the actual repo before running", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    expect(screen.getByTestId("run-preview-modal")).toHaveTextContent(
      "Confirm actual repository run",
    );
    expect(screen.getByTestId("run-preview-modal")).toHaveTextContent(
      "/Users/me/alpha",
    );
    expect(useRunStore.getState().status).toBe("idle");

    fireEvent.click(screen.getByTestId("run-preview-confirm"));

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
    const fooNodeId = useWorkflowStore.getState().nodes[0].id;
    expect(useRunStore.getState().nodeStates[fooNodeId]).toBe("success");
  });

  it("W9b: clicking Start on a loop asks before running", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    const a = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );
    const b = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 100, y: 20 },
    );
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: b, target: a, sourceHandle: null, targetHandle: null,
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    expect(
      screen.getByRole("dialog", { name: "Workflow loop warning" }),
    ).toHaveTextContent(
      "This workflow contains a loop and may run indefinitely.",
    );
    expect(screen.getByTestId("cycle-run-confirm")).toHaveTextContent(
      "Do you want to continue?",
    );
    expect(useRunStore.getState().status).toBe("idle");

    fireEvent.click(screen.getByTestId("cycle-run-confirm-proceed"));

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
    expect(useRunStore.getState().nodeStates).toMatchObject({
      [a]: "success",
      [b]: "success",
    });
  });

  it("W9c: cancelling the loop confirmation does not start a run", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    useLayoutStore.setState({ sidebarCollapsed: false, logCollapsed: true });

    renderAt("/workspace/id-alpha");
    const a = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );
    const b = useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 100, y: 20 },
    );
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: b, target: a, sourceHandle: null, targetHandle: null,
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    expect(screen.getByTestId("cycle-run-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cycle-run-cancel"));

    expect(screen.queryByTestId("cycle-run-confirm")).not.toBeInTheDocument();
    expect(useRunStore.getState().status).toBe("idle");
    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--log-collapsed",
    );
  });

  it("W10: clicking Start surfaces runtime failure as an alert", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    (window as unknown as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__ =
      createMockRuntimeBridge({
        files: {
          "/Users/me/alpha/.claude/skills/foo/SKILL.md":
            "---\nname: Foo\n---\n\n# Foo\n",
        },
        scenario: () => [
          { event: { type: "started" } },
          { event: { type: "error", message: "Command not found" } },
        ],
      });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));
    fireEvent.click(screen.getByTestId("run-preview-confirm"));

    const alert = await screen.findByTestId("app-error-alert");
    expect(alert).toHaveTextContent("Start Circuit failed");
    expect(alert).toHaveTextContent("Command not found");
    expect(useRunStore.getState().status).toBe("failed");
  });

  it("W7: mounting Workspace clears any preexisting workflow nodes", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 0, y: 0 },
    );
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);

    renderAt("/workspace/id-alpha");

    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });

  it("W11: restores the last local workflow draft on workspace entry", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    saveWorkflowDraft(SAMPLE.id, {
      workflowId: null,
      workflowName: "Unsaved draft",
      nodes: [
        {
          id: "draft-node",
          type: "skill",
          position: { x: 10, y: 20 },
          data: {
            label: "Foo",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
          },
        },
      ],
      edges: [],
    });

    renderAt("/workspace/id-alpha");

    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().nodes[0].id).toBe("draft-node");
    expect(screen.getByTestId("workflow-name-input")).toHaveValue("Unsaved draft");
  });

  it("W12: persists workflow edits into the local draft", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().setWorkflowName("Local autosave");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const draft = loadWorkflowDraft(SAMPLE.id);
    expect(draft?.workflowName).toBe("Local autosave");
    expect(draft?.nodes).toHaveLength(1);
    expect(draft?.nodes[0].data.label).toBe("Foo");
  });

  it("W13: route changes do not reset an in-flight run", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    (window as unknown as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__ =
      createMockRuntimeBridge({
        files: {
          "/Users/me/alpha/.claude/skills/foo/SKILL.md":
            "---\nname: Foo\n---\n\n# Foo\n",
        },
        scenario: () => [
          { event: { type: "started" } },
          { delayMs: 30, event: { type: "exited", exitCode: 0 } },
        ],
      });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));
    fireEvent.click(screen.getByTestId("run-preview-confirm"));

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("running");
    });
    fireEvent.click(screen.getByLabelText("Back to repository list"));

    expect(screen.getByText("repo-list-stub")).toBeInTheDocument();
    expect(useRunStore.getState().status).toBe("running");

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
  });

  it("W14: re-entering the running repo shows the active run snapshot instead of the saved draft", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    saveWorkflowDraft(SAMPLE.id, {
      workflowId: "draft-wf",
      workflowName: "Edited draft",
      nodes: [
        {
          id: "draft-node",
          type: "skill",
          position: { x: 10, y: 20 },
          data: {
            label: "Draft",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
          },
        },
      ],
      edges: [],
    });
    useRunStore.getState().beginRun({
      runId: "run-1",
      workflowId: "run-wf",
      workflowName: "Active run",
      repository: { id: SAMPLE.id, name: SAMPLE.name },
      nodeIds: ["run-node"],
      startedAt: "2026-05-09T00:00:00.000Z",
      snapshot: {
        repository: SAMPLE,
        workflowId: "run-wf",
        workflowName: "Active run",
        nodes: [
          {
            id: "run-node",
            type: "skill",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
            label: "Running node",
            position: { x: 30, y: 40 },
          },
        ],
        edges: [],
      },
    });

    renderAt("/workspace/id-alpha");

    expect(useWorkflowStore.getState().currentWorkflowId).toBe("run-wf");
    expect(useWorkflowStore.getState().workflowName).toBe("Active run");
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual([
      "run-node",
    ]);
    expect(screen.queryByTestId("workflow-save-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-start")).toBeDisabled();
  });

  it("W15: collapses and restores the skills sidebar without a sidebar resize handle", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("skills-sidebar-collapse"));

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--sidebar-collapsed",
    );
    expect(screen.getByTestId("skills-sidebar-restore")).toBeInTheDocument();
    expect(screen.queryByTestId("skills-sidebar-collapse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-sidebar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("skills-sidebar-restore"));

    expect(screen.getByTestId("workspace-root")).not.toHaveClass(
      "workspace--sidebar-collapsed",
    );
    expect(screen.getByTestId("skills-sidebar-collapse")).toBeInTheDocument();
    expect(screen.getByTestId("resize-handle-sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("skills-sidebar-restore")).not.toBeInTheDocument();
  });

  it("W16: keeps the collapsed sidebar state across workspace remounts in the same session", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    const firstRender = renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("skills-sidebar-collapse"));
    firstRender.unmount();

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--sidebar-collapsed",
    );
    expect(screen.getByTestId("skills-sidebar-restore")).toBeInTheDocument();
  });

  it("W17: collapses and restores the run log without a log resize handle", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("run-log-collapse"));

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--log-collapsed",
    );
    expect(screen.getByTestId("run-log-restore")).toBeInTheDocument();
    expect(screen.queryByTestId("run-log-collapse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-log")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("run-log-restore"));

    expect(screen.getByTestId("workspace-root")).not.toHaveClass(
      "workspace--log-collapsed",
    );
    expect(screen.getByTestId("run-log-collapse")).toBeInTheDocument();
    expect(screen.getByTestId("resize-handle-log")).toBeInTheDocument();
    expect(screen.queryByTestId("run-log-restore")).not.toBeInTheDocument();
  });

  it("W18: keeps the collapsed run log state across workspace remounts in the same session", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    const firstRender = renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("run-log-collapse"));
    firstRender.unmount();

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--log-collapsed",
    );
    expect(screen.getByTestId("run-log-restore")).toBeInTheDocument();
  });

  it("W18b: opens the run log when starting Circuit", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("run-log-collapse"));
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Foo",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 10, y: 20 },
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    expect(screen.getByTestId("run-preview-modal")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--log-collapsed",
    );
    fireEvent.click(screen.getByTestId("run-preview-confirm"));

    expect(screen.getByTestId("workspace-root")).not.toHaveClass(
      "workspace--log-collapsed",
    );
    expect(screen.getByTestId("run-log-collapse")).toBeInTheDocument();
    expect(screen.queryByTestId("run-log-restore")).not.toBeInTheDocument();
  });

  it("W19: shows final elapsed time in the toolbar after a run completes", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    useRunStore.setState({
      status: "success",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Deploy flow",
      repositoryId: SAMPLE.id,
      repositoryName: SAMPLE.name,
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:05.000Z",
      activeNodeId: null,
      nodeStates: { "node-1": "success" },
      nodeDebug: {},
      snapshot: null,
    });

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
      "Success: Deploy flow · 0:05",
    );
  });
});
