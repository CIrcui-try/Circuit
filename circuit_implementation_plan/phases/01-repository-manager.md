# Phase 01 – Repository Manager

## Goal

Allow the user to add and switch between multiple local repositories in the app.

## Scope

- Add Repository button
- macOS folder selection dialog
- Register the selected folder as a repository
- Display the list of registered repositories
- Select and switch between repositories
- Persist the repository list across app restarts

## Tasks

1. Implement folder selection using the Tauri file dialog.
2. Save the selected folder path as a repository record.
3. Build the repository list UI.
4. Manage the state of the currently selected repository.
5. Persist the repository list to a local settings file.

## Out of Scope

- Repository internal file browser
- Code editing
- Skill discovery
- Showing git status

## Verification Checklist

- [ ] A local folder can be added as a repository.
- [ ] Multiple repositories appear in the list.
- [ ] A repository can be selected and opened in the workspace.
- [ ] The repository list is preserved after restarting the app.
- [ ] No code-editor functionality is present.

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
