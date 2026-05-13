import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(async () => null),
  scanSkills: vi.fn(async () => []),
  loadRepositories: vi.fn(async () => null),
  saveRepositories: vi.fn(async () => {}),
  listWorkflows: vi.fn(async () => []),
  loadWorkflow: vi.fn(async () => "{}"),
  saveWorkflow: vi.fn(async () => {}),
  setAppIconRunBadge: vi.fn(async () => {}),
  isAppWindowFocused: vi.fn(async () => true),
  onAppWindowFocusChanged: vi.fn(
    async (_handler: (focused: boolean) => void) => () => {},
  ),
}));

vi.mock("./host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import App from "./App";
import { useRepositoryStore } from "./stores/repositoryStore";
import { useRunLogStore } from "./runner/runLogStore";
import { useRunStore } from "./runner/runStore";

beforeEach(() => {
  bridgeMock.openRepositoryDialog.mockReset();
  bridgeMock.scanSkills.mockReset();
  bridgeMock.loadRepositories.mockReset();
  bridgeMock.saveRepositories.mockReset();
  bridgeMock.setAppIconRunBadge.mockReset();
  bridgeMock.isAppWindowFocused.mockReset();
  bridgeMock.onAppWindowFocusChanged.mockReset();
  bridgeMock.openRepositoryDialog.mockResolvedValue(null);
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.loadRepositories.mockResolvedValue(null);
  bridgeMock.saveRepositories.mockResolvedValue(undefined);
  bridgeMock.setAppIconRunBadge.mockResolvedValue(undefined);
  bridgeMock.isAppWindowFocused.mockResolvedValue(true);
  bridgeMock.onAppWindowFocusChanged.mockResolvedValue(() => {});

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useRunStore.getState().reset();
  useRunLogStore.getState().reset();
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

  it("A6: marks the app icon badge when a workflow finishes in the background", async () => {
    bridgeMock.isAppWindowFocused.mockResolvedValue(false);
    useRunStore.setState({
      status: "success",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: null,
      repositoryId: "id-alpha",
      repositoryName: "alpha",
      startedAt: "2026-05-09T00:00:00Z",
      finishedAt: "2026-05-09T00:00:05Z",
      activeNodeId: null,
      nodeStates: { "node-1": "success" },
      nodeDebug: {},
      snapshot: null,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(bridgeMock.setAppIconRunBadge).toHaveBeenCalledWith(true);
    });
  });

  it("A7: leaves the app icon badge clear when a workflow finishes while focused", async () => {
    bridgeMock.isAppWindowFocused.mockResolvedValue(true);
    useRunStore.setState({
      status: "failed",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: null,
      repositoryId: "id-alpha",
      repositoryName: "alpha",
      startedAt: "2026-05-09T00:00:00Z",
      finishedAt: "2026-05-09T00:00:05Z",
      activeNodeId: null,
      nodeStates: { "node-1": "failed" },
      nodeDebug: {},
      snapshot: null,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(bridgeMock.setAppIconRunBadge).toHaveBeenCalledWith(false);
    });
  });

  it("A8: clears the app icon badge when the app regains focus", async () => {
    let focusHandler: ((focused: boolean) => void) | null = null;
    bridgeMock.onAppWindowFocusChanged.mockImplementation(async (handler) => {
      focusHandler = handler;
      return () => {};
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(focusHandler).not.toBeNull();
    });

    act(() => {
      focusHandler?.(true);
    });

    await waitFor(() => {
      expect(bridgeMock.setAppIconRunBadge).toHaveBeenCalledWith(false);
    });
  });
});
