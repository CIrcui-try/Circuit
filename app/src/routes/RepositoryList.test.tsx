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

import { useRepositoryStore } from "../stores/repositoryStore";
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

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
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
