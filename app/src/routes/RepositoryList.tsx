import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { notifyAppError } from "../components/AppErrorAlert";
import { CliStatusPanel } from "../components/CliStatusPanel";
import { getHostBridge } from "../host/bridge";
import { useRunStore } from "../runner/runStore";
import type { RunRecord } from "../runner/runStore";
import { useRepositoryStore } from "../stores/repositoryStore";
import { useSkillStore, type Skill } from "../stores/skillStore";
import { TUTORIAL_REPOSITORY_NAME } from "../tutorial";
import { fromWorkflow } from "../workflow/serialize";
import {
  CODEX_STARTER_FLOW_ID,
  CODEX_STARTER_FLOW_NAME,
  createCodexStarterWorkflow,
} from "../workflow/starterFlow";
import { loadWorkflowDraft, saveWorkflowDraft } from "../workflow/workflowDraft";
import { markStarterFlowPromptPending } from "../workflow/starterFlowPrompt";

type ActiveCheck = () => boolean;

export function RepositoryList() {
  const repositories = useRepositoryStore((s) => s.repositories);
  const hydrated = useRepositoryStore((s) => s.hydrated);
  const addRepository = useRepositoryStore((s) => s.addRepository);
  const removeRepository = useRepositoryStore((s) => s.removeRepository);
  const byRepo = useSkillStore((s) => s.byRepo);
  const loading = useSkillStore((s) => s.loading);
  const scanRepository = useSkillStore((s) => s.scanRepository);
  const runsByRepositoryId = useRunStore((s) => s.runsByRepositoryId);
  const runStatus = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);
  const runRepositoryId = useRunStore((s) => s.repositoryId);
  const runWorkflowName = useRunStore((s) => s.workflowName);
  const acknowledgedRunId = useRunStore((s) => s.acknowledgedRunId);
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isPreparingTutorial, setIsPreparingTutorial] = useState(false);
  const mounted = useRef(true);
  const tutorialSeedAttempted = useRef(false);
  const tutorialRepairAttempted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    for (const repo of repositories) {
      scanRepository(repo.id, repo.path);
    }
  }, [hydrated, repositories, scanRepository]);

  useEffect(() => {
    if (!hydrated) return;
    if (repositories.length > 0) return;
    if (tutorialSeedAttempted.current) return;

    tutorialSeedAttempted.current = true;
    tutorialRepairAttempted.current = true;
    setIsPreparingTutorial(true);
    void seedTutorialRepository(() => mounted.current)
      .catch((err) => {
        if (mounted.current) notifyAppError(err, "Prepare tutorial failed");
      })
      .finally(() => {
        if (mounted.current) setIsPreparingTutorial(false);
      });
  }, [hydrated, repositories.length]);

  useEffect(() => {
    if (!hydrated) return;
    if (tutorialRepairAttempted.current) return;
    const tutorialRepo = repositories.find(
      (repo) => repo.name === TUTORIAL_REPOSITORY_NAME,
    );
    if (!tutorialRepo) return;

    tutorialRepairAttempted.current = true;
    refreshTutorialStarterDraftIfNeeded(tutorialRepo.id);
    void prepareTutorialRepository().catch((err) =>
      notifyAppError(err, "Prepare tutorial failed"),
    );
  }, [hydrated, repositories]);

  async function handleAdd() {
    const selected = await getHostBridge().openRepositoryDialog();
    if (selected) {
      const added = await addRepository(selected);
      if (added) {
        markStarterFlowPromptPending(added.id);
        scanRepository(added.id, added.path);
      }
    }
  }

  function handleRefreshAll() {
    for (const repo of repositories) {
      scanRepository(repo.id, repo.path);
    }
  }

  function handleRemove(id: string, name: string) {
    setPendingRemoval({ id, name });
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    const { id } = pendingRemoval;
    setPendingRemoval(null);
    try {
      await removeRepository(id);
    } catch (err) {
      notifyAppError(err, "Remove repository failed");
    }
  }

  function runRecordForRepository(repoId: string): RepositoryRunSummary | null {
    return (
      runsByRepositoryId[repoId] ??
      (runRepositoryId === repoId
        ? {
            status: runStatus,
            runId,
            workflowName: runWorkflowName,
            acknowledgedRunId,
          }
        : null)
    );
  }

  return (
    <div className="repository-list">
      <header className="repository-list__hero">
        <div className="repository-list__hero-actions">
          <button
            type="button"
            className="repository-list__primary-action"
            onClick={handleAdd}
            data-testid="add-repository-button"
          >
            Add Repository
          </button>
          {repositories.length > 0 && (
            <button
              type="button"
              className="repository-list__secondary-action"
              onClick={handleRefreshAll}
            >
              Refresh
            </button>
          )}
        </div>
      </header>
      <CliStatusPanel />
      <section className="repository-list__section">
        <div className="repository-list__section-header">
          <div>
            <h2 className="repository-list__heading">Repositories</h2>
            <p className="repository-list__section-copy">
              Choose a repository to build, run, and review workflows.
            </p>
          </div>
          {repositories.length > 0 ? (
            <span className="repository-list__section-count">
              {repositories.length}
            </span>
          ) : null}
        </div>
      {repositories.length === 0 ? (
        <p className="repository-list__hint">
          {isPreparingTutorial ? (
            <>
              Preparing <strong>{TUTORIAL_REPOSITORY_NAME}</strong>...
            </>
          ) : (
            <>
              No repositories yet. Click <strong>Add Repository</strong> to choose a local folder.
            </>
          )}
        </p>
      ) : (
        <ul className="repository-list__items" data-testid="repository-list">
          {repositories.map((repo) => {
            const skills = byRepo[repo.id];
            const isLoading = loading[repo.id];
            const runRecord = runRecordForRepository(repo.id);
            const isRunRepo = runRecord?.status === "running";
            const isDoneRepo =
              runRecord?.status === "success" &&
              runRecord.runId != null &&
              runRecord.acknowledgedRunId !== runRecord.runId;
            const isTutorialRepo = repo.name === TUTORIAL_REPOSITORY_NAME;
            return (
              <li key={repo.id} className="repository-list__row">
                <Link
                  to={`/workspace/${repo.id}`}
                  className="repository-list__item"
                  title={
                    isTutorialRepo
                      ? "Start here: open this tutorial repository and run the starter flow."
                      : undefined
                  }
                >
                  <span className="repository-list__item-name">
                    {repo.name}
                    {isTutorialRepo ? (
                      <span
                        className="repository-list__tutorial-badge"
                        data-testid="tutorial-start-hint"
                        title="Start here: open this tutorial repository and run the starter flow."
                      >
                        Start here
                      </span>
                    ) : null}
                    {isRunRepo ? (
                      <span
                        className="repository-list__progress-badge"
                        data-testid="badge-in-progress"
                        title={runRecord?.workflowName ?? "Workflow is running"}
                        aria-label="In progress"
                      >
                        <span
                          className="repository-list__progress-spinner"
                          aria-hidden="true"
                        />
                      </span>
                    ) : null}
                    {isDoneRepo ? (
                      <span
                        className="repository-list__done-badge"
                        data-testid="badge-done"
                        title={runRecord?.workflowName ?? "Workflow completed"}
                      >
                        Done
                      </span>
                    ) : null}
                  </span>
                  <span className="repository-list__item-path">{repo.path}</span>
                  <span className="repository-list__badges">
                    <SkillBadge
                      provider="claude"
                      skills={skills}
                      loading={isLoading}
                    />
                    <SkillBadge
                      provider="codex"
                      skills={skills}
                      loading={isLoading}
                    />
                  </span>
                </Link>
                <button
                  type="button"
                  className="repository-list__remove"
                  onClick={() => handleRemove(repo.id, repo.name)}
                  aria-label={`Remove ${repo.name}`}
                  title="Remove from list"
                >
                  ×
                </button>
              </li>
            );
          })}
          <li className="repository-list__add-row">
            <button
              type="button"
              className="repository-list__add-button"
              onClick={handleAdd}
              aria-label="Add Repository"
              title="Add Repository"
              data-testid="repository-list-add-button"
            >
              +
            </button>
          </li>
        </ul>
      )}
      </section>

      {pendingRemoval ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel modal__panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-repository-title"
          >
            <h2 id="remove-repository-title" className="modal__title">
              Remove repository?
            </h2>
            <p className="modal__message">
              Remove "{pendingRemoval.name}" from the list? The folder on disk is not deleted.
            </p>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setPendingRemoval(null)}
                data-testid="remove-repository-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoval()}
                data-testid="remove-repository-confirm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type RepositoryRunSummary = Pick<
  RunRecord,
  "status" | "runId" | "workflowName" | "acknowledgedRunId"
>;

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

async function seedTutorialRepository(
  isActive: ActiveCheck = () => true,
): Promise<void> {
  const path = await prepareTutorialRepository();
  if (!isActive()) return;
  if (useRepositoryStore.getState().repositories.length > 0) return;

  const added = await useRepositoryStore.getState().addRepository(path);
  if (!isActive()) return;
  if (!added) return;

  saveTutorialStarterDraft(added.id);
  if (!isActive()) return;
  await useSkillStore.getState().scanRepository(added.id, added.path);
}

async function prepareTutorialRepository(): Promise<string> {
  const bridge = getHostBridge();
  if (!bridge.createTutorialRepository) {
    throw new Error("tutorial repository creation is not available");
  }

  return normalizePath(await bridge.createTutorialRepository());
}

function saveTutorialStarterDraft(repositoryId: string): void {
  const workflow = createCodexStarterWorkflow({
    repositoryId,
  });
  const restored = fromWorkflow(workflow);
  saveWorkflowDraft(repositoryId, {
    workflowId: restored.meta.id,
    workflowName: restored.meta.name,
    continueOnFailure: restored.meta.continueOnFailure,
    nodes: restored.nodes,
    edges: restored.edges,
  });
}

function refreshTutorialStarterDraftIfNeeded(repositoryId: string): void {
  const draft = loadWorkflowDraft(repositoryId);
  if (draft && !isOutdatedTutorialStarterDraft(draft)) return;
  saveTutorialStarterDraft(repositoryId);
}

function isOutdatedTutorialStarterDraft(
  draft: NonNullable<ReturnType<typeof loadWorkflowDraft>>,
): boolean {
  if (
    draft.workflowId !== CODEX_STARTER_FLOW_ID ||
    draft.workflowName !== CODEX_STARTER_FLOW_NAME
  ) {
    return false;
  }

  return draft.nodes.some((node) => {
    const skillRef = node.data.skillRef;
    const input = node.data.input as Record<string, unknown> | undefined;
    if (
      input?.arguments ===
        "Create hello_world.html with a friendly Hello from Circuit page." ||
      (typeof input?.prompt === "string" && input.prompt.includes("hello_world.html"))
    ) {
      return true;
    }

    if (
      node.id === "starter_review_and_fix" &&
      skillRef?.provider === "codex" &&
      skillRef?.skillFile === ".codex/skills/review-changes/SKILL.md"
    ) {
      return true;
    }

    if (
      node.id === "starter_wrap_up" &&
      skillRef?.provider === "codex" &&
      skillRef?.skillFile === ".codex/skills/wrap-up/SKILL.md"
    ) {
      return true;
    }
    return false;
  });
}

function SkillBadge({
  provider,
  skills,
  loading,
}: {
  provider: "claude" | "codex";
  skills: Skill[] | undefined;
  loading: boolean | undefined;
}) {
  const label = provider === "claude" ? "Claude" : "Codex";
  if (skills === undefined) {
    return (
      <span
        className={`repository-list__badge repository-list__badge--${provider}`}
        data-testid={`badge-${provider}`}
      >
        {label} · {loading ? "…" : "—"}
      </span>
    );
  }
  const count = skills.filter((s) => s.provider === provider).length;
  return (
    <span
      className={`repository-list__badge repository-list__badge--${provider}`}
      data-testid={`badge-${provider}`}
    >
      {label} · {count}
    </span>
  );
}
