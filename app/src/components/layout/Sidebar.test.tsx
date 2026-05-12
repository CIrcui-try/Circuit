import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => ({
    openRepositoryDialog: vi.fn(),
    scanSkills: vi.fn(async () => []),
    loadRepositories: vi.fn(async () => null),
    saveRepositories: vi.fn(async () => {}),
  }),
}));

import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { Sidebar } from "./Sidebar";

beforeEach(() => {
  useSkillStore.setState({ byRepo: {}, defaultSkills: [], loading: {}, errors: {} });
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
  });
});
