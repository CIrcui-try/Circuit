import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMock.invoke,
}));

import { useSkillStore } from "./skillStore";

beforeEach(() => {
  tauriCoreMock.invoke.mockReset();
  useSkillStore.setState({ byRepo: {}, loading: {}, errors: {} });
});

describe("skillStore — scanRepository", () => {
  it("S1: maps RawSkill array into Skill list with deterministic id", async () => {
    tauriCoreMock.invoke.mockResolvedValueOnce([
      {
        provider: "claude",
        dirName: "implement-feature",
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
        content: "---\nname: Implement Feature\ndescription: Adds features\n---\n",
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

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("scan_skills", {
      repoPath: "/path/to/repo",
    });

    const skills = useSkillStore.getState().byRepo["repo-1"];
    expect(skills).toEqual([
      {
        id: "claude:.claude/skills/implement-feature",
        provider: "claude",
        name: "Implement Feature",
        description: "Adds features",
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
      },
      {
        id: "codex:.codex/skills/lint",
        provider: "codex",
        name: "Lint",
        description: "",
        rootDir: ".codex/skills/lint",
        skillFile: ".codex/skills/lint/SKILL.md",
      },
    ]);
    expect(useSkillStore.getState().loading["repo-1"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-1"]).toBeNull();
  });

  it("S2: surfaces error message when invoke rejects", async () => {
    tauriCoreMock.invoke.mockRejectedValueOnce(new Error("repository path does not exist"));

    await useSkillStore.getState().scanRepository("repo-x", "/missing");

    expect(useSkillStore.getState().byRepo["repo-x"]).toBeUndefined();
    expect(useSkillStore.getState().loading["repo-x"]).toBe(false);
    expect(useSkillStore.getState().errors["repo-x"]).toBe(
      "repository path does not exist",
    );
  });

  it("S3: dedupes concurrent scans for the same repoId", async () => {
    let resolve: (v: unknown) => void = () => {};
    tauriCoreMock.invoke.mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );

    const a = useSkillStore.getState().scanRepository("repo-c", "/p");
    const b = useSkillStore.getState().scanRepository("repo-c", "/p");

    expect(useSkillStore.getState().loading["repo-c"]).toBe(true);
    resolve([]);
    await Promise.all([a, b]);

    expect(tauriCoreMock.invoke).toHaveBeenCalledTimes(1);
    expect(useSkillStore.getState().byRepo["repo-c"]).toEqual([]);
  });

  it("S4: stringifies non-Error rejection values", async () => {
    tauriCoreMock.invoke.mockRejectedValueOnce("plain string error");

    await useSkillStore.getState().scanRepository("repo-s", "/p");

    expect(useSkillStore.getState().errors["repo-s"]).toBe("plain string error");
  });
});
