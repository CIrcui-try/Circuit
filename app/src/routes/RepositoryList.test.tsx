import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(),
  loadRepositories: vi.fn(),
  saveRepositories: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { RepositoryList } from "./RepositoryList";
import { renderWithRouter } from "../test/utils";

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
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
});

describe("RepositoryList", () => {
  it("R1: shows empty hint and Add button when no repositories", () => {
    renderWithRouter(<RepositoryList />);

    expect(screen.getByRole("heading", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Repository" })).toBeInTheDocument();
    expect(screen.getByTestId("add-repository-button")).toBeInTheDocument();
    expect(screen.getByText(/No repositories yet/i)).toBeInTheDocument();
  });

  it("R2: clicking Add invokes folder picker and renders selected folder", async () => {
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce("/Users/me/projects/alpha");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByTestId("add-repository-button"));

    expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled();

    const item = await screen.findByText("alpha");
    expect(item).toBeInTheDocument();
    expect(screen.getByText("/Users/me/projects/alpha")).toBeInTheDocument();
    expect(screen.getByTestId("repository-list")).toBeInTheDocument();
  });

  it("R3: cancelling the picker (null) leaves the empty hint intact", async () => {
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce(null);
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByTestId("add-repository-button"));

    await waitFor(() => expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled());
    expect(screen.getByText(/No repositories yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("R4: pre-seeded repositories render as links to /workspace/<id>", () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-alpha",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "id-beta",
          name: "beta",
          path: "/Users/me/beta",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });

    renderWithRouter(<RepositoryList />);

    const alphaLink = screen.getByRole("link", { name: /alpha/ });
    const betaLink = screen.getByRole("link", { name: /beta/ });
    expect(alphaLink).toHaveAttribute("href", "/workspace/id-alpha");
    expect(betaLink).toHaveAttribute("href", "/workspace/id-beta");
  });

  it("R6: shows Claude/Codex count badges once scan resolves", async () => {
    useSkillStore.setState({
      byRepo: {
        "id-alpha": [
          {
            id: "claude:.claude/skills/foo",
            provider: "claude",
            name: "Foo",
            description: "",
            rootDir: ".claude/skills/foo",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
          {
            id: "claude:.claude/skills/bar",
            provider: "claude",
            name: "Bar",
            description: "",
            rootDir: ".claude/skills/bar",
            skillFile: ".claude/skills/bar/SKILL.md",
          },
          {
            id: "codex:.codex/skills/baz",
            provider: "codex",
            name: "Baz",
            description: "",
            rootDir: ".codex/skills/baz",
            skillFile: ".codex/skills/baz/SKILL.md",
          },
        ],
      },
      loading: { "id-alpha": false },
      errors: {},
    });
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

    renderWithRouter(<RepositoryList />);

    expect(screen.getByTestId("badge-claude")).toHaveTextContent("Claude · 2");
    expect(screen.getByTestId("badge-codex")).toHaveTextContent("Codex · 1");
  });

  it("R7: shows ellipsis placeholder while a scan is in-flight", () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-pending",
          name: "pending",
          path: "/Users/me/pending",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: {},
      loading: { "id-pending": true },
      errors: {},
    });

    renderWithRouter(<RepositoryList />);

    expect(screen.getByTestId("badge-claude")).toHaveTextContent("Claude · …");
    expect(screen.getByTestId("badge-codex")).toHaveTextContent("Codex · …");
  });

  it("R8: triggers scanSkills for repos missing from skill store after hydrate", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-new",
          name: "new",
          path: "/Users/me/new",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });

    renderWithRouter(<RepositoryList />);

    await waitFor(() =>
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/new"),
    );
  });

  it("R9: re-scans on mount even when byRepo cache is already populated", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-cached",
          name: "cached",
          path: "/Users/me/cached",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { "id-cached": [] },
      loading: { "id-cached": false },
      errors: {},
    });

    renderWithRouter(<RepositoryList />);

    await waitFor(() =>
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/cached"),
    );
  });

  it("R10: Remove button removes the row after confirm; cancel keeps it", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-keep",
          name: "keep",
          path: "/Users/me/keep",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "id-drop",
          name: "drop",
          path: "/Users/me/drop",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });

    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Remove drop" }));
    expect(useRepositoryStore.getState().repositories).toHaveLength(2);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Remove drop" }));

    await waitFor(() =>
      expect(useRepositoryStore.getState().repositories.map((r) => r.id)).toEqual(["id-keep"]),
    );
    expect(screen.queryByText("drop")).not.toBeInTheDocument();
    expect(bridgeMock.saveRepositories).toHaveBeenCalledWith(expect.any(Array));

    confirmSpy.mockRestore();
  });

  it("R11: clicking Refresh re-invokes scanSkills for every registered repo", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-a",
          name: "a",
          path: "/Users/me/a",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "id-b",
          name: "b",
          path: "/Users/me/b",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { "id-a": [], "id-b": [] },
      loading: { "id-a": false, "id-b": false },
      errors: {},
    });

    const user = userEvent.setup();
    renderWithRouter(<RepositoryList />);

    await waitFor(() => {
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/a");
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/b");
    });

    const callsBefore = bridgeMock.scanSkills.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(bridgeMock.scanSkills.mock.calls.length).toBeGreaterThanOrEqual(
        callsBefore + 2,
      );
    });
    const aCalls = bridgeMock.scanSkills.mock.calls.filter(
      ([path]) => path === "/Users/me/a",
    ).length;
    const bCalls = bridgeMock.scanSkills.mock.calls.filter(
      ([path]) => path === "/Users/me/b",
    ).length;
    expect(aCalls).toBeGreaterThanOrEqual(2);
    expect(bCalls).toBeGreaterThanOrEqual(2);
  });

  it("R12: Refresh button is hidden when there are no repositories", () => {
    renderWithRouter(<RepositoryList />);

    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("R5: adding the same path twice keeps a single row (silent dedupe)", async () => {
    bridgeMock.openRepositoryDialog
      .mockResolvedValueOnce("/Users/me/dup")
      .mockResolvedValueOnce("/Users/me/dup");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    const button = screen.getByTestId("add-repository-button");

    await user.click(button);
    await screen.findByText("dup");

    await user.click(button);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
  });
});
