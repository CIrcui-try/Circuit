import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RawSkill } from "../host/bridge";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(async () => []),
  scanDefaultSkills: vi.fn(async (): Promise<RawSkill[]> => []),
  pathExists: vi.fn(async () => false),
  checkRepositoryEnvironment: undefined as
    | undefined
    | ReturnType<typeof vi.fn>,
  loadRepositories: vi.fn(async () => null),
  saveRepositories: vi.fn(async () => {}),
  listWorkflows: vi.fn(async () => []),
  loadWorkflow: vi.fn(async () => "{}"),
  saveWorkflow: vi.fn(async () => {}),
}));

const openerMock = vi.hoisted(() => ({
  openPath: vi.fn(async () => {}),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => openerMock);

import { useRepositoryStore, type Repository } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { useRunStore } from "../runner/runStore";
import { useRunLogStore } from "../runner/runLogStore";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";
import type { SkillExecutionResult } from "../runtime/contracts/SkillExecution";
import { AppErrorAlert } from "../components/AppErrorAlert";
import { Workspace } from "./Workspace";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";
import { markStarterFlowPromptPending } from "../workflow/starterFlowPrompt";

const SAMPLE: Repository = {
  id: "id-alpha",
  name: "alpha",
  path: "/Users/me/alpha",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const BETA: Repository = {
  id: "id-beta",
  name: "beta",
  path: "/Users/me/beta",
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
  bridgeMock.scanDefaultSkills.mockReset();
  bridgeMock.scanDefaultSkills.mockResolvedValue([
    {
      provider: "codex",
      source: "default",
      dirName: "planning",
      rootDir: ".codex/skills/planning",
      skillFile: ".codex/skills/planning/SKILL.md",
      skillFileAbsPath:
        "/Applications/Circuit.app/default-skills/.codex/skills/planning/SKILL.md",
      content: "---\nname: planning\ndescription: Plan the feature\nargument-hint: <task, request, or issue>\n---\n",
    },
    {
      provider: "claude",
      source: "default",
      dirName: "implement-plan",
      rootDir: ".claude/skills/implement-plan",
      skillFile: ".claude/skills/implement-plan/SKILL.md",
      content: "---\nname: implement-plan\ndescription: Implement the plan\n---\n",
    },
    {
      provider: "codex",
      source: "default",
      dirName: "review-changes",
      rootDir: ".codex/skills/review-changes",
      skillFile: ".codex/skills/review-changes/SKILL.md",
      content: "---\nname: review-changes\ndescription: Review the implementation\n---\n",
    },
    {
      provider: "claude",
      source: "default",
      dirName: "review-and-fix",
      rootDir: ".claude/skills/review-and-fix",
      skillFile: ".claude/skills/review-and-fix/SKILL.md",
      content: "---\nname: review-and-fix\ndescription: Review and fix the implementation\n---\n",
    },
    {
      provider: "claude",
      source: "default",
      dirName: "wrap-up",
      rootDir: ".claude/skills/wrap-up",
      skillFile: ".claude/skills/wrap-up/SKILL.md",
      content: "---\nname: wrap-up\ndescription: Complete the workflow\n---\n",
    },
    {
      provider: "codex",
      source: "default",
      dirName: "wrap-up",
      rootDir: ".codex/skills/wrap-up",
      skillFile: ".codex/skills/wrap-up/SKILL.md",
      content: "---\nname: wrap-up\ndescription: Summarize the result\n---\n",
    },
  ]);
  bridgeMock.pathExists.mockReset();
  bridgeMock.pathExists.mockResolvedValue(false);
  bridgeMock.checkRepositoryEnvironment = undefined;
  openerMock.openPath.mockReset();
  openerMock.openPath.mockResolvedValue(undefined);
  bridgeMock.listWorkflows.mockReset();
  bridgeMock.listWorkflows.mockResolvedValue([]);
  bridgeMock.saveWorkflow.mockReset();
  bridgeMock.saveWorkflow.mockResolvedValue(undefined);
  bridgeMock.loadWorkflow.mockReset();
  bridgeMock.loadWorkflow.mockResolvedValue("{}");
  openerMock.openPath.mockReset();
  openerMock.openPath.mockResolvedValue(undefined);

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
  useSkillStore.setState({ byRepo: {}, defaultSkills: [], loading: {}, errors: {} });
  useLayoutStore.setState({
    sidebarCollapsed: false,
    propsCollapsed: false,
    logCollapsed: false,
  });
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

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("Repository: alpha")).not.toBeInTheDocument();
    expect(useRepositoryStore.getState().selectedId).toBe("id-alpha");
  });

  it("W1c: toggles Continue on failure from the repository settings menu", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("workflow-settings"));
    fireEvent.click(screen.getByRole("switch", { name: "Continue on failure" }));

    expect(screen.getByTestId("workflow-settings-menu")).toBeInTheDocument();
    expect(useWorkflowStore.getState().continueOnFailure).toBe(true);
  });

  it("W1d: acknowledges a successful run when opening its workspace", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    useRunStore.setState({
      status: "success",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Deploy",
      repositoryId: "id-alpha",
      repositoryName: "alpha",
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:05.000Z",
      activeNodeId: null,
      nodeStates: { "node-1": "success" },
      nodeDebug: {},
      snapshot: null,
    });

    renderAt("/workspace/id-alpha");

    await vi.waitFor(() => {
      expect(useRunStore.getState().acknowledgedRunId).toBe("run-1");
    });
  });

  it("W1a: opens the selected repository folder in Finder", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    expect(screen.queryByTestId("show-repository-in-finder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workflow-settings"));
    fireEvent.click(screen.getByTestId("show-repository-in-finder"));

    await vi.waitFor(() => {
      expect(openerMock.openPath).toHaveBeenCalledWith("/Users/me/alpha");
    });
  });

  it("W1b: surfaces Finder open failures as an app error", async () => {
    openerMock.openPath.mockRejectedValueOnce(new Error("open failed"));
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("workflow-settings"));
    fireEvent.click(screen.getByTestId("show-repository-in-finder"));

    const alert = await screen.findByTestId("app-error-alert");
    expect(alert).toHaveTextContent("Show repository in Finder failed");
    expect(alert).toHaveTextContent("open failed");
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
    expect(screen.getByTestId("workflow-settings")).toBeDisabled();
    expect(screen.queryByTestId("show-repository-in-finder")).not.toBeInTheDocument();
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

  it("W8b: saves Continue on failure with the workflow", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("workflow-settings"));
    fireEvent.click(screen.getByRole("switch", { name: "Continue on failure" }));
    fireEvent.click(screen.getByTestId("workflow-save"));

    await vi.waitFor(() => {
      expect(bridgeMock.saveWorkflow).toHaveBeenCalledTimes(1);
    });
    const [, , payload] = bridgeMock.saveWorkflow.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(JSON.parse(payload).continueOnFailure).toBe(true);
  });

  it("W8d: adds the tutorial starter flow to an empty selected repo and saves as a regular workflow", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    markStarterFlowPromptPending(SAMPLE.id);

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("starter-flow-empty")).toHaveTextContent(
      "/Users/me/alpha",
    );
    expect(screen.getByTestId("starter-flow-empty")).toHaveTextContent(
      "What would you like to build?",
    );
    expect(screen.getByTestId("starter-flow-add")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("starter-flow-goal-input"), {
      target: { value: "Add a theme toggle" },
    });
    fireEvent.click(screen.getByTestId("starter-flow-add"));

    expect(useWorkflowStore.getState().workflowName).toBe("Tutorial starter flow");
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual([
      "starter_boarding",
      "starter_taxiing",
      "starter_review_and_fix",
      "starter_wrap_up",
    ]);
    expect(useWorkflowStore.getState().edges).toHaveLength(3);
    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "Add a theme toggle",
    });
    expect(useWorkflowStore.getState().nodes.slice(1).every((node) => !node.data.input)).toBe(
      true,
    );
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
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
    });
  });

  it("shows the starter flow prompt only once for a newly added empty repo", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    markStarterFlowPromptPending(SAMPLE.id);

    const first = renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("starter-flow-empty")).toBeInTheDocument();
    first.unmount();

    renderAt("/workspace/id-alpha");

    expect(screen.queryByTestId("starter-flow-empty")).not.toBeInTheDocument();
  });

  it("dismisses the starter flow prompt without adding nodes", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    markStarterFlowPromptPending(SAMPLE.id);

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("starter-flow-dismiss"));

    expect(screen.queryByTestId("starter-flow-empty")).not.toBeInTheDocument();
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });

  it("does not show the starter flow prompt for a plain empty workspace", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.queryByTestId("starter-flow-empty")).not.toBeInTheDocument();
  });

  it("W8e: adds the mixed starter flow even when the feature prompt is blank", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    markStarterFlowPromptPending(SAMPLE.id);

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("starter-flow-add"));

    expect(useWorkflowStore.getState().nodes).toHaveLength(4);
    expect(useWorkflowStore.getState().nodes[0].data.input).toBeUndefined();
  });

  it("W8f: adds a default skill node from the common section", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    await vi.waitFor(() => {
      expect(screen.getByText("planning")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByTestId("default-skill-list__add")[0]);

    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().nodes[0].data.label).toBe("planning");
    expect(useWorkflowStore.getState().nodes[0].data.skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
      skillFileAbsPath:
        "/Applications/Circuit.app/default-skills/.codex/skills/planning/SKILL.md",
    });
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
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            label: "ISSUE-ID",
            placeholder: "<ISSUE-ID> [--force]",
          },
        ],
      },
      { x: 10, y: 20 },
    );

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByTestId("skill-node-input-edit"));
    expect(screen.getByTestId("skill-node-input-popover")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("skill-node-input-arguments"), {
      target: { value: "CIR-15 --force" },
    });

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

  it("W9: clicking Start runs the workflow immediately", async () => {
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

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
    const fooNodeId = useWorkflowStore.getState().nodes[0].id;
    expect(useRunStore.getState().nodeStates[fooNodeId]).toBe("success");
  });

  it("shows a Root badge only on the calculated root node", async () => {
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
        name: "Bar",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 100, y: 20 },
    );
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });

    await vi.waitFor(() => {
      expect(screen.getAllByTestId("root-badge")).toHaveLength(1);
    });
    expect(screen.getByTestId("root-badge").closest("[data-node-id]")).toHaveAttribute(
      "data-node-id",
      a,
    );
  });

  it("blocks disconnected graphs at Start and shows an alert", async () => {
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
        name: "Bar",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 100, y: 20 },
    );
    useWorkflowStore.getState().addSkillNode(
      {
        id: "claude:.claude/skills/foo",
        provider: "claude",
        name: "Baz",
        description: "",
        rootDir: ".claude/skills/foo",
        skillFile: ".claude/skills/foo/SKILL.md",
      },
      { x: 200, y: 20 },
    );
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    expect(screen.getByText("Start Circuit failed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Workflow graph must have exactly one root. Connect every node into one entry flow before starting Circuit.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cycle-run-confirm")).not.toBeInTheDocument();
    expect(useRunStore.getState().status).toBe("idle");
  });

  it("blocks Start before spawn when repository preflight fails", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    bridgeMock.checkRepositoryEnvironment = vi.fn(async () => ({
      repoRoot: { ok: true },
      gitCommonDir: { ok: false, message: "Operation not permitted" },
      codexStateDir: { ok: true },
      githubCliAuth: { ok: true },
    }));

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

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("workflow-start"));

    const alert = await screen.findByTestId("app-error-alert");
    expect(alert).toHaveTextContent("Start Circuit failed");
    expect(alert).toHaveTextContent("git metadata");
    expect(alert).toHaveTextContent("Operation not permitted");
    expect(useRunStore.getState().status).toBe("idle");
  });

  it("W9a: opens hello_world.html after a successful tutorial run", async () => {
    const tutorialRepo: Repository = {
      id: "id-tutorial",
      name: "Circuit Tutorial",
      path: "/Users/me/Circuit Tutorial",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    useRepositoryStore.setState({ repositories: [tutorialRepo], hydrated: true });
    bridgeMock.pathExists.mockImplementation(async (...args: unknown[]) => {
      const path = args[0] as string;
      return path === "/Users/me/Circuit Tutorial/hello_world.html";
    });
    (window as unknown as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__ =
      createMockRuntimeBridge({
        files: {
          "/Users/me/Circuit Tutorial/.claude/skills/foo/SKILL.md":
            "---\nname: Foo\n---\n\n# Foo\n",
        },
        scenario: () => [
          { event: { type: "started" } },
          { event: { type: "exited", exitCode: 0 } },
        ],
      });

    renderAt("/workspace/id-tutorial");
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

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
      expect(openerMock.openPath).toHaveBeenCalledWith(
        "/Users/me/Circuit Tutorial/hello_world.html",
      );
    });
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
      screen.getByRole("dialog", { name: "Run workflow loop" }),
    ).toHaveTextContent(
      "This workflow contains a loop and will repeat until it fails, is cancelled, or a skill stops the loop.",
    );
    expect(screen.getByTestId("cycle-run-confirm")).toHaveTextContent(
      "Start repeated execution?",
    );
    expect(useRunStore.getState().status).toBe("idle");
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
      continueOnFailure: true,
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
    expect(useWorkflowStore.getState().continueOnFailure).toBe(true);
    expect(screen.getByTestId("workflow-name-input")).toHaveValue("Unsaved draft");
  });

  it("W12: persists workflow edits into the local draft", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    useWorkflowStore.getState().setWorkflowName("Local autosave");
    useWorkflowStore.getState().setContinueOnFailure(true);
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
    expect(draft?.continueOnFailure).toBe(true);
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
          { delayMs: 200, event: { type: "exited", exitCode: 0 } },
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
        continueOnFailure: true,
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
    expect(useWorkflowStore.getState().continueOnFailure).toBe(true);
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual([
      "run-node",
    ]);
    expect(screen.queryByTestId("workflow-save-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-start")).toBeDisabled();
    expect(screen.getByTestId("workflow-start")).toHaveTextContent("Running");
  });

  it("W14b: hides another repository's active run state in this workspace", async () => {
    useRepositoryStore.setState({
      repositories: [SAMPLE, BETA],
      hydrated: true,
    });
    saveWorkflowDraft(SAMPLE.id, {
      workflowId: "alpha-wf",
      workflowName: "Alpha draft",
      nodes: [
        {
          id: "shared-node",
          type: "skill",
          position: { x: 10, y: 20 },
          data: {
            label: "Alpha node",
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
      runId: "run-beta",
      workflowId: "beta-wf",
      workflowName: "Beta active run",
      repository: { id: BETA.id, name: BETA.name },
      nodeIds: ["shared-node"],
      startedAt: "2026-05-09T00:00:00.000Z",
      snapshot: {
        repository: BETA,
        workflowId: "beta-wf",
        workflowName: "Beta active run",
        continueOnFailure: false,
        nodes: [
          {
            id: "shared-node",
            type: "skill",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
            label: "Beta node",
            position: { x: 30, y: 40 },
          },
        ],
        edges: [],
      },
    });
    useRunStore.getState().setActiveNode("shared-node");
    useRunStore.getState().setNodeState("shared-node", "running");
    useRunLogStore.getState().beginRun({
      runId: "run-beta",
      workflowId: "beta-wf",
      repositoryId: BETA.id,
    });
    useRunLogStore.getState().appendEvent("shared-node", {
      type: "status",
      timestamp: "2026-05-09T00:00:01.000Z",
      status: "running beta node",
    });

    renderAt("/workspace/id-alpha");

    await vi.waitFor(() => {
      expect(screen.getByTestId("workflow-node")).toHaveAttribute(
        "data-run-state",
        "idle",
      );
    });
    expect(screen.getByTestId("workflow-start")).not.toBeDisabled();
    expect(screen.getByTestId("workflow-start")).toHaveTextContent(
      "Start Circuit",
    );
    expect(screen.getByTestId("workflow-cancel")).toBeDisabled();
    expect(screen.getByTestId("run-log-run-state")).toHaveTextContent("idle");
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.queryByText("running beta node")).not.toBeInTheDocument();
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

  it("W18: collapses and restores the properties panel without a props resize handle", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("properties-panel-collapse"));

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--props-collapsed",
    );
    expect(screen.getByTestId("properties-panel-restore")).toBeInTheDocument();
    expect(screen.queryByTestId("properties-panel-collapse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-props")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("properties-panel-restore"));

    expect(screen.getByTestId("workspace-root")).not.toHaveClass(
      "workspace--props-collapsed",
    );
    expect(screen.getByTestId("properties-panel-collapse")).toBeInTheDocument();
    expect(screen.getByTestId("resize-handle-props")).toBeInTheDocument();
    expect(screen.queryByTestId("properties-panel-restore")).not.toBeInTheDocument();
  });

  it("W19: keeps the collapsed properties panel state across workspace remounts in the same session", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    const firstRender = renderAt("/workspace/id-alpha");
    fireEvent.click(screen.getByTestId("properties-panel-collapse"));
    firstRender.unmount();

    renderAt("/workspace/id-alpha");

    expect(screen.getByTestId("workspace-root")).toHaveClass(
      "workspace--props-collapsed",
    );
    expect(screen.getByTestId("properties-panel-restore")).toBeInTheDocument();
  });

  it("W20: keeps the collapsed run log state across workspace remounts in the same session", () => {
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

  it("W20b: opens the run log when starting Circuit", async () => {
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

    expect(screen.getByTestId("workspace-root")).not.toHaveClass(
      "workspace--log-collapsed",
    );
    expect(screen.getByTestId("run-log-collapse")).toBeInTheDocument();
    expect(screen.queryByTestId("run-log-restore")).not.toBeInTheDocument();
  });

  it("W21: leaves the toolbar status slot empty after a run completes", () => {
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

    expect(screen.queryByTestId("workflow-save-status")).not.toBeInTheDocument();
  });

  it("W22: hides Rerun from failed after a successful run", () => {
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
      snapshot: {
        repository: SAMPLE,
        workflowId: "wf-1",
        workflowName: "Deploy flow",
        continueOnFailure: false,
        nodes: [
          {
            id: "node-1",
            type: "skill",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
            label: "Foo",
            position: { x: 10, y: 20 },
          },
        ],
        edges: [],
      },
    });

    renderAt("/workspace/id-alpha");

    expect(screen.queryByTestId("workflow-rerun-from-failed")).not.toBeInTheDocument();
  });

  it("W23: reruns the last failed snapshot from the failed node after preview confirmation", async () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });
    const spawnedRunIds: string[] = [];
    const spawnedPrompts: string[] = [];
    (window as unknown as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__ =
      createMockRuntimeBridge({
        files: {
          "/Users/me/alpha/.claude/skills/foo/SKILL.md":
            "---\nname: Foo\n---\n\n# Foo\n",
        },
        scenario: (options) => {
          spawnedRunIds.push(options.runId);
          spawnedPrompts.push(options.args.join("\n"));
          return [
            { event: { type: "started" } },
            { event: { type: "exited", exitCode: 0 } },
          ];
        },
      });

    const firstResult: SkillExecutionResult = {
      status: "success",
      output: { ok: true },
      logs: [],
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:01.000Z",
    };
    const failedResult: SkillExecutionResult = {
      status: "failed",
      summary: "failed earlier",
      logs: [
        {
          type: "error",
          timestamp: "2026-05-09T00:00:02.000Z",
          message: "boom",
        },
      ],
      startedAt: "2026-05-09T00:00:01.000Z",
      finishedAt: "2026-05-09T00:00:02.000Z",
    };
    useRunStore.setState({
      status: "failed",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Deploy flow",
      repositoryId: SAMPLE.id,
      repositoryName: SAMPLE.name,
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:02.000Z",
      activeNodeId: null,
      nodeStates: { first: "success", second: "failed" },
      nodeDebug: {},
      snapshot: {
        repository: SAMPLE,
        workflowId: "wf-1",
        workflowName: "Deploy flow",
        continueOnFailure: true,
        nodes: [
          {
            id: "first",
            type: "skill",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
            label: "First",
            position: { x: 10, y: 20 },
          },
          {
            id: "second",
            type: "skill",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/foo/SKILL.md",
            },
            label: "Second",
            position: { x: 100, y: 20 },
          },
        ],
        edges: [{ id: "e1", source: "first", target: "second", kind: "dependency" }],
      },
    });
    useRunLogStore.setState({
      nodeResults: { first: firstResult, second: failedResult },
    });

    renderAt("/workspace/id-alpha");

    fireEvent.click(screen.getByTestId("workflow-rerun-from-failed"));

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
    expect(spawnedRunIds).toHaveLength(1);
    expect(spawnedRunIds[0]).toMatch(/::second$/);
    expect(spawnedPrompts[0]).toContain("# Rerun With Previous Failure Context");
    expect(spawnedPrompts[0]).toContain("- previous status: failed");
    expect(screen.getByText("rerun from failed started (previous status: failed)")).toBeInTheDocument();
    expect(useRunStore.getState().nodeStates).toEqual({
      first: "skipped",
      second: "success",
    });
    expect(useRunStore.getState().snapshot?.continueOnFailure).toBe(true);
  });
});
