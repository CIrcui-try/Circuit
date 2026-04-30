# Circuit Implementation Plan v3

## Current Assumption

Phase 00, Phase 01, Phase 02 are already implemented.

This plan starts from the current state and reorganizes the next steps:

- Phase 00: Foundation — already implemented
- Phase 01: Repository Manager — already implemented
- Phase 02: Skill Discovery — already implemented
- Phase 03: UI / E2E Test Infrastructure
- Phase 04: Visual Flow Editor
- Phase 05: Workflow Schema
- Phase 06: Manual Runner
- Phase 07: Run Visualization
- Phase 08: Agent Handoff Contract
- Phase 09: Runtime Bridge
- Phase 10: Skill Execution Contract
- Phase 11: Agent Adapter Interface
- Phase 12: Claude Adapter
- Phase 13: Codex Adapter
- Phase 14: Real Workflow Runner
- Phase 15: Runtime Safety Controls

## Product Definition

Circuit is a macOS desktop app for visually connecting local Claude/Codex skills into workflow graphs.

Circuit manages multiple local repositories. For each repository, it discovers skills only from:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

Circuit is not a code editor. It is a visual skill and flow editor.

## Confirmed Decisions

- The app must support multiple local repositories.
- The app must not include a code editor in the MVP.
- Built-in default skills are out of MVP scope.
- Nodes represent user-created local skills.
- Skills are discovered only under `.claude/skills` and `.codex/skills`.
- Workflow execution is manually triggered by the user.
- Collaboration is out of MVP scope.
- E2E/UI tests must be introduced now, not after all implementation is finished.
- Phase 03 is dedicated to setting up UI/E2E test infrastructure.

## Testing Strategy

E2E tests should start from Phase 03.

Do not wait until the end of the project to add E2E tests. However, do not attempt to make all E2E tests comprehensive immediately. Add thin smoke tests first, then expand tests phase by phase.

Recommended split:

```text
Core logic tests: Vitest
UI / flow tests: Playwright
Native Tauri dialogs: do not automate directly
Tauri bridge: mock in UI tests
```

During early phases, Playwright should run against the React/Vite app, not necessarily the packaged Tauri app. Tauri-specific APIs such as repository selection, file reads, and skill discovery should be called through a bridge interface that can be mocked in tests.

Each future phase must add or update at least one test protecting the main behavior introduced in that phase.

## Runtime Phases (09-15)

Phase 00-08 cover repository management, skill discovery, the visual editor, the workflow schema, the mock runner, run visualization, and the agent handoff contract. None of those phases actually execute a Claude or Codex agent. Phase 09 onward turns the workflow schema into real local execution:

```text
workflow schema
  -> real workflow runner
  -> provider-specific agent adapter
  -> Claude/Codex CLI
  -> local repository changes
  -> run logs surfaced in Circuit UI
```

## Runtime Architecture Principle

Circuit frontend must not directly execute shell commands. All local runtime behavior must go through a Tauri backend bridge.

```text
React UI
  -> Runtime Bridge
  -> Agent Adapter
  -> Claude / Codex process
  -> Local repository
```

## MVP Runtime Policy

**Allowed**

- Claude adapter execution
- Codex adapter execution
- Reading repository-local `SKILL.md`
- stdout / stderr streaming
- Timeout
- Cancel
- Run log persistence

**Excluded**

- Arbitrary shell command nodes
- Automatic file mutation triggers
- Automatic `git push`
- Automatic deployment
- Execution of global skill directories
- Filesystem access outside the repository root
