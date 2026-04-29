# Phase 02 – Skill Discovery

## Goal

Discover Claude/Codex skills in the selected repository and display them as a list.

## Scope

The scan target is limited to the following paths:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

Lowercase `skill.md` may be read in compatibility mode, but the official path is `SKILL.md`.

## Tasks

1. Inspect `.claude/skills` and `.codex/skills` based on the selected repository path.
2. Find `SKILL.md` in each subfolder.
3. Convert the discovered skills into Skill objects.
4. Set the provider to `claude` or `codex`.
5. Display the skill list in the left panel.
6. Use the first heading or the frontmatter (if present) of `SKILL.md` as the name/description shown in the UI.

## Out of Scope

- Full recursive scan of the repository
- Scanning global skill directories
- Editing skill.md
- Generating default skills

## Verification Checklist

- [ ] `.claude/skills/*/SKILL.md` is discovered.
- [ ] `.codex/skills/*/SKILL.md` is discovered.
- [ ] The provider is correctly distinguished.
- [ ] Arbitrary `SKILL.md` files across the repository are not picked up.
- [ ] Discovered skills are shown in the left panel.

## Required End-of-Phase Briefing

After completing a Phase, the coding agent must write a briefing in the following format.

```md
# Phase N Briefing

## Implemented
- Summarize what was implemented.

## Changed Files
- List the main files that were changed and their roles.

## Verification
- Document the checklist that was confirmed and how to run it.

## Known Limitations
- Document what has not yet been implemented and what was intentionally excluded.

## Next Recommendation
- Suggest what to do in the next Phase.
```
