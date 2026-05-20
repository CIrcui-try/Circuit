import { useState, type DragEvent, type FormEvent } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Plus } from "lucide-react";
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

type MenuState = { x: number; y: number; skill: Skill };
type CreateForm = {
  provider: SkillProvider;
  name: string;
  description: string;
  slug: string;
};
type CreateFieldErrors = Partial<Record<"name" | "slug", string>>;

const EMPTY_CREATE_FORM: CreateForm = {
  provider: "codex",
  name: "",
  description: "",
  slug: "",
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
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [fieldErrors, setFieldErrors] = useState<CreateFieldErrors>({});
  const [modalError, setModalError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

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
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleAdd = (skill: Skill) => {
    const count = useWorkflowStore.getState().nodes.length;
    addSkillNode(skill, dropPosition(count));
  };

  const openCreateModal = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setFieldErrors({});
    setModalError(null);
    setCreateSuccess(null);
    setCreateOpen(true);
  };

  const closeCreateModal = () => {
    if (creating) return;
    setCreateOpen(false);
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repoId || !repoPath) return;

    const validation = validateCreateForm(createForm);
    setFieldErrors(validation);
    setModalError(null);
    setCreateSuccess(null);
    if (Object.keys(validation).length > 0) return;

    try {
      const skill = await createRepositorySkill(repoId, repoPath, {
        provider: createForm.provider,
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        slug: createForm.slug.trim(),
      });
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateSuccess(`Created ${skill.name}.`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err));
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
              onClick={openCreateModal}
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
        ) : !skills || skills.length === 0 ? (
          <div
            className="empty-state skill-list__empty"
            data-testid="skill-list-empty"
          >
            <span className="skill-list__empty-text">
              No repository skills found. Add <code>SKILL.md</code> files under{" "}
              <code>.claude/skills/&lt;name&gt;/SKILL.md</code> or{" "}
              <code>.codex/skills/&lt;name&gt;/SKILL.md</code>.
            </span>
            <button
              type="button"
              className="skill-list__create-cta"
              data-testid="skill-create-empty"
              onClick={openCreateModal}
              disabled={!repoPath}
            >
              <Plus className="skill-list__create-icon" aria-hidden="true" />
              Create Skill
            </button>
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
        <div className="modal__backdrop">
          <form
            className="modal__panel skill-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-create-title"
            onSubmit={(event) => void handleCreateSubmit(event)}
          >
            <h2 id="skill-create-title" className="modal__title">
              Create repository skill
            </h2>
            <fieldset className="skill-create-modal__provider" disabled={creating}>
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
                      setCreateForm((form) => ({ ...form, provider }))
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
                disabled={creating}
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
              <div
                id="skill-create-name-error"
                className="skill-create-modal__error"
              >
                {fieldErrors.name}
              </div>
            ) : null}

            <label className="skill-create-modal__field">
              <span>Description</span>
              <textarea
                value={createForm.description}
                disabled={creating}
                rows={3}
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
                disabled={creating}
                aria-invalid={Boolean(fieldErrors.slug)}
                aria-describedby={
                  fieldErrors.slug ? "skill-create-slug-error" : undefined
                }
                placeholder="review-and-fix"
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, slug: event.target.value }))
                }
              />
            </label>
            {fieldErrors.slug ? (
              <div
                id="skill-create-slug-error"
                className="skill-create-modal__error"
              >
                {fieldErrors.slug}
              </div>
            ) : null}

            {modalError ? (
              <div className="skill-create-modal__error" role="alert">
                {modalError}
              </div>
            ) : null}
            {createSuccess ? (
              <div className="skill-create-modal__success" role="status">
                {createSuccess}
              </div>
            ) : null}

            <div className="modal__footer">
              <button type="button" onClick={closeCreateModal} disabled={creating}>
                Close
              </button>
              <button
                type="submit"
                data-testid="skill-create-submit"
                disabled={creating || !repoPath}
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </aside>
  );
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
