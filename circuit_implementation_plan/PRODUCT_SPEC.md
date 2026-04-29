# Circuit Product Spec

## One-line Description

Circuit is a macOS visual skill & flow editor that connects and saves Claude/Codex skills inside local repositories as a visual graph.

## Primary User

Developers who build and manage their own skills for Claude Code, Codex, or similar coding agents in a local development environment.

## Primary Use Case

1. The user adds a local repository to Circuit.
2. Circuit scans `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md` in that repository.
3. The discovered skills are listed in the sidebar.
4. The user adds skills to the canvas as nodes.
5. The user connects edges between nodes to express execution order and dependencies.
6. The user saves the workflow.
7. The user presses the Start Circuit button to run the workflow manually.
8. The app visually highlights the node currently being executed.
9. In the future, a coding agent will read the saved workflow schema and execute the actual skills.

## Core Screens

### Repository List

Displays the list of registered local repositories.

Required elements:

- Add Repository
- Repository name
- Repository path
- Detected Claude skills count
- Detected Codex skills count
- Open repository

### Repository Workspace

The workspace for the selected repository.

Required elements:

- Left: discovered skill list
- Center: visual workflow canvas
- Right: selected node / edge properties
- Bottom: run log
- Top: workflow selector, save button, Start Circuit button

### Workflow Editor

The main screen for editing skill nodes and edges.

Required features:

- Add nodes from the skill list to the canvas
- Move nodes
- Connect nodes
- Delete nodes
- Delete edges
- Edit node settings
- Save workflow
- Load workflow

## Non-goals for MVP

- Code editor
- Full repository file browser
- Collaborative editing
- Cloud sync
- Auto-execution on file change
- Built-in skills
- Full scan of `SKILL.md` at arbitrary paths
- A complete implementation of automatic Claude/Codex execution
