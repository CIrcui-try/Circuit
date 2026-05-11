import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
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
    expect(screen.getByText(/No skills found/i)).toBeInTheDocument();
    expect(screen.getByTestId("skill-list-empty")).toBeInTheDocument();
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
});
