import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  bridgeMock.openRepositoryDialog.mockResolvedValue(null);
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.loadRepositories.mockResolvedValue(null);
  bridgeMock.saveRepositories.mockResolvedValue(undefined);

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
});
