import { useState, type DragEvent } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useSkillStore, type Skill } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { SKILL_DRAG_MIME } from "./Canvas";
import {
  SkillNodeMenu,
  type SkillNodeMenuItem,
} from "../canvas/SkillNodeMenu";

type SidebarProps = {
  repoId?: string;
  onCollapse?: () => void;
};

type MenuState = { x: number; y: number; skill: Skill };

const STARTER_SYSTEM_SKILL_IDS = [
  "codex:starter/boarding",
  "codex:starter/door-closing",
  "codex:starter/taxiing",
  "codex:starter/takeoff",
  "codex:starter/landing",
];

function dropPosition(index: number) {
  return { x: 80 + 280 * index, y: 80 + 80 * index };
}

function joinPath(base: string, rel: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedRel = rel.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedRel}`;
}

export function Sidebar({ repoId, onCollapse }: SidebarProps) {
  const skills = useSkillStore((s) => (repoId ? s.byRepo[repoId] : undefined));
  const systemSkills = useSkillStore((s) => s.systemSkills);
  const loading = useSkillStore((s) => (repoId ? s.loading[repoId] : false));
  const systemLoading = useSkillStore((s) => s.loading.system ?? false);
  const error = useSkillStore((s) => (repoId ? s.errors[repoId] : null));
  const systemError = useSkillStore((s) => s.errors.system ?? null);
  const addSkillNode = useWorkflowStore((s) => s.addSkillNode);
  const repoPath = useRepositoryStore((s) =>
    repoId ? s.repositories.find((r) => r.id === repoId)?.path ?? null : null,
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [systemCollapsed, setSystemCollapsed] = useState(false);
  const starterSystemSkills = STARTER_SYSTEM_SKILL_IDS.map((id) =>
    systemSkills.find((skill) => skill.systemSkillId === id || skill.id === id),
  ).filter((skill): skill is Skill => Boolean(skill));

  const handleDragStart = (event: DragEvent<HTMLLIElement>, skill: Skill) => {
    event.dataTransfer.setData(
      SKILL_DRAG_MIME,
      JSON.stringify({
        provider: skill.provider,
        source: skill.source ?? "repository",
        skillFile: skill.skillFile,
        systemSkillId: skill.systemSkillId,
        name: skill.name,
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleAdd = (skill: Skill) => {
    const count = useWorkflowStore.getState().nodes.length;
    addSkillNode(skill, dropPosition(count));
  };

  const buildMenuItems = (skill: Skill): SkillNodeMenuItem[] => {
    const absSkillFile =
      repoPath && skill.skillFile ? joinPath(repoPath, skill.skillFile) : null;
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

  return (
    <aside className="workspace__sidebar">
      <div className="panel-header panel-header--with-actions">
        <span>Skills</span>
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
      </div>

      {repoId ? (
        <section className="skill-list__section" data-testid="system-skill-section">
          <button
            type="button"
            className="skill-list__section-toggle"
            data-testid="system-skill-section-toggle"
            aria-expanded={!systemCollapsed}
            onClick={() => setSystemCollapsed((collapsed) => !collapsed)}
          >
            <span className="skill-list__section-icon" aria-hidden="true">
              {systemCollapsed ? ">" : "v"}
            </span>
            <span>System</span>
          </button>
          {systemCollapsed ? null : (
            <ul className="skill-list" data-testid="system-skill-list">
              {systemLoading && starterSystemSkills.length === 0 ? (
                <li className="skill-list__hint">Scanning system skills...</li>
              ) : starterSystemSkills.length === 0 ? (
                <li className="skill-list__hint">No starter skills available.</li>
              ) : (
                starterSystemSkills.map((skill) => (
                  <li
                    key={skill.id}
                    className="skill-list__item"
                    data-testid="system-skill-list__item"
                    data-skill-id={skill.id}
                    draggable
                    onDragStart={(event) => handleDragStart(event, skill)}
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
                        data-testid="system-skill-list__add"
                        aria-label={`Add ${skill.name} to canvas`}
                        onClick={() => handleAdd(skill)}
                      >
                        +
                      </button>
                    </div>
                    {skill.description && (
                      <div className="skill-list__desc">{skill.description}</div>
                    )}
                  </li>
                ))
              )}
            </ul>
          )}
        </section>
      ) : null}

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
            No skills found in <code>.claude/skills</code> or{" "}
            <code>.codex/skills</code>.
          </span>
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
                <div className="skill-list__desc">{skill.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="skill-list__error">{error}</div>}
      {systemError && <div className="skill-list__error">{systemError}</div>}

      {menu && (
        <SkillNodeMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.skill)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
