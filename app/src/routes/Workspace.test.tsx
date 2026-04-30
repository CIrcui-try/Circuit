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
import { Workspace } from "./Workspace";

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

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
  useWorkflowStore.getState().resetWorkflow();
  useRunStore.getState().reset();
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

  it("W9: clicking Start Circuit drives the run store from idle to success", async () => {
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
});
