import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
  useRunLogStore.getState().reset();
  window.localStorage.clear();
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
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
  });

  it("W9: clicking Start drives the run store to success without a confirmation modal", async () => {
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

    expect(screen.queryByTestId("run-preview-modal")).not.toBeInTheDocument();

    await vi.waitFor(() => {
      expect(useRunStore.getState().status).toBe("success");
    });
    const fooNodeId = useWorkflowStore.getState().nodes[0].id;
    expect(useRunStore.getState().nodeStates[fooNodeId]).toBe("success");
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
});
