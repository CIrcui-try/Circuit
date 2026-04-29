# Circuit Workflow Schema

## Goal

This document is an initial draft of the workflow schema that Circuit will save. The schema must serve not only to restore the UI but also as a contract that a coding agent can read and execute in the future.

## Repository

```json
{
  "id": "repo_001",
  "name": "my-project",
  "path": "/Users/example/Documents/GitHub/my-project",
  "createdAt": "2026-04-29T00:00:00Z",
  "updatedAt": "2026-04-29T00:00:00Z"
}
```

## Skill

A skill references a `SKILL.md` file inside the repository.

```json
{
  "id": "skill_001",
  "provider": "claude",
  "name": "implement-feature",
  "rootDir": ".claude/skills/implement-feature",
  "skillFile": ".claude/skills/implement-feature/SKILL.md",
  "description": "Implements a requested feature."
}
```

`provider` must be one of the following:

```text
claude
codex
```

## Workflow

```json
{
  "version": "0.1",
  "id": "workflow_001",
  "repositoryId": "repo_001",
  "name": "Implement and Review Feature",
  "nodes": [],
  "edges": [],
  "createdAt": "2026-04-29T00:00:00Z",
  "updatedAt": "2026-04-29T00:00:00Z"
}
```

## Skill Node

```json
{
  "id": "node_001",
  "type": "skill",
  "skillRef": {
    "provider": "claude",
    "skillFile": ".claude/skills/implement-feature/SKILL.md"
  },
  "label": "Implement Feature",
  "position": {
    "x": 120,
    "y": 240
  },
  "input": {
    "featureDescription": "Add message pinning"
  }
}
```

## Edge

```json
{
  "id": "edge_001",
  "source": "node_001",
  "target": "node_002",
  "kind": "dependency"
}
```

## Run State

Run state is not the workflow definition. It should be stored separately.

```json
{
  "runId": "run_001",
  "workflowId": "workflow_001",
  "status": "running",
  "nodeStates": {
    "node_001": "success",
    "node_002": "running"
  },
  "startedAt": "2026-04-29T00:00:00Z"
}
```

## MVP Node States

```text
idle
queued
running
success
failed
skipped
```

## Future Extensions

The schema should be designed to allow:

- condition nodes
- loop nodes
- approval nodes
- parallel branches
- structured input/output contracts
- agent execution metadata
