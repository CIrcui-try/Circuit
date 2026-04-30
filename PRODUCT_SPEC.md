# Circuit Product Spec

## One-line Description

Circuit is a macOS visual skill and flow editor for local Claude/Codex skills.

## Primary User

A developer who keeps coding-agent skills in local repositories and wants to visually connect those skills into repeatable workflows.

## Primary Workflow

1. User adds one or more local repositories to Circuit.
2. Circuit discovers skills from `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md`.
3. Circuit displays discovered skills in the repository workspace.
4. User places skills onto a graph canvas as nodes.
5. User connects nodes with edges to represent dependency and execution order.
6. User saves the graph as a workflow schema.
7. User manually starts the workflow.
8. Circuit highlights the currently running node and shows run logs.
9. Future coding agents can read the workflow schema and execute the referenced skills.

## MVP Non-goals

- Code editor
- Arbitrary file browser
- Full repository recursive `SKILL.md` scanning
- Global user skill directory scanning
- Built-in default skills
- Cloud sync
- Collaboration
- Automatic file-change triggers
- Fully automated Claude/Codex execution
