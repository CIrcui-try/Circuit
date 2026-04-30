import type { DragEvent } from "react";
import { useSkillStore, type Skill } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { SKILL_DRAG_MIME } from "./Canvas";

type SidebarProps = {
  repoId?: string;
};

function dropPosition(index: number) {
  return { x: 80 + 32 * index, y: 80 + 32 * index };
}

export function Sidebar({ repoId }: SidebarProps) {
  const skills = useSkillStore((s) => (repoId ? s.byRepo[repoId] : undefined));
  const loading = useSkillStore((s) => (repoId ? s.loading[repoId] : false));
  const error = useSkillStore((s) => (repoId ? s.errors[repoId] : null));
  const addSkillNode = useWorkflowStore((s) => s.addSkillNode);

  const handleDragStart = (event: DragEvent<HTMLLIElement>, skill: Skill) => {
    event.dataTransfer.setData(
      SKILL_DRAG_MIME,
      JSON.stringify({
        provider: skill.provider,
        skillFile: skill.skillFile,
        name: skill.name,
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleAdd = (skill: Skill) => {
    const count = useWorkflowStore.getState().nodes.length;
    addSkillNode(skill, dropPosition(count));
  };

  return (
    <aside className="workspace__sidebar">
      <div className="panel-header">Skills</div>

      {!repoId ? (
        <div className="empty-state">No repository selected.</div>
      ) : loading && !skills ? (
        <div className="empty-state">Scanning repository…</div>
      ) : !skills || skills.length === 0 ? (
        <div className="empty-state" data-testid="skill-list-empty">
          No skills found in <code>.claude/skills</code> or <code>.codex/skills</code>.
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
    </aside>
  );
}
