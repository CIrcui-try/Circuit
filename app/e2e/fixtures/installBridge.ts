import type { Page } from "@playwright/test";

export const FIXTURE_REPO_PATH = "/fixtures/repos/sample-repo";
export const TUTORIAL_REPO_PATH = "/fixtures/repos/Circuit Tutorial";

export async function installMockBridge(page: Page) {
  await page.addInitScript(({
    repoPath,
    tutorialRepoPath,
  }: {
    repoPath: string;
    tutorialRepoPath: string;
  }) => {
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
        dirName: "boarding",
        rootDir: ".codex/skills/boarding",
        skillFile: ".codex/skills/boarding/SKILL.md",
        content:
          "---\nname: boarding\ndescription: Prepare a Linear issue before implementation.\n---\n",
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
    let runtimeScenario: "success" | "stdin-waiting" = "success";
    const spawnCalls: unknown[] = [];

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
      async createTutorialRepository() {
        return tutorialRepoPath;
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

    const listeners = new Map<string, Set<(event: unknown) => void>>();

    function emit(runId: string, raw: Record<string, unknown>) {
      const ev = {
        ...raw,
        runId,
        timestamp: new Date().toISOString(),
      };
      for (const listener of listeners.get(runId) ?? []) listener(ev);
    }

    (
      window as unknown as {
        __CIRCUIT_SET_RUNTIME_SCENARIO__?: (scenario: typeof runtimeScenario) => void;
      }
    ).__CIRCUIT_SET_RUNTIME_SCENARIO__ = (scenario) => {
      runtimeScenario = scenario;
    };
    (
      window as unknown as {
        __CIRCUIT_RUNTIME_SPAWN_CALLS__?: unknown[];
      }
    ).__CIRCUIT_RUNTIME_SPAWN_CALLS__ = spawnCalls;

    (window as unknown as { __CIRCUIT_RUNTIME__: unknown }).__CIRCUIT_RUNTIME__ = {
      async readFile(absPath: string) {
        const skill = fixtureSkills.find((s) => absPath.endsWith(s.skillFile));
        if (!skill) throw new Error(`mock file not found: ${absPath}`);
        return skill.content;
      },
      async spawn(options: { runId: string }) {
        spawnCalls.push(options);
        queueMicrotask(() => {
          emit(options.runId, { type: "started" });
          if (runtimeScenario === "stdin-waiting") {
            emit(options.runId, {
              type: "stderr",
              text: "Reading additional input from stdin...",
            });
            return;
          }
          emit(options.runId, { type: "exited", exitCode: 0 });
        });
        return { runId: options.runId };
      },
      async cancel(runId: string) {
        emit(runId, { type: "cancelled" });
      },
      async sendInput(runId: string, text: string) {
        emit(runId, { type: "stdout", text });
      },
      async closeInput(runId: string) {
        if (runtimeScenario === "stdin-waiting") {
          emit(runId, { type: "exited", exitCode: 0 });
        }
      },
      subscribe(runId: string, listener: (event: unknown) => void) {
        let set = listeners.get(runId);
        if (!set) {
          set = new Set();
          listeners.set(runId, set);
        }
        set.add(listener);
        const unsub = () => {
          const current = listeners.get(runId);
          if (!current) return;
          current.delete(listener);
          if (current.size === 0) listeners.delete(runId);
        };
        return Object.assign(unsub, { ready: Promise.resolve() });
      },
    };
  }, { repoPath: FIXTURE_REPO_PATH, tutorialRepoPath: TUTORIAL_REPO_PATH });
}
