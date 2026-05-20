import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Plus } from "lucide-react";
import { generateSkillDraft } from "../../skills/generateSkillDraft";
import type { RuntimeBridge } from "../../runtime/bridge/RuntimeBridge";
import { useRepositoryStore } from "../../stores/repositoryStore";
import {
  useSkillStore,
  type Skill,
  type SkillProvider,
} from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { HoverTooltip } from "../HoverTooltip";
import { SKILL_DRAG_MIME } from "./Canvas";
import {
  SkillNodeMenu,
  type SkillNodeMenuItem,
} from "../canvas/SkillNodeMenu";
import { defaultSkillFileForLegacySystemId } from "../../skills/defaultSkillFiles";

type SidebarProps = {
  repoId?: string;
  onCollapse?: () => void;
};

const MODEL_OPTIONS_BY_PROVIDER: Record<SkillProvider, string[]> = {
  claude: ["sonnet", "opus"],
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
};

type MenuState = { x: number; y: number; skill: Skill };
type CreateForm = {
  provider: SkillProvider;
  name: string;
  description: string;
  slug: string;
  argumentHint: string;
  defaultPrompt: string;
  defaultModel: string;
};
type CreateFieldErrors = Partial<Record<"name" | "slug", string>>;

const EMPTY_CREATE_FORM: CreateForm = {
  provider: "codex",
  name: "",
  description: "",
  slug: "",
  argumentHint: "",
  defaultPrompt: "",
  defaultModel: "",
};

function dropPosition(index: number) {
  return { x: 80 + 280 * index, y: 80 + 80 * index };
}

function joinPath(base: string, rel: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedRel = rel.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedRel}`;
}

function resolveSkillFilePath(
  skill: Skill,
  repoPath: string | null,
  defaultSkills: Skill[],
): string | null {
  if (skill.source === "default") {
    return (
      skill.skillFileAbsPath ??
      defaultSkills.find((candidate) => candidate.skillFile === skill.skillFile)
        ?.skillFileAbsPath ??
      null
    );
  }
  if (skill.source === "system") {
    const defaultSkillFile = defaultSkillFileForLegacySystemId(skill.systemSkillId);
    return (
      defaultSkills.find((candidate) => candidate.skillFile === defaultSkillFile)
        ?.skillFileAbsPath ?? null
    );
  }
  return repoPath && skill.skillFile ? joinPath(repoPath, skill.skillFile) : null;
}

export function Sidebar({ repoId, onCollapse }: SidebarProps) {
  const skills = useSkillStore((s) => (repoId ? s.byRepo[repoId] : undefined));
  const defaultSkills = useSkillStore((s) => s.defaultSkills);
  const loading = useSkillStore((s) => (repoId ? s.loading[repoId] : false));
  const creating = useSkillStore((s) => (repoId ? s.creating[repoId] : false));
  const defaultLoading = useSkillStore((s) => s.loading.default ?? false);
  const error = useSkillStore((s) => (repoId ? s.errors[repoId] : null));
  const defaultError = useSkillStore((s) => s.errors.default ?? null);
  const createRepositorySkill = useSkillStore((s) => s.createRepositorySkill);
  const addSkillNode = useWorkflowStore((s) => s.addSkillNode);
  const repoPath = useRepositoryStore((s) =>
    repoId ? s.repositories.find((r) => r.id === repoId)?.path ?? null : null,
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [defaultCollapsed, setDefaultCollapsed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [draftPromptOpen, setDraftPromptOpen] = useState(true);
  const [draftGenerated, setDraftGenerated] = useState(false);
  const [draftGoal, setDraftGoal] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [fieldErrors, setFieldErrors] = useState<CreateFieldErrors>({});
  const [draftError, setDraftError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [pendingDraftExitConfirm, setPendingDraftExitConfirm] = useState(false);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeDraftRunRef = useRef<{
    runId: string;
    bridge: RuntimeBridge;
  } | null>(null);
  const cancelledDraftRunIdsRef = useRef(new Set<string>());

  const handleDragStart = (event: DragEvent<HTMLLIElement>, skill: Skill) => {
    event.dataTransfer.setData(
      SKILL_DRAG_MIME,
      JSON.stringify({
        provider: skill.provider,
        source: skill.source ?? "repository",
        skillFile: skill.skillFile,
        skillFileAbsPath: skill.skillFileAbsPath,
        systemSkillId: skill.systemSkillId,
        name: skill.name,
        description: skill.description,
        inputHints: skill.inputHints ?? [],
        defaultInput: skill.defaultInput,
        defaultModel: skill.defaultModel,
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleAdd = (skill: Skill) => {
    const count = useWorkflowStore.getState().nodes.length;
    addSkillNode(skill, dropPosition(count));
  };

  const openCreatePanel = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setFieldErrors({});
    setDraftError(null);
    setCreateError(null);
    setCreateSuccess(null);
    setManualOpen(false);
    setDraftPromptOpen(true);
    setDraftGenerated(false);
    setDraftGoal("");
    setPendingDraftExitConfirm(false);
    activeDraftRunRef.current = null;
    cancelledDraftRunIdsRef.current.clear();
    setCreateOpen(true);
    window.setTimeout(() => draftInputRef.current?.focus(), 0);
  };

  const requestCloseCreatePanel = () => {
    if (creating) return;
    if (generatingDraft) {
      setPendingDraftExitConfirm(true);
      return;
    }
    setCreateOpen(false);
  };

  const confirmDraftExit = async () => {
    const activeRun = activeDraftRunRef.current;
    setPendingDraftExitConfirm(false);
    if (!activeRun) {
      setCreateOpen(false);
      return;
    }
    cancelledDraftRunIdsRef.current.add(activeRun.runId);
    try {
      await activeRun.bridge.cancel(activeRun.runId);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateDraft = async () => {
    if (!repoPath) return;
    const runId = `skill-draft-${Date.now()}`;
    setDraftError(null);
    setCreateError(null);
    setCreateSuccess(null);
    setFieldErrors({});
    setGeneratingDraft(true);
    try {
      const draft = await generateSkillDraft({
        goal: draftGoal,
        preferredProvider: createForm.provider,
        repoPath,
        runId,
        onRunStart: (nextRunId, bridge) => {
          activeDraftRunRef.current = { runId: nextRunId, bridge };
        },
        isRunCancelled: (nextRunId) =>
          cancelledDraftRunIdsRef.current.has(nextRunId),
      });
      if (activeDraftRunRef.current?.runId !== runId) return;
      setCreateForm(draft);
      setManualOpen(true);
      setDraftPromptOpen(false);
      setDraftGenerated(true);
      setCreateSuccess("Draft ready. Review it, then create the skill.");
    } catch (err) {
      if (cancelledDraftRunIdsRef.current.has(runId)) {
        setCreateOpen(false);
        setDraftError(null);
        setCreateError(null);
        setCreateSuccess(null);
        return;
      }
      if (activeDraftRunRef.current?.runId !== runId) return;
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeDraftRunRef.current?.runId === runId) {
        activeDraftRunRef.current = null;
        cancelledDraftRunIdsRef.current.delete(runId);
        setGeneratingDraft(false);
      }
    }
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repoId || !repoPath) return;

    const validation = validateCreateForm(createForm);
    setFieldErrors(validation);
    setCreateError(null);
    setDraftError(null);
    setCreateSuccess(null);
    if (Object.keys(validation).length > 0) return;

    try {
      await createRepositorySkill(repoId, repoPath, {
        provider: createForm.provider,
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        slug: createForm.slug.trim(),
        argumentHint: createForm.argumentHint.trim(),
        defaultPrompt: createForm.defaultPrompt.trim(),
        defaultModel: createForm.defaultModel.trim(),
      });
      setCreateForm(EMPTY_CREATE_FORM);
      setDraftGoal("");
      setManualOpen(false);
      setDraftPromptOpen(true);
      setDraftGenerated(false);
      setCreateSuccess(null);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const buildMenuItems = (skill: Skill): SkillNodeMenuItem[] => {
    const absSkillFile = resolveSkillFilePath(skill, repoPath, defaultSkills);
    return [
      {
        label: "Show in Finder",
        disabled: !absSkillFile,
        onSelect: () => {
          if (!absSkillFile) return;
          revealItemInDir(absSkillFile).catch((err) => {
            console.error("[Sidebar] revealItemInDir failed:", err);
          });
        },
      },
      {
        label: "Open SKILL.md",
        disabled: !absSkillFile,
        onSelect: () => {
          if (!absSkillFile) return;
          // 1차: OS default 앱. macOS LaunchServices 가 .md 에 핸들러 없을 때
          //      reject 가능 → 2차로 TextEdit (macOS 기본 내장) 으로 재시도.
          openPath(absSkillFile).catch((err) => {
            console.error(
              `[Sidebar] openPath(default) failed for ${absSkillFile}:`,
              err,
            );
            openPath(absSkillFile, "TextEdit").catch((err2) => {
              console.error(
                `[Sidebar] openPath(TextEdit) also failed for ${absSkillFile}:`,
                err2,
              );
            });
          });
        },
      },
    ];
  };

  const createBusy = creating || generatingDraft;
  const createPanel = repoId ? (
    <form
      className="modal__panel skill-create-modal"
      role="dialog"
      aria-modal="true"
      aria-label="New skill"
      data-testid="skill-create-panel"
      onSubmit={(event) => void handleCreateSubmit(event)}
    >
      <div className="skill-create-panel__header">
        <div>
          <h2 className="skill-create-panel__title">New Skill</h2>
          <p className="skill-create-panel__copy">
            Describe what you want to do. Circuit will make the skill for you 🤖
          </p>
        </div>
        <button
          type="button"
          className="skill-create-panel__hide"
          onClick={requestCloseCreatePanel}
          disabled={creating}
        >
          Close
        </button>
      </div>

      {draftPromptOpen ? (
        <>
          <label className="skill-create-modal__field">
            <span>What do you want?</span>
            <textarea
              ref={draftInputRef}
              value={draftGoal}
              disabled={createBusy}
              rows={5}
              data-testid="skill-draft-goal"
              placeholder="Just describe the skill you want. For example: review an iOS SDK release config and catch missing version bumps."
              onChange={(event) => setDraftGoal(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="skill-create-panel__generate"
            data-testid="skill-draft-generate"
            disabled={createBusy || !repoPath}
            onClick={() => void handleGenerateDraft()}
          >
            {generatingDraft ? (
              <>
                <span
                  className="cli-status-spinner cli-status-spinner--inline"
                  data-testid="skill-draft-spinner"
                  aria-hidden="true"
                />
                <span>Generating...</span>
              </>
            ) : (
              "Generate draft"
            )}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="skill-create-panel__edit-prompt"
          data-testid="skill-draft-edit-prompt"
          disabled={createBusy}
          onClick={() => {
            setDraftPromptOpen(true);
            window.setTimeout(() => draftInputRef.current?.focus(), 0);
          }}
        >
          Edit prompt
        </button>
      )}

      {draftError ? (
        <div className="skill-create-modal__error" role="alert">
          {draftError}
        </div>
      ) : null}

      <details
        className="skill-create-panel__manual"
        open={manualOpen}
        onToggle={(event) => setManualOpen(event.currentTarget.open)}
      >
        <summary>{draftGenerated ? "Review generated skill" : "or... do it yourself"}</summary>

        <fieldset className="skill-create-modal__provider" disabled={createBusy}>
          <legend>Provider</legend>
          {(["codex", "claude"] as const).map((provider) => (
            <label
              key={provider}
              className={
                createForm.provider === provider
                  ? "skill-create-modal__provider-option skill-create-modal__provider-option--selected"
                  : "skill-create-modal__provider-option"
              }
            >
              <input
                type="radio"
                name="provider"
                value={provider}
                checked={createForm.provider === provider}
                onChange={() =>
                  setCreateForm((form) => ({
                    ...form,
                    provider,
                    defaultModel: "",
                  }))
                }
              />
              {provider}
            </label>
          ))}
        </fieldset>

        <label className="skill-create-modal__field">
          <span>Name</span>
          <input
            value={createForm.name}
            disabled={createBusy}
            placeholder="Skill name"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={
              fieldErrors.name ? "skill-create-name-error" : undefined
            }
            onChange={(event) =>
              setCreateForm((form) => ({ ...form, name: event.target.value }))
            }
          />
        </label>
        {fieldErrors.name ? (
          <div id="skill-create-name-error" className="skill-create-modal__error">
            {fieldErrors.name}
          </div>
        ) : null}

        <label className="skill-create-modal__field">
          <span>Description</span>
          <textarea
            value={createForm.description}
            disabled={createBusy}
            rows={3}
            placeholder="What this skill helps the agent do"
            onChange={(event) =>
              setCreateForm((form) => ({
                ...form,
                description: event.target.value,
              }))
            }
          />
        </label>

        <label className="skill-create-modal__field">
          <span>Slug</span>
          <input
            value={createForm.slug}
            disabled={createBusy}
            aria-invalid={Boolean(fieldErrors.slug)}
            aria-describedby={
              fieldErrors.slug ? "skill-create-slug-error" : undefined
            }
            placeholder="skill-slug"
            onChange={(event) =>
              setCreateForm((form) => ({ ...form, slug: event.target.value }))
            }
          />
        </label>
        {fieldErrors.slug ? (
          <div id="skill-create-slug-error" className="skill-create-modal__error">
            {fieldErrors.slug}
          </div>
        ) : null}

        <label className="skill-create-modal__field">
          <span>Argument format</span>
          <textarea
            value={createForm.argumentHint}
            disabled={createBusy}
            rows={2}
            placeholder="<ISSUE_ID> [--force]"
            onChange={(event) =>
              setCreateForm((form) => ({
                ...form,
                argumentHint: event.target.value,
              }))
            }
          />
        </label>

        <label className="skill-create-modal__field">
          <span>Prompt</span>
          <textarea
            value={createForm.defaultPrompt}
            disabled={createBusy}
            rows={3}
            placeholder="Default free-form prompt"
            onChange={(event) =>
              setCreateForm((form) => ({
                ...form,
                defaultPrompt: event.target.value,
              }))
            }
          />
        </label>

        <label className="skill-create-modal__field">
          <span>Model</span>
          <input
            value={createForm.defaultModel}
            disabled={createBusy}
            list={`skill-create-model-options-${createForm.provider}`}
            placeholder={modelPlaceholder(createForm.provider)}
            onChange={(event) =>
              setCreateForm((form) => ({
                ...form,
                defaultModel: event.target.value,
              }))
            }
          />
          <datalist id={`skill-create-model-options-${createForm.provider}`}>
            {MODEL_OPTIONS_BY_PROVIDER[createForm.provider].map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
      </details>

      {createError ? (
        <div className="skill-create-modal__error" role="alert">
          {createError}
        </div>
      ) : null}
      {createSuccess ? (
        <div className="skill-create-modal__success" role="status">
          {createSuccess}
        </div>
      ) : null}

      <div className="skill-create-panel__footer">
        <button
          type="submit"
          data-testid="skill-create-submit"
          disabled={createBusy || !repoPath}
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </div>
    </form>
  ) : null;

  const defaultSkillSection = repoId ? (
    <section className="skill-list__section" data-testid="default-skill-section">
      <button
        type="button"
        className="skill-list__section-toggle"
        data-testid="default-skill-section-toggle"
        aria-expanded={!defaultCollapsed}
        onClick={() => setDefaultCollapsed((collapsed) => !collapsed)}
      >
        <span className="skill-list__section-icon" aria-hidden="true">
          {defaultCollapsed ? ">" : "v"}
        </span>
        <span>Common</span>
      </button>
      {defaultCollapsed ? null : (
        <ul className="skill-list" data-testid="default-skill-list">
          {defaultLoading && defaultSkills.length === 0 ? (
            <li className="skill-list__hint">Scanning default skills...</li>
          ) : defaultSkills.length === 0 ? (
            <li className="skill-list__hint">No default skills available.</li>
          ) : (
            defaultSkills.map((skill) => (
              <li
                key={skill.id}
                className="skill-list__item"
                data-testid="default-skill-list__item"
                data-skill-id={skill.id}
                draggable
                onDragStart={(event) => handleDragStart(event, skill)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY, skill });
                }}
              >
                <div className="skill-list__row">
                  <span className="skill-list__name">{skill.name}</span>
                  <span
                    className={`skill-list__chip skill-list__chip--${skill.provider}`}
                  >
                    {skill.provider}
                  </span>
                  <button
                    type="button"
                    className="skill-list__add"
                    data-testid="default-skill-list__add"
                    aria-label={`Add ${skill.name} to canvas`}
                    onClick={() => handleAdd(skill)}
                  >
                    +
                  </button>
                </div>
                {skill.description && (
                  <HoverTooltip
                    className="skill-list__desc-wrap"
                    content={skill.description}
                    testId="skill-list-description-tooltip"
                  >
                    <div className="skill-list__desc">{skill.description}</div>
                  </HoverTooltip>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  ) : null;

  return (
    <aside className="workspace__sidebar">
      <div className="panel-header panel-header--with-actions">
        <span>Skills</span>
        <span className="panel-header__actions">
          {repoId ? (
            <button
              type="button"
              className="panel-header__button panel-header__button--icon"
              data-testid="skill-create-open"
              aria-label="Create repository skill"
              title="Create repository skill"
              disabled={!repoPath}
              onClick={openCreatePanel}
            >
              <Plus className="panel-header__icon" aria-hidden="true" />
            </button>
          ) : null}
          {onCollapse ? (
            <button
              type="button"
              className="panel-header__button"
              data-testid="skills-sidebar-collapse"
              aria-label="Hide skills sidebar"
              onClick={onCollapse}
            >
              Hide
            </button>
          ) : null}
        </span>
      </div>

      <div className="skill-list__repo-region">
        {!repoId ? (
          <div className="empty-state">No repository selected.</div>
        ) : loading && !skills ? (
          <div className="empty-state">Scanning repository…</div>
        ) : (
          <>
            {!skills || skills.length === 0 ? (
              <div
                className="empty-state skill-list__empty"
                data-testid="skill-list-empty"
              >
                <span className="skill-list__empty-text">
                  No repository skills found. Add <code>SKILL.md</code> files under{" "}
                  <code>.claude/skills/&lt;name&gt;/SKILL.md</code> or{" "}
                  <code>.codex/skills/&lt;name&gt;/SKILL.md</code>.
                </span>
                {!createOpen ? (
                  <button
                    type="button"
                    className="skill-list__create-cta"
                    data-testid="skill-create-empty"
                    onClick={openCreatePanel}
                    disabled={!repoPath}
                  >
                    <Plus className="skill-list__create-icon" aria-hidden="true" />
                    New Skill
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="skill-list" data-testid="skill-list">
                {skills.map((skill) => (
                  <li
                    key={skill.id}
                    className="skill-list__item"
                    data-testid="skill-list__item"
                    data-skill-id={skill.id}
                    draggable
                    onDragStart={(event) => handleDragStart(event, skill)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ x: event.clientX, y: event.clientY, skill });
                    }}
                  >
                    <div className="skill-list__row">
                      <span className="skill-list__name">{skill.name}</span>
                      <span
                        className={`skill-list__chip skill-list__chip--${skill.provider}`}
                      >
                        {skill.provider}
                      </span>
                      <button
                        type="button"
                        className="skill-list__add"
                        data-testid="skill-list__add"
                        aria-label={`Add ${skill.name} to canvas`}
                        onClick={() => handleAdd(skill)}
                      >
                        +
                      </button>
                    </div>
                    {skill.description && (
                      <HoverTooltip
                        className="skill-list__desc-wrap"
                        content={skill.description}
                        testId="skill-list-description-tooltip"
                      >
                        <div className="skill-list__desc">{skill.description}</div>
                      </HoverTooltip>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {defaultSkillSection}

      {error && <div className="skill-list__error">{error}</div>}
      {defaultError && <div className="skill-list__error">{defaultError}</div>}

      {menu && (
        <SkillNodeMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.skill)}
          onClose={() => setMenu(null)}
        />
      )}

      {createOpen ? (
        <div
          className="modal__backdrop"
          data-testid="skill-create-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestCloseCreatePanel();
            }
          }}
        >
          {createPanel}
        </div>
      ) : null}
      {pendingDraftExitConfirm ? (
        <div className="modal__backdrop">
          <div
            className="modal__panel modal__panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-draft-exit-title"
            data-testid="skill-draft-exit-confirm"
          >
            <h2 id="skill-draft-exit-title" className="modal__title">
              Skill generation in progress
            </h2>
            <p className="modal__message">Do you want to stop generating?</p>
            <div className="modal__footer">
              <button
                type="button"
                onClick={() => setPendingDraftExitConfirm(false)}
                data-testid="skill-draft-exit-continue"
              >
                Keep generating
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => void confirmDraftExit()}
                data-testid="skill-draft-exit-confirm-exit"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function modelPlaceholder(provider: SkillProvider): string {
  if (provider === "claude") return "sonnet, opus, or full model name";
  return "Codex model name";
}

function validateCreateForm(form: CreateForm): CreateFieldErrors {
  const errors: CreateFieldErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required.";
  }
  const slug = form.slug.trim();
  if (!slug) {
    errors.slug = "Slug is required.";
  } else if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    errors.slug = "Slug may only contain letters, numbers, hyphens, or underscores.";
  }
  return errors;
}
