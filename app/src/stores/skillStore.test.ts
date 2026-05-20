import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(),
  createRepositorySkill: vi.fn(),
  scanDefaultSkills: vi.fn(),
  scanSystemSkills: vi.fn(),
  loadRepositories: vi.fn(),
  saveRepositories: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useSkillStore } from "./skillStore";

beforeEach(() => {
  bridgeMock.scanSkills.mockReset();
  bridgeMock.createRepositorySkill.mockReset();
  bridgeMock.scanDefaultSkills.mockReset();
  bridgeMock.scanSystemSkills.mockReset();
  useSkillStore.setState({
    byRepo: {},
    defaultSkills: [],
    systemSkills: [],
    loading: {},
    creating: {},
    errors: {},
  });
});

describe("skillStore — scanRepository", () => {
  it("S1: maps RawSkill array into Skill list with deterministic id", async () => {
    bridgeMock.scanSkills.mockResolvedValueOnce([
      {
        provider: "claude",
        dirName: "implement-feature",
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
        content:
          "---\nname: Implement Feature\ndescription: Adds features\n---\n\n`$ARGUMENTS` format: `<TASK> [--force]`.",
      },
      {
        provider: "codex",
        dirName: "lint",
        rootDir: ".codex/skills/lint",
        skillFile: ".codex/skills/lint/SKILL.md",
        content: "# Lint\n",
      },
    ]);

    await useSkillStore.getState().scanRepository("repo-1", "/path/to/repo");

    expect(bridgeMock.scanSkills).toHaveBeenCalledWith("/path/to/repo");

    const skills = useSkillStore.getState().byRepo["repo-1"];
    expect(skills).toEqual([
      {
        id: "claude:.claude/skills/implement-feature",
        provider: "claude",
        source: "repository",
        name: "Implement Feature",
        description: "Adds features",
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            label: "TASK",
            placeholder: "<TASK> [--force]",
          },
        ],
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
      },
      {
        id: "codex:.codex/skills/lint",
        provider: "codex",
        source: "repository",
        name: "Lint",
        description: "",
        inputHints: [],
        rootDir: ".codex/skills/lint",
        skillFile: ".codex/skills/lint/SKILL.md",
      },
    ]);
    expect(useSkillStore.getState().loading["repo-1"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-1"]).toBeNull();
  });

  it("S2: surfaces error message when bridge rejects", async () => {
    bridgeMock.scanSkills.mockRejectedValueOnce(new Error("repository path does not exist"));

    await useSkillStore.getState().scanRepository("repo-x", "/missing");

    expect(useSkillStore.getState().byRepo["repo-x"]).toBeUndefined();
    expect(useSkillStore.getState().loading["repo-x"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-x"]).toBe(
      "repository path does not exist",
    );
  });

  it("S3: dedupes concurrent scans for the same repoId", async () => {
    let resolve: (v: unknown) => void = () => {};
    bridgeMock.scanSkills.mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );

    const a = useSkillStore.getState().scanRepository("repo-c", "/p");
    const b = useSkillStore.getState().scanRepository("repo-c", "/p");

    expect(useSkillStore.getState().loading["repo-c"]).toBe(true);
    resolve([]);
    await Promise.all([a, b]);

    expect(bridgeMock.scanSkills).toHaveBeenCalledTimes(1);
    expect(useSkillStore.getState().byRepo["repo-c"]).toEqual([]);
  });

  it("S4: stringifies non-Error rejection values", async () => {
    bridgeMock.scanSkills.mockRejectedValueOnce("plain string error");

    await useSkillStore.getState().scanRepository("repo-s", "/p");

    expect(useSkillStore.getState().errors["repo-s"]).toBe("plain string error");
  });


  it("S5: maps default catalog skills through the same SKILL.md parser", async () => {
    bridgeMock.scanDefaultSkills.mockResolvedValueOnce([
      {
        provider: "codex",
        source: "default",
        dirName: "planning",
        rootDir: ".codex/skills/planning",
        skillFile: ".codex/skills/planning/SKILL.md",
        skillFileAbsPath: "/Applications/Circuit.app/default-skills/.codex/skills/planning/SKILL.md",
        content:
          "---\nname: planning\ndescription: Plan\nargument-hint: <feature request>\n---\n",
      },
    ]);

    await useSkillStore.getState().scanDefaultCatalog();

    expect(useSkillStore.getState().defaultSkills).toEqual([
      {
        id: "codex:.codex/skills/planning",
        provider: "codex",
        source: "default",
        name: "planning",
        description: "Plan",
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            label: "feature request",
            placeholder: "<feature request>",
          },
        ],
        rootDir: ".codex/skills/planning",
        skillFile: ".codex/skills/planning/SKILL.md",
        skillFileAbsPath:
          "/Applications/Circuit.app/default-skills/.codex/skills/planning/SKILL.md",
      },
    ]);
  });

  it("S6: maps system catalog skills by stable systemSkillId", async () => {
    bridgeMock.scanSystemSkills.mockResolvedValueOnce([
      {
        id: "codex:imagegen",
        provider: "codex",
        name: "imagegen",
        description: "Generate images",
        source: "system",
      },
    ]);

    await useSkillStore.getState().scanSystemCatalog();

    expect(useSkillStore.getState().systemSkills).toEqual([
      {
        id: "codex:imagegen",
        provider: "codex",
        source: "system",
        name: "imagegen",
        description: "Generate images",
        inputHints: [],
        rootDir: "",
        skillFile: "",
        systemSkillId: "codex:imagegen",
      },
    ]);
  });
});

describe("skillStore — createRepositorySkill", () => {
  it("S7: creates a repository skill and appends it to the repo cache", async () => {
    useSkillStore.setState({
      byRepo: {
        "repo-1": [
          {
            id: "claude:.claude/skills/existing",
            provider: "claude",
            source: "repository",
            name: "Existing",
            description: "",
            rootDir: ".claude/skills/existing",
            skillFile: ".claude/skills/existing/SKILL.md",
          },
        ],
      },
    });
    bridgeMock.createRepositorySkill.mockResolvedValueOnce({
      provider: "codex",
      dirName: "new-skill",
      rootDir: ".codex/skills/new-skill",
      skillFile: ".codex/skills/new-skill/SKILL.md",
      content: "---\nname: New Skill\ndescription: Creates skills\n---\n",
    });

    const created = await useSkillStore.getState().createRepositorySkill(
      "repo-1",
      "/repo",
      {
        provider: "codex",
        slug: "new-skill",
        name: "New Skill",
        description: "Creates skills",
      },
    );

    expect(bridgeMock.createRepositorySkill).toHaveBeenCalledWith("/repo", {
      provider: "codex",
      slug: "new-skill",
      name: "New Skill",
      description: "Creates skills",
    });
    expect(created.name).toBe("New Skill");
    expect(useSkillStore.getState().byRepo["repo-1"]).toHaveLength(2);
    expect(useSkillStore.getState().creating["repo-1"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-1"]).toBeNull();
  });

  it("S8: stores and rethrows creation errors", async () => {
    bridgeMock.createRepositorySkill.mockRejectedValueOnce(
      new Error("skill already exists"),
    );

    await expect(
      useSkillStore.getState().createRepositorySkill("repo-1", "/repo", {
        provider: "claude",
        slug: "existing",
        name: "Existing",
        description: "",
      }),
    ).rejects.toThrow("skill already exists");

    expect(useSkillStore.getState().creating["repo-1"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-1"]).toBe(
      "skill already exists",
    );
  });
});
