export const DEFAULT_SKILL_FILE_BY_LEGACY_SYSTEM_ID: Record<string, string> = {
  "codex:starter/boarding": ".codex/skills/planning/SKILL.md",
  "claude:starter/taxiing": ".claude/skills/implement-plan/SKILL.md",
  "codex:starter/review-and-fix": ".codex/skills/review-changes/SKILL.md",
  "claude:starter/takeoff": ".claude/skills/publish-pr/SKILL.md",
  "claude:starter/landing": ".claude/skills/cleanup-merged-pr/SKILL.md",
};

export function defaultSkillFileForLegacySystemId(
  systemSkillId?: string,
): string | null {
  return systemSkillId
    ? DEFAULT_SKILL_FILE_BY_LEGACY_SYSTEM_ID[systemSkillId] ?? null
    : null;
}
