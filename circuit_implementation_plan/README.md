# Circuit Implementation Plan

## Product Definition

Circuit is a macOS desktop app that discovers `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md` across multiple local repositories, and lets users compose workflows by placing those skills as graph nodes.

Circuit's core is not a code editor. The app is a **visual skill & flow editor**. Users add local repositories to the app, place discovered skills onto a canvas, connect dependencies between nodes, and save the graph as a workflow schema.

The initial run is not triggered automatically — it is started manually by the user. The user presses a "Start Circuit" button, as if powering on a circuit, to begin the workflow.

## Confirmed Product Decisions

- The app must manage multiple local repositories.
- No code editor is provided.
- Built-in skills are out of scope for the MVP.
- Nodes reference skills the user has created in their local repositories.
- Skill discovery is limited to `.claude/skills` and `.codex/skills` inside a repository.
- Workflow execution is started manually by the user.
- Collaboration features are out of scope for the MVP.
- The end goal is to let coding agents read the workflow schema and run on their own.

## Skill Discovery Policy

For the MVP, Circuit only scans the following paths:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

Lowercase `skill.md` may be read in compatibility mode, but the official save and creation rule is uppercase `SKILL.md`.

For the MVP, Circuit does NOT do the following:

```text
Full recursive scan of <repo>/**/SKILL.md
Scan global user skill directories
Provide built-in skills
Provide a code editor
Auto-trigger on file changes
Collaboration features
```

## Recommended Stack

```text
Desktop Shell: Tauri
Frontend: React + TypeScript
Graph Editor: React Flow
State Management: Zustand
Local Storage: Tauri file system + JSON
Future Runtime: Tauri command bridge
```

## Directory Overview

```text
circuit_implementation_plan/
├── README.md
├── PRODUCT_SPEC.md
├── AGENT_GUIDE.md
├── SCHEMA.md
└── phases/
    ├── 00-foundation.md
    ├── 01-repository-manager.md
    ├── 02-skill-discovery.md
    ├── 03-visual-flow-editor.md
    ├── 04-workflow-schema.md
    ├── 05-manual-runner.md
    ├── 06-run-visualization.md
    └── 07-agent-handoff-contract.md
```

## Phase Rule

At the end of each Phase, the coding agent must write an implementation briefing. The briefing must include the features actually implemented, the files changed, the verification method, known limitations, and recommendations for the next steps.
