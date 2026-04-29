# Coding Agent Guide

## Project Intent

Circuit is not an app for creating skills for coding agents. It is an app for visually connecting skills that already exist in local repositories.

Skills are discovered only from the following locations:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

## Architecture Principles

### 1. Separate Editor, Schema, and Runner

Do not mix the following three areas:

```text
Visual Flow Editor
Workflow Schema
Manual Runner
```

The Editor edits the graph. The Schema represents the graph as savable data. The Runner reads the schema and progresses the state.

### 2. Do Not Build a Code Editor

Circuit is not a tool for editing file contents. Embedded code editors such as Monaco or CodeMirror are not part of the MVP.

### 3. Repository-local First

Every skill belongs to a selected repository. Global skill directories are excluded from the MVP.

### 4. Manual Trigger Only

Workflow execution starts only by the user clicking a button. File-change watchers, cron, webhooks, and git hooks are excluded from the MVP.

### 5. Schema Must Be Agent-readable

Ultimately, the workflow schema must be readable and executable by a coding agent. Do not save only UI state that is human-readable.

## Required Phase Completion

After completing each Phase, a briefing file must be written. The briefing must be written in Korean.

After the briefing is written, the coding agent must commit all changes from that Phase as a single commit. The commit message subject should reference the Phase number (e.g. `Phase 0: foundation`).


## Required End-of-Phase Briefing

After completing a Phase, the coding agent must write a briefing in the following format. The briefing body (Implemented / Changed Files / Verification / Known Limitations / Next Recommendation) must be written in Korean. Section headings may remain in English to keep the template stable.

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
