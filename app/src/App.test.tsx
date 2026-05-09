import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(async () => null),
  scanSkills: vi.fn(async () => []),
  loadRepositories: vi.fn(async () => null),
  saveRepositories: vi.fn(async () => {}),
  listWorkflows: vi.fn(async () => []),
  loadWorkflow: vi.fn(async () => "{}"),
  saveWorkflow: vi.fn(async () => {}),
}));

const runControllerMock = vi.hoisted(() => ({
  cancelWorkflowRun: vi.fn(async () => true),
  startWorkflowRun: vi.fn(),
}));

vi.mock("./host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

vi.mock("./runner/runController", () => runControllerMock);

import App from "./App";
import { useRepositoryStore } from "./stores/repositoryStore";
import { useRunStore } from "./runner/runStore";

beforeEach(() => {
  bridgeMock.openRepositoryDialog.mockReset();
  bridgeMock.scanSkills.mockReset();
  bridgeMock.loadRepositories.mockReset();
  bridgeMock.saveRepositories.mockReset();
  bridgeMock.openRepositoryDialog.mockResolvedValue(null);
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.loadRepositories.mockResolvedValue(null);
  bridgeMock.saveRepositories.mockResolvedValue(undefined);
  runControllerMock.cancelWorkflowRun.mockClear();
  runControllerMock.cancelWorkflowRun.mockResolvedValue(true);

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useRunStore.getState().reset();
});

describe("App routing", () => {
  it("A1: renders RepositoryList at /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Repositories" })).toBeInTheDocument();
  });

  it("A2: renders Workspace toolbar at /workspace/:repoId", () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });

    render(
      <MemoryRouter initialEntries={["/workspace/id-1"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("Repository: alpha")).toBeInTheDocument();
  });

  it("A3: invokes hydrate() on mount", () => {
    const hydrate = vi.fn().mockResolvedValue(undefined);
    useRepositoryStore.setState({ hydrate });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("A4: renders the global run toast on the repository list with workflow actions", async () => {
    useRunStore.getState().beginRun({
      runId: "run-1",
      workflowId: "wf-1",
      repository: { id: "id-alpha", name: "alpha" },
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:00Z",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("run-floating-toast")).toHaveTextContent("Running");
    expect(screen.getByTestId("run-floating-toast")).toHaveTextContent("alpha");
    expect(screen.getByRole("link", { name: "Go to workflow" })).toHaveAttribute(
      "href",
      "/workspace/id-alpha",
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(runControllerMock.cancelWorkflowRun).toHaveBeenCalledTimes(1);
  });

  it("A5: labels waiting input runs without taking over the LogPanel response flow", () => {
    useRunStore.getState().beginRun({
      runId: "run-1",
      workflowId: "wf-1",
      repository: { id: "id-alpha", name: "alpha" },
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:00Z",
    });
    useRunStore.getState().setNodeState("node-1", "waiting_input");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("run-floating-toast")).toHaveTextContent("Needs input");
    expect(screen.getByTestId("run-floating-toast")).toHaveTextContent(
      "Respond in the workflow log",
    );
  });
});
