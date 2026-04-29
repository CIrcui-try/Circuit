# Phase 00 – Foundation

## Goal

Build the macOS desktop app skeleton based on Tauri + React + TypeScript.

## Scope

- Initialize the Tauri project
- Set up React + TypeScript
- Install React Flow
- Introduce Zustand or an equivalent state manager
- Compose the basic layout
- Arrange a left sidebar, center canvas, right panel, and bottom log area

## Tasks

1. Create a Tauri + React + TypeScript project.
2. Install React Flow and prepare it for use.
3. Build the app layout.
4. If routing is needed, split the Repository List and Workspace screens.
5. Create empty-state UI.

## Out of Scope

- Selecting local repositories
- Skill scanning
- Graph editing
- Saving workflows
- Actual execution

## Verification Checklist

- [x] The app runs as a macOS desktop app.
- [x] The left, center, right, and bottom areas are visible.
- [x] React Flow is ready to render.
- [x] No code-editor dependencies are present.

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
