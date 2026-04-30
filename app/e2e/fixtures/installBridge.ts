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

    type WorkflowSummary = {
      id: string;
      name: string;
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

    const REPO_LS_KEY = "__circuit_mock_repositories__";
    const WORKFLOW_LS_KEY = "__circuit_mock_workflows__";

    function readRepositories(): Repository[] {
      try {
        const raw = window.localStorage.getItem(REPO_LS_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as Repository[];
      } catch {
        return [];
      }
    }

    function writeRepositories(repos: Repository[]) {
      window.localStorage.setItem(REPO_LS_KEY, JSON.stringify(repos));
    }

    function readWorkflows(): Record<string, Record<string, string>> {
      try {
        const raw = window.localStorage.getItem(WORKFLOW_LS_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as Record<string, Record<string, string>>;
      } catch {
        return {};
      }
    }

    function writeWorkflows(state: Record<string, Record<string, string>>) {
      window.localStorage.setItem(WORKFLOW_LS_KEY, JSON.stringify(state));
    }

    (window as unknown as { __CIRCUIT_BRIDGE__: unknown }).__CIRCUIT_BRIDGE__ = {
      async openRepositoryDialog() {
        return repoPath;
      },
      async scanSkills(_path: string) {
        return fixtureSkills;
      },
      async loadRepositories() {
        const repos = readRepositories();
        return repos.length ? repos : null;
      },
      async saveRepositories(next: Repository[]) {
        writeRepositories(next);
      },
      async listWorkflows(repoPathArg: string): Promise<WorkflowSummary[]> {
        const all = readWorkflows();
        const bucket = all[repoPathArg] ?? {};
        const summaries: WorkflowSummary[] = [];
        for (const [id, json] of Object.entries(bucket)) {
          try {
            const parsed = JSON.parse(json) as {
              id: string;
              name: string;
              updatedAt: string;
            };
            summaries.push({
              id: parsed.id ?? id,
              name: parsed.name ?? "",
              updatedAt: parsed.updatedAt ?? "",
            });
          } catch {
            // skip malformed
          }
        }
        summaries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
        return summaries;
      },
      async loadWorkflow(repoPathArg: string, workflowId: string): Promise<string> {
        const all = readWorkflows();
        const bucket = all[repoPathArg] ?? {};
        const json = bucket[workflowId];
        if (!json) throw new Error(`workflow not found: ${workflowId}`);
        return json;
      },
      async saveWorkflow(
        repoPathArg: string,
        workflowId: string,
        json: string,
      ): Promise<void> {
        const all = readWorkflows();
        const bucket = all[repoPathArg] ?? {};
        bucket[workflowId] = json;
        all[repoPathArg] = bucket;
        writeWorkflows(all);
      },
    };
  }, FIXTURE_REPO_PATH);
}
