# Circuit

Circuit is a local-first desktop app for turning Claude and Codex skills into visual workflows.

Instead of keeping automation steps in disconnected command lists, Circuit lets you register local repositories, scan the skills they already contain, place those skills on a workflow canvas, and run the flow while watching the log. It is built for developers who use both Claude and Codex and want a shared visual layer over those local skill systems.

## What Circuit Does

- Registers local repositories so each project can have its own skill catalog and saved workflows.
- Scans repository-local skills from both Claude and Codex conventions:
  - `.claude/skills/*/SKILL.md`
  - `.codex/skills/*/SKILL.md`
- Shows Claude and Codex skills together so a workflow can mix providers in one canvas.
- Provides a visual workflow canvas for arranging skill nodes and dependency edges.
- Saves and loads workflow drafts for a repository.
- Runs workflows manually and streams run output into an in-app run log.
- Supports cancelling an active run.
- Uses provider adapters for Claude and Codex instead of hard-coding a single agent runtime.

## Why Claude And Codex Together

Many repositories already carry useful automation in more than one agent format. Circuit treats Claude and Codex skills as local project capabilities rather than competing silos. A workflow can show where each provider fits, make the handoff visible, and keep the repository as the source of truth for the actual skill files.

That means a team can keep using existing `.claude/skills` and `.codex/skills` directories while building a visual map of how those skills work together.

## Visual Workflow Canvas

The workspace centers on a canvas where skill nodes represent local `SKILL.md` files. The surrounding panels make the current repository, skill list, workflow name, saved workflow menu, start/cancel controls, and run log visible while you work.

Circuit is not trying to become a code editor. It focuses on the workflow layer: discovering skills, arranging them, saving the graph, and running the selected flow locally.

## Local-First Runtime Model

Circuit runs against files and tools on your machine:

- Skill discovery reads from the selected repository.
- Workflow execution goes through a Tauri backend bridge.
- Claude and Codex execution are handled through adapter interfaces.
- Run output is streamed back to the app log.
- Safety-sensitive runtime behavior stays local rather than being delegated to a remote service.

The current model is intentionally manual. Circuit does not automatically trigger file mutations, push to git remotes, deploy code, or run arbitrary shell-command nodes.

## Current Status

Circuit is in active development. The current app includes the foundation for:

- repository registration and removal
- skill scanning for Claude and Codex skill directories
- provider count badges in the repository list
- workflow canvas editing
- workflow draft save/load
- manual workflow start
- run status and run log display
- run cancellation
- Claude and Codex adapter implementations

Known limitations at this stage:

- No built-in default skill catalog.
- No collaboration or shared remote workspace.
- No automatic deployment or git push behavior.
- No global skill directory discovery.
- No arbitrary shell command node type.
- The runtime surface is still being hardened as the app evolves.

## Development

The app lives in `app/` and uses React, Vite, Tauri, Vitest, and Playwright.

```sh
cd app
pnpm install
pnpm dev
```

Useful checks:

```sh
pnpm test:run
pnpm build
pnpm test:e2e
```

## Project Notes

Detailed implementation notes, runtime contracts, schema documentation, and phase briefings live outside the root README so this page can stay focused on the product:

- `PRODUCT_SPEC.md`
- `RUNTIME_ARCHITECTURE.md`
- `SCHEMA.md`
- `SKILL_EXECUTION_CONTRACT.md`
- `TESTING_STRATEGY.md`
- `circuit_implementation_plan/`
