# Coding Agent Guide

## Project Intent

Circuit is not an IDE and not a code editor. Circuit is a visual editor for wiring local agent skills together.

A skill is discovered only from:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

## Current Project State

Assume the following are already implemented:

- Phase 00: Tauri + React foundation
- Phase 01: repository manager
- Phase 02: skill discovery

Start with Phase 03 unless explicitly instructed otherwise.

## Architecture Principles

### 1. Keep UI, Schema, and Runner Separate

Do not mix these responsibilities:

```text
Visual Flow Editor
Workflow Schema
Manual Runner
Agent Adapter / Handoff
```

### 2. Use a Bridge for Host Capabilities

Frontend code must not directly depend on native host behavior. Use a bridge abstraction for:

- repository selection
- file system access
- skill discovery
- future command execution

This bridge must be mockable in Playwright/UI tests.

### 3. Do Not Automate Native File Dialogs in E2E

Native macOS folder pickers should not be directly automated in Playwright tests. Mock the bridge method instead.

### 4. Add Tests Phase by Phase

Starting from Phase 03, every phase must add or update at least one meaningful test.

Expected tooling:

```text
Vitest for core logic
Playwright for UI/E2E
```

### 5. Preserve Product Scope

Do not add a code editor. Do not add global skill discovery. Do not add built-in default skills unless explicitly requested.


## Linear

All Linear ticket lookups and creations must use the **Circuit team space**. Do not search or create tickets in any other team space.

## Required End-of-Phase Briefing

After completing a Phase, the coding agent must write a briefing in the format below.

- Write the briefing **in Korean** (section headings may stay in English for template stability).
- Write the briefing as a **file**, not as a chat response. The path follows the pattern `circuit_implementation_plan/phases/0N-{phase-slug}-briefing.md` (e.g. `02-skill-discovery-briefing.md`).
- Write the briefing only after all tests for that Phase pass.

```md
# Phase N Briefing

## Implemented
- Summarize the features that were implemented.

## Changed Files
- List the main files that changed and their roles.

## Verification
- Record the checklist you verified manually and how to run it.

## Tests
- List the tests you added or modified.
- Record the test commands and their results.

## Known Limitations
- List what is not yet implemented and what was intentionally left out.

## Next Recommendation
- Suggest what should be done in the next Phase.
```

## Required Phase Commit

After the briefing is written, all changes for that Phase must be recorded as a **single commit**.

- The commit subject must reference the Phase number (e.g. `Phase 0: foundation`, `Phase 2: skill discovery`).
- The commit must only be made once the tests required by §"Add Tests Phase by Phase" are all green.
- Do not mix changes outside the Phase scope into the same commit.
