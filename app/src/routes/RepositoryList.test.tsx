import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  createTutorialRepository: vi.fn(),
  scanSkills: vi.fn(),
  loadRepositories: vi.fn(),
  saveRepositories: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore } from "../stores/skillStore";
import { useRunStore } from "../runner/runStore";
import { RepositoryList } from "./RepositoryList";
import { renderWithRouter } from "../test/utils";
import { consumeStarterFlowPrompt } from "../workflow/starterFlowPrompt";

beforeEach(() => {
  window.localStorage.clear();
  bridgeMock.openRepositoryDialog.mockReset();
  bridgeMock.createTutorialRepository.mockReset();
  bridgeMock.scanSkills.mockReset();
  bridgeMock.loadRepositories.mockReset();
  bridgeMock.saveRepositories.mockReset();

  bridgeMock.openRepositoryDialog.mockResolvedValue(null);
  bridgeMock.createTutorialRepository.mockResolvedValue("/Users/me/Circuit Tutorial");
  bridgeMock.scanSkills.mockResolvedValue([]);
  bridgeMock.loadRepositories.mockResolvedValue(null);
  bridgeMock.saveRepositories.mockResolvedValue(undefined);

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: true,
  });
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
  useRunStore.getState().reset();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("RepositoryList", () => {
  it("shows a work-hub header with the primary repository action", () => {
    renderWithRouter(<RepositoryList />);

    expect(
      screen.getByRole("heading", { name: "Circuit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Skill-Based AI Agent Harness Editor"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Run agent workflows across your repositories."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("add-repository-button")).toHaveTextContent(
      "Add Repository",
    );
  });

  it("R1: seeds the tutorial repository when no repositories exist", async () => {
    renderWithRouter(<RepositoryList />);

    expect(screen.getByRole("heading", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Repository" })).toBeInTheDocument();
    expect(screen.getByTestId("add-repository-button")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Circuit Tutorial/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tutorial-start-hint")).toHaveTextContent("Start here");
    expect(screen.getByRole("link", { name: /Circuit Tutorial/ })).toHaveAttribute(
      "title",
      "Start here: open this tutorial repository and run the starter flow.",
    );
  });

  it("R1b: ignores an abandoned tutorial seed after unmount", async () => {
    const pendingTutorial = createDeferred<string>();
    bridgeMock.createTutorialRepository.mockReturnValueOnce(
      pendingTutorial.promise,
    );

    const { unmount } = renderWithRouter(<RepositoryList />);
    await waitFor(() =>
      expect(bridgeMock.createTutorialRepository).toHaveBeenCalled(),
    );

    unmount();
    useRepositoryStore.setState({
      repositories: [],
      selectedId: null,
      hydrated: true,
    });
    pendingTutorial.resolve("/Users/me/Circuit Tutorial");
    await pendingTutorial.promise;
    await Promise.resolve();

    expect(useRepositoryStore.getState().repositories).toEqual([]);
    expect(bridgeMock.saveRepositories).not.toHaveBeenCalled();
  });

  it("R2: clicking Add invokes folder picker and renders selected folder", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-tutorial",
          name: "Circuit Tutorial",
          path: "/Users/me/Circuit Tutorial",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce("/Users/me/projects/alpha");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByTestId("add-repository-button"));

    expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled();

    const item = await screen.findByText("alpha");
    expect(item).toBeInTheDocument();
    expect(screen.getByText("/Users/me/projects/alpha")).toBeInTheDocument();
    expect(screen.getByTestId("repository-list")).toBeInTheDocument();
    const added = useRepositoryStore
      .getState()
      .repositories.find((repo) => repo.name === "alpha");
    expect(added && consumeStarterFlowPrompt(added.id)).toBe(true);
  });

  it("clicking the primary Add Repository action uses the existing add flow", async () => {
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
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce("/Users/me/projects/beta");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByTestId("add-repository-button"));

    expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled();
    expect(await screen.findByText("beta")).toBeInTheDocument();
    expect(screen.getByText("/Users/me/projects/beta")).toBeInTheDocument();
  });

  it("R3: cancelling the picker leaves the seeded tutorial repo intact", async () => {
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce(null);
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    expect(
      await screen.findByRole("link", { name: /Circuit Tutorial/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("add-repository-button"));

    await waitFor(() => expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled());
    expect(screen.getAllByRole("link", { name: /Circuit Tutorial/ })).toHaveLength(1);
    expect(screen.getByTestId("repository-list-add-button")).toBeInTheDocument();
  });

  it("R3b: seeded tutorial repo saves a starter draft without a hidden tutorial task", async () => {
    renderWithRouter(<RepositoryList />);

    expect(bridgeMock.createTutorialRepository).toHaveBeenCalled();
    const item = await screen.findByRole("link", { name: /Circuit Tutorial/ });
    expect(item).toBeInTheDocument();
    expect(screen.getByText("/Users/me/Circuit Tutorial")).toBeInTheDocument();

    const repo = useRepositoryStore.getState().repositories[0];
    const rawDraft = window.localStorage.getItem(`circuit.workflowDraft.${repo.id}`);
    expect(rawDraft).toBeTruthy();
    const draft = JSON.parse(rawDraft ?? "{}");
    expect(draft.workflowName).toBe("Tutorial starter flow");
    expect(draft.nodes.every((node: { data: { input?: unknown } }) => !node.data.input)).toBe(
      true,
    );
    expect(draft.nodes.map((node: { id: string }) => node.id)).toEqual([
      "starter_boarding",
      "starter_taxiing",
      "starter_review_and_fix",
      "starter_wrap_up",
    ]);
    expect(draft.nodes[2].data.skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/review-and-fix/SKILL.md",
    });
    expect(draft.nodes[3].data.skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/wrap-up/SKILL.md",
    });
  });

  it("R3c: pre-seeded tutorial repo is prepared again and legacy starter draft is migrated", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "id-tutorial",
          name: "Circuit Tutorial",
          path: "/Users/me/Circuit Tutorial",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hydrated: true,
    });
    window.localStorage.setItem(
      "circuit.workflowDraft.id-tutorial",
      JSON.stringify({
        version: 1,
        repositoryId: "id-tutorial",
        workflowId: "codex-starter-issue-lifecycle",
        workflowName: "Tutorial starter flow",
        nodes: [
          {
            id: "starter_boarding",
            data: {
              input: {
                arguments:
                  "Create hello_world.html with a friendly Hello from Circuit page.",
              },
              skillRef: {
                source: "default",
                provider: "codex",
                skillFile: ".codex/skills/planning/SKILL.md",
              },
            },
          },
          {
            id: "starter_review_and_fix",
            data: {
              skillRef: {
                source: "default",
                provider: "codex",
                skillFile: ".codex/skills/review-changes/SKILL.md",
              },
            },
          },
          {
            id: "starter_wrap_up",
            data: {
              skillRef: {
                source: "default",
                provider: "codex",
                skillFile: ".codex/skills/wrap-up/SKILL.md",
              },
            },
          },
        ],
        edges: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    renderWithRouter(<RepositoryList />);

    await waitFor(() =>
      expect(bridgeMock.createTutorialRepository).toHaveBeenCalled(),
    );
    expect(screen.getByRole("link", { name: /Circuit Tutorial/ })).toBeInTheDocument();
    const rawDraft = window.localStorage.getItem("circuit.workflowDraft.id-tutorial");
    const draft = JSON.parse(rawDraft ?? "{}");
    expect(draft.nodes[2].data.skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/review-and-fix/SKILL.md",
    });
    expect(draft.nodes[3].data.skillRef).toEqual({
      source: "default",
      provider: "claude",
      skillFile: ".claude/skills/wrap-up/SKILL.md",
    });
    expect(draft.nodes.every((node: { data: { input?: unknown } }) => !node.data.input)).toBe(
      true,
    );
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

  it("R4a: renders an add button at the bottom of a populated repository list", () => {
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

    const items = screen.getAllByRole("listitem");
    expect(screen.getByTestId("repository-list-add-button")).toHaveTextContent("+");
    expect(items[items.length - 1]).toContainElement(
      screen.getByTestId("repository-list-add-button"),
    );
  });

  it("R4c: clicking the bottom add button uses the existing add flow", async () => {
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
    bridgeMock.openRepositoryDialog.mockResolvedValueOnce("/Users/me/projects/beta");
    const user = userEvent.setup();

    renderWithRouter(<RepositoryList />);
    await user.click(screen.getByTestId("repository-list-add-button"));

    expect(bridgeMock.openRepositoryDialog).toHaveBeenCalled();
    expect(await screen.findByText("beta")).toBeInTheDocument();
    expect(screen.getByText("/Users/me/projects/beta")).toBeInTheDocument();
    await waitFor(() =>
      expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/Users/me/projects/beta"),
    );
  });

  it("R4b: marks the repository that owns the active run", () => {
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
    useRunStore.getState().beginRun({
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Deploy",
      repository: { id: "id-alpha", name: "alpha" },
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:00.000Z",
    });

    renderWithRouter(<RepositoryList />);

    expect(screen.queryByTestId("repository-run-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-running")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-in-progress")).toHaveAccessibleName(
      "In progress",
    );
    expect(screen.getByTestId("badge-in-progress")).toHaveAttribute(
      "title",
      "Deploy",
    );
    expect(screen.getByRole("link", { name: /alpha/ })).toHaveAccessibleName(
      /In progress/,
    );
    expect(screen.getByRole("link", { name: /beta/ })).not.toHaveTextContent(
      "In progress",
    );
  });

  it("shows progress badges for multiple running repositories", () => {
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
    useRunStore.getState().beginRun({
      runId: "run-alpha",
      workflowId: "wf-alpha",
      workflowName: "Alpha flow",
      repository: { id: "id-alpha", name: "alpha" },
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:00.000Z",
    });
    useRunStore.getState().beginRun({
      runId: "run-beta",
      workflowId: "wf-beta",
      workflowName: "Beta flow",
      repository: { id: "id-beta", name: "beta" },
      nodeIds: ["node-1"],
      startedAt: "2026-05-09T00:00:01.000Z",
    });

    renderWithRouter(<RepositoryList />);

    expect(screen.getAllByTestId("badge-in-progress")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /alpha/ })).toHaveAccessibleName(
      /In progress/,
    );
    expect(screen.getByRole("link", { name: /beta/ })).toHaveAccessibleName(
      /In progress/,
    );
  });

  it("R4c: keeps a Done pill for an unacknowledged successful run", () => {
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
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Deploy",
      repositoryId: "id-alpha",
      repositoryName: "alpha",
      startedAt: "2026-05-09T00:00:00.000Z",
      finishedAt: "2026-05-09T00:00:05.000Z",
      activeNodeId: null,
      nodeStates: { "node-1": "success" },
      nodeDebug: {},
      snapshot: null,
    });

    renderWithRouter(<RepositoryList />);

    expect(screen.getByTestId("badge-done")).toHaveTextContent("Done");
    expect(screen.getByRole("link", { name: /alpha/ })).toHaveTextContent(
      "Done",
    );

    act(() => {
      useRunStore.getState().acknowledgeRun("run-1");
    });

    expect(screen.queryByTestId("badge-done")).not.toBeInTheDocument();
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

  it("R10: Remove button removes the row after in-app confirm; cancel keeps it", async () => {
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

    await user.click(screen.getByRole("button", { name: "Remove drop" }));
    expect(
      screen.getByRole("dialog", { name: "Remove repository?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("remove-repository-cancel"));
    expect(useRepositoryStore.getState().repositories).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Remove drop" }));
    await user.click(screen.getByTestId("remove-repository-confirm"));

    await waitFor(() =>
      expect(useRepositoryStore.getState().repositories.map((r) => r.id)).toEqual(["id-keep"]),
    );
    expect(screen.queryByText("drop")).not.toBeInTheDocument();
    expect(bridgeMock.saveRepositories).toHaveBeenCalledWith(expect.any(Array));
    expect(confirmSpy).not.toHaveBeenCalled();

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
    expect(screen.queryByTestId("repository-list-add-button")).not.toBeInTheDocument();
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

    expect(screen.getAllByText("dup")).toHaveLength(1);
  });
});
