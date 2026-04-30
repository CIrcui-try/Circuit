import { useSkillStore } from "../../stores/skillStore";

type SidebarProps = {
  repoId?: string;
};

export function Sidebar({ repoId }: SidebarProps) {
  const skills = useSkillStore((s) => (repoId ? s.byRepo[repoId] : undefined));
  const loading = useSkillStore((s) => (repoId ? s.loading[repoId] : false));
  const error = useSkillStore((s) => (repoId ? s.errors[repoId] : null));

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
            <li key={skill.id} className="skill-list__item">
              <div className="skill-list__row">
                <span className="skill-list__name">{skill.name}</span>
                <span
                  className={`skill-list__chip skill-list__chip--${skill.provider}`}
                >
                  {skill.provider}
                </span>
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
