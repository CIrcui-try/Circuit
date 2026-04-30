import type { Page } from "@playwright/test";

export const FIXTURE_REPO_PATH = "/fixtures/repos/sample-repo";

export async function installMockBridge(page: Page) {
  await page.addInitScript((repoPath: string) => {
    type RawSkill = {
      provider: "claude" | "codex";
      dirName: string;
      rootDir: string;
      skillFile: string;
      content: string;
    };

    type Repository = {
      id: string;
      name: string;
      path: string;
      createdAt: string;
      updatedAt: string;
    };

    const fixtureSkills: RawSkill[] = [
      {
        provider: "claude",
        dirName: "implement-feature",
        rootDir: ".claude/skills/implement-feature",
        skillFile: ".claude/skills/implement-feature/SKILL.md",
        content:
          "---\nname: Implement Feature\ndescription: Drive an end-to-end feature implementation with sensible defaults and tests.\n---\n",
      },
      {
        provider: "codex",
        dirName: "review-code",
        rootDir: ".codex/skills/review-code",
        skillFile: ".codex/skills/review-code/SKILL.md",
        content:
          "---\nname: Review Code\ndescription: Run a structured code review across staged changes.\n---\n",
      },
    ];

    let repositories: Repository[] = [];

    (window as unknown as { __CIRCUIT_BRIDGE__: unknown }).__CIRCUIT_BRIDGE__ = {
      async openRepositoryDialog() {
        return repoPath;
      },
      async scanSkills(_path: string) {
        return fixtureSkills;
      },
      async loadRepositories() {
        return repositories.length ? repositories : null;
      },
      async saveRepositories(next: Repository[]) {
        repositories = next;
      },
    };
  }, FIXTURE_REPO_PATH);
}
