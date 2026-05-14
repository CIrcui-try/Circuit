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
  setAppIconRunBadgeCount: vi.fn(async (_count: number) => {}),
  notifyRunFinished: vi.fn(
    async (_notification: {
      title: string;
      body?: string;
      repositoryId?: string;
    }) => {},
  ),
  notificationClickHandler: null as ((repositoryId: string) => void) | null,
  onRunCompletionNotificationClicked: vi.fn(
    async (handler: (repositoryId: string) => void) => {
      bridgeMock.notificationClickHandler = handler;
      return () => {
        bridgeMock.notificationClickHandler = null;
      };
    },
  ),
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
  bridgeMock.setAppIconRunBadgeCount.mockReset();
  bridgeMock.notifyRunFinished.mockReset();
  bridgeMock.onRunCompletionNotificationClicked.mockReset();
  bridgeMock.isAppWindowFocused.mockReset();
  bridgeMock.onAppWindowFocusChanged.mockReset();
  bridgeMock.openRepositoryDialog.mockResolvedValue(null);
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.loadRepositories.mockResolvedValue(null);
  bridgeMock.saveRepositories.mockResolvedValue(undefined);
  bridgeMock.setAppIconRunBadgeCount.mockResolvedValue(undefined);
  bridgeMock.notifyRunFinished.mockResolvedValue(undefined);
  bridgeMock.notificationClickHandler = null;
  bridgeMock.onRunCompletionNotificationClicked.mockImplementation(async (handler) => {
    bridgeMock.notificationClickHandler = handler;
    return () => {
      bridgeMock.notificationClickHandler = null;
    };
  });
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

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("Repository: alpha")).not.toBeInTheDocument();
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
      expect(bridgeMock.setAppIconRunBadgeCount).toHaveBeenCalledWith(1);
    });
  });

  it("A7: increments the app icon badge count for multiple background completions", async () => {
    bridgeMock.isAppWindowFocused.mockResolvedValue(false);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    act(() => {
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
    });

    await waitFor(() => {
      expect(bridgeMock.setAppIconRunBadgeCount).toHaveBeenCalledWith(1);
    });

    act(() => {
      useRunStore.setState({
        status: "running",
        runId: "run-2",
        workflowId: "wf-1",
        workflowName: null,
        repositoryId: "id-alpha",
        repositoryName: "alpha",
        startedAt: "2026-05-09T00:01:00Z",
        finishedAt: null,
        activeNodeId: null,
        nodeStates: { "node-1": "running" },
        nodeDebug: {},
        snapshot: null,
      });
    });

    act(() => {
      useRunStore.setState({
        status: "failed",
        runId: "run-2",
        workflowId: "wf-1",
        workflowName: null,
        repositoryId: "id-alpha",
        repositoryName: "alpha",
        startedAt: "2026-05-09T00:01:00Z",
        finishedAt: "2026-05-09T00:01:05Z",
        activeNodeId: null,
        nodeStates: { "node-1": "failed" },
        nodeDebug: {},
        snapshot: null,
      });
    });

    await waitFor(() => {
      expect(bridgeMock.setAppIconRunBadgeCount).toHaveBeenCalledWith(2);
    });
  });

  it("A8: leaves the app icon badge clear when a workflow finishes while focused", async () => {
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
      expect(bridgeMock.setAppIconRunBadgeCount).toHaveBeenCalledWith(0);
    });
  });

  it("A9: clears the app icon badge when the app regains focus", async () => {
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
      expect(bridgeMock.setAppIconRunBadgeCount).toHaveBeenCalledWith(0);
    });
  });

  it.each([
    ["success", "Workflow completed"],
    ["failed", "Workflow failed"],
    ["cancelled", "Workflow cancelled"],
    ["timeout", "Workflow timed out"],
  ] as const)(
    "A10: sends a run completion notification for background %s runs",
    async (status, title) => {
      bridgeMock.isAppWindowFocused.mockResolvedValue(false);
      useRunStore.setState({
        status,
        runId: `run-${status}`,
        workflowId: "wf-1",
        workflowName: "Release flow",
        repositoryId: "id-alpha",
        repositoryName: "alpha",
        startedAt: "2026-05-09T00:00:00Z",
        finishedAt: "2026-05-09T00:00:05Z",
        activeNodeId: null,
        nodeStates: { "node-1": status },
        nodeDebug: {},
        snapshot: null,
      });

      render(
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(bridgeMock.notifyRunFinished).toHaveBeenCalledWith({
          title,
          body: "Release flow in alpha",
          repositoryId: "id-alpha",
        });
      });
    },
  );

  it("A13: navigates to the repository workspace when a run notification is clicked", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-alpha",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(bridgeMock.notificationClickHandler).not.toBeNull();
    });

    act(() => {
      bridgeMock.notificationClickHandler?.("id-alpha");
    });

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("Repository: alpha")).not.toBeInTheDocument();
  });

  it("A11: shows an in-app completion alert while focused", async () => {
    bridgeMock.isAppWindowFocused.mockResolvedValue(true);
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-alpha",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    useRunStore.setState({
      status: "success",
      runId: "run-focused",
      workflowId: "wf-1",
      workflowName: "Release flow",
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
      <MemoryRouter initialEntries={["/workspace/id-alpha"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(bridgeMock.isAppWindowFocused).toHaveBeenCalled();
    });
    expect(bridgeMock.notifyRunFinished).not.toHaveBeenCalled();
    expect(await screen.findByTestId("app-error-alert")).toHaveTextContent(
      "Workflow completed",
    );
    expect(screen.getByTestId("app-error-alert")).toHaveTextContent(
      "Release flow in alpha",
    );
  });

  it("A12: sends only one run completion notification per run", async () => {
    bridgeMock.isAppWindowFocused.mockResolvedValue(false);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    act(() => {
      useRunStore.setState({
        status: "success",
        runId: "run-once",
        workflowId: "wf-1",
        workflowName: "Release flow",
        repositoryId: "id-alpha",
        repositoryName: "alpha",
        startedAt: "2026-05-09T00:00:00Z",
        finishedAt: "2026-05-09T00:00:05Z",
        activeNodeId: null,
        nodeStates: { "node-1": "success" },
        nodeDebug: {},
        snapshot: null,
      });
    });

    await waitFor(() => {
      expect(bridgeMock.notifyRunFinished).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useRunStore.setState({
        status: "failed",
        runId: "run-once",
        workflowId: "wf-1",
        workflowName: "Release flow",
        repositoryId: "id-alpha",
        repositoryName: "alpha",
        startedAt: "2026-05-09T00:00:00Z",
        finishedAt: "2026-05-09T00:00:06Z",
        activeNodeId: null,
        nodeStates: { "node-1": "failed" },
        nodeDebug: {},
        snapshot: null,
      });
    });

    await waitFor(() => {
      expect(bridgeMock.notifyRunFinished).toHaveBeenCalledTimes(1);
    });
  });
});
