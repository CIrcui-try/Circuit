import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(),
  loadRepositories: vi.fn(),
  saveRepositories: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useSkillStore } from "./skillStore";

beforeEach(() => {
  bridgeMock.scanSkills.mockReset();
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
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
        name: "Implement Feature",
        description: "Adds features",
        inputHints: [
          {
            kind: "command",
            key: "arguments",
            placeholder: "<TASK> [--force]",
          },
        ],
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
      },
      {
        id: "codex:.codex/skills/lint",
        provider: "codex",
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
});
