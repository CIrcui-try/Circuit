import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockRuntimeBridge } from "../../runtime/bridge/RuntimeBridge.mock";

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => ({
    openRepositoryDialog: vi.fn(),
    scanSkills: vi.fn(async () => []),
    createRepositorySkill: vi.fn(),
    deleteRepositorySkill: vi.fn(),
    loadRepositories: vi.fn(async () => null),
    saveRepositories: vi.fn(async () => {}),
  }),
}));

import { useRepositoryStore } from "../../stores/repositoryStore";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { Sidebar } from "./Sidebar";

beforeEach(() => {
  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: false,
  });
  useSkillStore.setState({
    byRepo: {},
    defaultSkills: [],
    systemSkills: [],
    loading: {},
    creating: {},
    deleting: {},
    errors: {},
  });
  useWorkflowStore.getState().resetWorkflow();
});

describe("Sidebar", () => {
  it("SB1: shows empty state when no repository is selected", () => {
    render(<Sidebar />);
    expect(screen.getByText(/No repository selected/i)).toBeInTheDocument();
  });

  it("SB2: shows scanning state while loading and no skills yet", () => {
    useSkillStore.setState({
      byRepo: {},
      loading: { r1: true },
      errors: {},
    });
    render(<Sidebar repoId="r1" />);
    expect(screen.getByText(/Scanning repository/i)).toBeInTheDocument();
  });

  it("SB3: shows empty hint when scan returns zero skills", () => {
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    render(<Sidebar repoId="r1" />);
    expect(screen.getByText(/No repository skills found/i)).toBeInTheDocument();
    expect(screen.getByTestId("skill-list-empty")).toBeInTheDocument();
    expect(screen.getByTestId("skill-list-empty")).toHaveTextContent(
      ".claude/skills/<name>/SKILL.md",
    );
    expect(screen.getByTestId("skill-list-empty")).toHaveTextContent(
      ".codex/skills/<name>/SKILL.md",
    );
  });

  it("SB4: renders skills with name, description, provider chip, and skill-list__item testid", () => {
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "claude:.claude/skills/foo",
            provider: "claude",
            name: "Foo Skill",
            description: "Foo does foo",
            rootDir: ".claude/skills/foo",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
          {
            id: "codex:.codex/skills/bar",
            provider: "codex",
            name: "Bar Skill",
            description: "",
            rootDir: ".codex/skills/bar",
            skillFile: ".codex/skills/bar/SKILL.md",
          },
        ],
      },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);

    expect(screen.getByTestId("skill-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("skill-list__item")).toHaveLength(2);
    expect(screen.getByText("Foo Skill")).toBeInTheDocument();
    expect(screen.getByText("Bar Skill")).toBeInTheDocument();
    expect(screen.getByText("Foo does foo")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
  });

  it("SB4b: shows sidebar skill descriptions in a hover tooltip", async () => {
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "claude:.claude/skills/foo",
            provider: "claude",
            name: "Foo Skill",
            description: "Foo does foo",
            rootDir: ".claude/skills/foo",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
        ],
      },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);

    expect(screen.queryByTestId("skill-list-description-tooltip")).not.toBeInTheDocument();

    await userEvent.hover(screen.getByText("Foo does foo"));

    const tooltip = screen.getByTestId("skill-list-description-tooltip");
    expect(tooltip).toHaveClass("hover-tooltip");
    expect(tooltip).toHaveTextContent("Foo does foo");
  });

  it("SB5: shows error footer when scan failed", () => {
    useSkillStore.setState({
      byRepo: {},
      loading: { r1: false },
      errors: { r1: "repository path does not exist" },
    });

    render(<Sidebar repoId="r1" />);
    expect(screen.getByText(/repository path does not exist/)).toBeInTheDocument();
  });

  it("SB6: clicking the + button on a skill adds a node to the workflow store", async () => {
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "claude:.claude/skills/foo",
            provider: "claude",
            name: "Foo Skill",
            description: "",
            rootDir: ".claude/skills/foo",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
        ],
      },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);
    const addButton = screen.getByRole("button", { name: /Add Foo Skill to canvas/i });
    await userEvent.click(addButton);

    const { nodes } = useWorkflowStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.label).toBe("Foo Skill");
    expect(nodes[0].data.skillRef).toEqual({
      source: "repository",
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
  });

  it("SB7: clicking the header button requests sidebar collapse", async () => {
    const onCollapse = vi.fn();

    render(<Sidebar onCollapse={onCollapse} />);
    await userEvent.click(screen.getByRole("button", { name: /Hide skills sidebar/i }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("SB8: renders foldable starter skills in the common section", async () => {
    useSkillStore.setState({
      byRepo: { r1: [] },
      defaultSkills: [
        {
          id: "claude:starter/taxiing",
          provider: "claude",
          source: "default",
          name: "implement-plan",
          description: "Implement the plan",
          rootDir: "",
          skillFile: ".claude/skills/implement-plan/SKILL.md",
        },
        {
          id: "codex:starter/review-and-fix",
          provider: "codex",
          source: "default",
          name: "review-changes",
          description: "Review the implementation",
          rootDir: "",
          skillFile: ".codex/skills/review-changes/SKILL.md",
        },
        {
          id: "claude:starter/takeoff",
          provider: "claude",
          source: "default",
          name: "publish-pr",
          description: "Push and open a PR",
          rootDir: "",
          skillFile: ".claude/skills/publish-pr/SKILL.md",
        },
        {
          id: "claude:starter/landing",
          provider: "claude",
          source: "default",
          name: "cleanup-merged-pr",
          description: "Clean up after merge",
          rootDir: "",
          skillFile: ".claude/skills/cleanup-merged-pr/SKILL.md",
        },
        {
          id: "codex:starter/boarding",
          provider: "codex",
          source: "default",
          name: "planning",
          description: "Plan the feature",
          rootDir: "",
          skillFile: ".codex/skills/planning/SKILL.md",
        },
      ],
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);

    expect(screen.getByTestId("default-skill-section")).toBeInTheDocument();
    expect(screen.getByText("Common")).toBeInTheDocument();
    expect(screen.getAllByTestId("default-skill-list__item")).toHaveLength(5);
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("implement-plan")).toBeInTheDocument();
    expect(screen.getByText("review-changes")).toBeInTheDocument();
    expect(screen.getByText("publish-pr")).toBeInTheDocument();
    expect(screen.getByText("cleanup-merged-pr")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("default-skill-section-toggle"));
    expect(screen.queryByText("planning")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("default-skill-section-toggle"));
    await userEvent.click(screen.getByLabelText("Add planning to canvas"));

    const { nodes } = useWorkflowStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.label).toBe("planning");
    expect(nodes[0].data.skillRef).toEqual({
      source: "default",
      provider: "codex",
      skillFile: ".codex/skills/planning/SKILL.md",
    });
  });

  it("SB9: places the common section below repository skills", () => {
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "claude:.claude/skills/foo",
            provider: "claude",
            name: "Foo Skill",
            description: "",
            rootDir: ".claude/skills/foo",
            skillFile: ".claude/skills/foo/SKILL.md",
          },
        ],
      },
      defaultSkills: [
        {
          id: "codex:starter/boarding",
          provider: "codex",
          source: "default",
          name: "planning",
          description: "Plan the feature",
          rootDir: "",
          skillFile: ".codex/skills/planning/SKILL.md",
        },
      ],
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);

    const defaultSection = screen.getByTestId("default-skill-section");
    const repositoryList = screen.getByTestId("skill-list");

    expect(
      repositoryList.compareDocumentPosition(defaultSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("SB10: shows enabled file actions for default skills", () => {
    useSkillStore.setState({
      byRepo: { r1: [] },
      defaultSkills: [
        {
          id: "codex:.codex/skills/planning",
          provider: "codex",
          source: "default",
          name: "planning",
          description: "Plan the feature",
          rootDir: ".codex/skills/planning",
          skillFile: ".codex/skills/planning/SKILL.md",
          skillFileAbsPath:
            "/Applications/Circuit.app/default-skills/.codex/skills/planning/SKILL.md",
        },
      ],
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);

    fireEvent.contextMenu(screen.getByTestId("default-skill-list__item"));

    expect(screen.getByTestId("skill-node-menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in Finder" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Open SKILL.md" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("SB11: opens repository skill creation from the header and appends the created skill", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    const createRepositorySkill = vi
      .spyOn(useSkillStore.getState(), "createRepositorySkill")
      .mockResolvedValueOnce({
        id: "codex:.codex/skills/new-skill",
        provider: "codex",
        source: "repository",
        name: "New Skill",
        description: "Creates a skill",
        rootDir: ".codex/skills/new-skill",
        skillFile: ".codex/skills/new-skill/SKILL.md",
      });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Create repository skill/i }),
    );

    const panel = screen.getByTestId("skill-create-panel");
    expect(
      screen.getByRole("dialog", { name: /New skill/i }),
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent("New Skill");
    expect(screen.getByTestId("skill-draft-goal")).toBeInTheDocument();
    await userEvent.click(screen.getByText("or... do it manually"));
    expect(screen.getByPlaceholderText("Skill name")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("What this skill helps the agent do"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("skill-slug")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("<ISSUE_ID> [--force]")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Default free-form prompt")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Codex model name")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "New Skill");
    await userEvent.type(screen.getByLabelText("Description"), "Creates a skill");
    await userEvent.type(screen.getByLabelText("Slug"), "new-skill");
    await userEvent.type(screen.getByLabelText("Argument format"), "<ISSUE_ID>");
    await userEvent.type(screen.getByLabelText("Prompt"), "Check the implementation");
    await userEvent.type(screen.getByLabelText("Model"), "gpt-5.4");
    await userEvent.click(screen.getByTestId("skill-create-submit"));

    expect(createRepositorySkill).toHaveBeenCalledWith("r1", "/Users/me/alpha", {
      provider: "codex",
      name: "New Skill",
      description: "Creates a skill",
      slug: "new-skill",
      argumentHint: "<ISSUE_ID>",
      defaultPrompt: "Check the implementation",
      defaultModel: "gpt-5.4",
    });
    const { nodes } = useWorkflowStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.label).toBe("New Skill");
    expect(nodes[0].data.skillRef).toEqual({
      source: "repository",
      provider: "codex",
      skillFile: ".codex/skills/new-skill/SKILL.md",
    });
    expect(panel).not.toBeInTheDocument();

    createRepositorySkill.mockRestore();
  });

  it("SB12: exposes the create CTA in the empty repository skill state", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));

    expect(screen.getByTestId("skill-create-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("skill-draft-goal")).toHaveFocus());
  });

  it("SB13: validates required creation fields before saving", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    const createRepositorySkill = vi.spyOn(
      useSkillStore.getState(),
      "createRepositorySkill",
    );

    render(<Sidebar repoId="r1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Create repository skill/i }),
    );
    await userEvent.click(screen.getByText("or... do it manually"));
    await userEvent.click(screen.getByTestId("skill-create-submit"));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Slug is required.")).toBeInTheDocument();
    expect(createRepositorySkill).not.toHaveBeenCalled();

    createRepositorySkill.mockRestore();
  });

  it("SB13b: validates skill slug characters before saving", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    const createRepositorySkill = vi.spyOn(
      useSkillStore.getState(),
      "createRepositorySkill",
    );

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.click(screen.getByText("or... do it manually"));
    await userEvent.type(screen.getByLabelText("Name"), "New Skill");
    await userEvent.type(screen.getByLabelText("Slug"), "../escape");
    await userEvent.click(screen.getByTestId("skill-create-submit"));

    expect(
      screen.getByText(
        "Slug may only contain letters, numbers, hyphens, or underscores.",
      ),
    ).toBeInTheDocument();
    expect(createRepositorySkill).not.toHaveBeenCalled();

    createRepositorySkill.mockRestore();
  });

  it("SB13c: resets model when switching skill provider", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.click(screen.getByText("or... do it manually"));
    await userEvent.type(screen.getByLabelText("Model"), "gpt-5.4");
    await userEvent.click(screen.getByRole("radio", { name: "claude" }));

    expect(screen.getByLabelText("Model")).toHaveValue("");
    expect(
      screen.getByPlaceholderText("sonnet, opus, or full model name"),
    ).toBeInTheDocument();
  });

  it("SB14: sends creation failures to the app alert without leaving a skill-list error", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    const createRepositorySkill = vi
      .spyOn(useSkillStore.getState(), "createRepositorySkill")
      .mockRejectedValueOnce(new Error("skill already exists"));
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");

    render(<Sidebar repoId="r1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Create repository skill/i }),
    );
    await userEvent.click(screen.getByText("or... do it manually"));
    await userEvent.type(screen.getByLabelText("Name"), "New Skill");
    await userEvent.type(screen.getByLabelText("Slug"), "new-skill");
    await userEvent.click(screen.getByTestId("skill-create-submit"));

    const appAlertEvent = dispatchEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "circuit:error") as CustomEvent<{
        title: string;
        message: string;
      }>;
    expect(appAlertEvent.detail).toMatchObject({
      title: "Create skill failed",
      message: "skill already exists",
    });
    expect(screen.queryByText("skill already exists")).not.toBeInTheDocument();

    dispatchEvent.mockRestore();
    createRepositorySkill.mockRestore();
  });

  it("SB15: generates a skill draft into the manual fields", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    window.__CIRCUIT_RUNTIME__ = createMockRuntimeBridge({
      scenario: () => [
        {
          delayMs: 20,
          event: {
            type: "stdout",
            text: JSON.stringify({
              provider: "codex",
              name: "Release Config Review",
              description: "Reviews iOS release configs before submission.",
              slug: "release-config-review",
              argumentHint: "<SDK> <VERSION>",
              defaultPrompt: "Check release config consistency.",
              defaultModel: "gpt-5.4",
            }),
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.type(
      screen.getByTestId("skill-draft-goal"),
      "리릴즈 config를 검토하는 스킬",
    );
    await userEvent.click(screen.getByTestId("skill-draft-generate"));
    expect(screen.getByTestId("skill-draft-generate")).toBeDisabled();
    expect(screen.getByTestId("skill-draft-spinner")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByDisplayValue("Release Config Review")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("skill-draft-goal")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-draft-edit-prompt")).toBeInTheDocument();
    expect(screen.getByText("Review generated skill")).toBeInTheDocument();
    expect(screen.getByDisplayValue("release-config-review")).toBeInTheDocument();
    expect(screen.getByDisplayValue("<SDK> <VERSION>")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Check release config consistency."),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Draft ready");
  });

  it("SB16: keeps draft generation failures visible without creating a skill", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    window.__CIRCUIT_RUNTIME__ = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "stdout", text: "not json" } },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });
    const createRepositorySkill = vi.spyOn(
      useSkillStore.getState(),
      "createRepositorySkill",
    );

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.type(screen.getByTestId("skill-draft-goal"), "make anything");
    await userEvent.click(screen.getByTestId("skill-draft-generate"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Codex returned a draft without a JSON object.",
      ),
    );
    expect(createRepositorySkill).not.toHaveBeenCalled();

    createRepositorySkill.mockRestore();
  });

  it("SB17: closes the new skill modal from the backdrop when idle", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    fireEvent.mouseDown(screen.getByTestId("skill-create-backdrop"));

    expect(screen.queryByTestId("skill-create-panel")).not.toBeInTheDocument();
  });

  it("SB18: asks before closing the new skill modal while draft generation is running", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    window.__CIRCUIT_RUNTIME__ = createMockRuntimeBridge({
      scenario: () => [
        {
          delayMs: 200,
          event: {
            type: "stdout",
            text: JSON.stringify({
              provider: "codex",
              name: "Late Draft",
              description: "Generated later.",
              slug: "late-draft",
              argumentHint: "",
              defaultPrompt: "",
              defaultModel: "",
            }),
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.type(screen.getByTestId("skill-draft-goal"), "make a draft");
    await userEvent.click(screen.getByTestId("skill-draft-generate"));
    expect(screen.getByTestId("skill-draft-spinner")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("skill-create-backdrop"));

    expect(screen.getByTestId("skill-create-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Skill generation in progress" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Do you want to stop generating?")).toBeInTheDocument();
  });

  it("SB19: continues draft generation when the exit confirmation is dismissed", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    window.__CIRCUIT_RUNTIME__ = createMockRuntimeBridge({
      scenario: () => [
        {
          delayMs: 200,
          event: {
            type: "stdout",
            text: JSON.stringify({
              provider: "codex",
              name: "Continued Draft",
              description: "Generated after continuing.",
              slug: "continued-draft",
              argumentHint: "",
              defaultPrompt: "",
              defaultModel: "",
            }),
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.type(screen.getByTestId("skill-draft-goal"), "make a draft");
    await userEvent.click(screen.getByTestId("skill-draft-generate"));
    fireEvent.mouseDown(screen.getByTestId("skill-create-backdrop"));

    await userEvent.click(screen.getByTestId("skill-draft-exit-continue"));

    expect(screen.queryByTestId("skill-draft-exit-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-create-panel")).toBeInTheDocument();
    expect(screen.getByTestId("skill-draft-spinner")).toBeInTheDocument();
  });

  it("SB20: cancels the active draft run and clears generating state after confirming exit", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: { r1: [] },
      loading: { r1: false },
      errors: {},
    });
    const runtimeBridge = createMockRuntimeBridge({
      scenario: () => [
        {
          delayMs: 200,
          event: {
            type: "stdout",
            text: JSON.stringify({
              provider: "codex",
              name: "Cancelled Draft",
              description: "Should not render.",
              slug: "cancelled-draft",
              argumentHint: "",
              defaultPrompt: "",
              defaultModel: "",
            }),
          },
        },
        { event: { type: "exited", exitCode: 0 } },
      ],
    });
    const cancel = vi.spyOn(runtimeBridge, "cancel");
    cancel.mockResolvedValueOnce(undefined);
    window.__CIRCUIT_RUNTIME__ = runtimeBridge;

    render(<Sidebar repoId="r1" />);
    await userEvent.click(screen.getByTestId("skill-create-empty"));
    await userEvent.type(screen.getByTestId("skill-draft-goal"), "make a draft");
    await userEvent.click(screen.getByTestId("skill-draft-generate"));
    fireEvent.mouseDown(screen.getByTestId("skill-create-backdrop"));

    await userEvent.click(screen.getByTestId("skill-draft-exit-confirm-exit"));

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith(expect.stringMatching(/^skill-draft-/));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("skill-create-panel")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Cancelled Draft")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("skill-create-empty"));
    expect(screen.getByTestId("skill-draft-generate")).not.toBeDisabled();
    expect(screen.queryByTestId("skill-draft-spinner")).not.toBeInTheDocument();

    cancel.mockRestore();
  });

  it("SB21: removes a repository skill from the context menu after confirmation", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "codex:.codex/skills/remove-me",
            provider: "codex",
            source: "repository",
            name: "Remove Me",
            description: "",
            rootDir: ".codex/skills/remove-me",
            skillFile: ".codex/skills/remove-me/SKILL.md",
          },
        ],
      },
      loading: { r1: false },
      errors: {},
    });
    const deleteRepositorySkill = vi
      .spyOn(useSkillStore.getState(), "deleteRepositorySkill")
      .mockResolvedValueOnce(undefined);

    render(<Sidebar repoId="r1" />);
    fireEvent.contextMenu(screen.getByTestId("skill-list__item"));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(
      screen.getByRole("dialog", { name: "Remove skill" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("skill-remove-confirm")).toHaveTextContent(
      "Remove Remove Me? This will delete .codex/skills/remove-me/SKILL.md from the repository.",
    );
    await userEvent.click(screen.getByTestId("skill-remove-confirm-remove"));

    expect(deleteRepositorySkill).toHaveBeenCalledWith("r1", "/Users/me/alpha", {
      provider: "codex",
      slug: "remove-me",
    });

    deleteRepositorySkill.mockRestore();
  });

  it("SB22: keeps the skill when remove confirmation is cancelled", async () => {
    useRepositoryStore.setState({
      repositories: [
        {
          id: "r1",
          name: "alpha",
          path: "/Users/me/alpha",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedId: "r1",
      hydrated: true,
    });
    useSkillStore.setState({
      byRepo: {
        r1: [
          {
            id: "claude:.claude/skills/keep-me",
            provider: "claude",
            source: "repository",
            name: "Keep Me",
            description: "",
            rootDir: ".claude/skills/keep-me",
            skillFile: ".claude/skills/keep-me/SKILL.md",
          },
        ],
      },
      loading: { r1: false },
      errors: {},
    });
    const deleteRepositorySkill = vi.spyOn(
      useSkillStore.getState(),
      "deleteRepositorySkill",
    );

    render(<Sidebar repoId="r1" />);
    fireEvent.contextMenu(screen.getByTestId("skill-list__item"));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByTestId("skill-remove-confirm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("skill-remove-cancel"));

    expect(screen.queryByTestId("skill-remove-confirm")).not.toBeInTheDocument();
    expect(deleteRepositorySkill).not.toHaveBeenCalled();

    deleteRepositorySkill.mockRestore();
  });
});
