import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const dialogMock = vi.hoisted(() => ({
  open: vi.fn(),
}));

const storeMock = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}));

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialogMock.open,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = storeMock.get;
    set = storeMock.set;
    save = storeMock.save;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMock.invoke,
}));

import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { RepositoryList } from "./RepositoryList";
import { renderWithRouter } from "../test/utils";

beforeEach(() => {
  dialogMock.open.mockReset();
  storeMock.get.mockReset();
  storeMock.set.mockReset();
  storeMock.save.mockReset();
  storeMock.get.mockResolvedValue(undefined);
  storeMock.set.mockResolvedValue(undefined);
  storeMock.save.mockResolvedValue(undefined);
  tauriCoreMock.invoke.mockReset();
  tauriCoreMock.invoke.mockResolvedValue([]);

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
    expect(screen.getByText(/No repositories yet/i)).toBeInTheDocument();
  });

  it("R2: clicking Add invokes folder picker and renders selected folder", async () => {
    dialogMock.open.mockResolvedValueOnce("/Users/me/projects/alpha");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByRole("button", { name: "Add Repository" }));

    expect(dialogMock.open).toHaveBeenCalledWith({ directory: true, multiple: false });

    const item = await screen.findByText("alpha");
    expect(item).toBeInTheDocument();
    expect(screen.getByText("/Users/me/projects/alpha")).toBeInTheDocument();
  });

  it("R3: cancelling the picker (null) leaves the empty hint intact", async () => {
    dialogMock.open.mockResolvedValueOnce(null);
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByRole("button", { name: "Add Repository" }));

    await waitFor(() => expect(dialogMock.open).toHaveBeenCalled());
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

  it("R8: triggers scan_skills for repos missing from skill store after hydrate", async () => {
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
      expect(tauriCoreMock.invoke).toHaveBeenCalledWith("scan_skills", {
        repoPath: "/Users/me/new",
      }),
    );
  });

  it("R5: adding the same path twice keeps a single row (silent dedupe)", async () => {
    dialogMock.open
      .mockResolvedValueOnce("/Users/me/dup")
      .mockResolvedValueOnce("/Users/me/dup");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    const button = screen.getByRole("button", { name: "Add Repository" });

    await user.click(button);
    await screen.findByText("dup");

    await user.click(button);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
  });
});
