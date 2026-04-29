import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const storeMock = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = storeMock.get;
    set = storeMock.set;
    save = storeMock.save;
  },
}));

import { useRepositoryStore, type Repository } from "../stores/repositoryStore";
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
  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
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

  it("W5: Workflow / Save / Start Circuit buttons stay disabled (regression guard)", () => {
    useRepositoryStore.setState({ repositories: [SAMPLE], hydrated: true });

    renderAt("/workspace/id-alpha");

    expect(screen.getByRole("button", { name: /Workflow/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Start Circuit/i })).toBeDisabled();
  });
});
