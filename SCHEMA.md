# Circuit Workflow Schema

## Goal

The workflow schema must restore the visual graph and be readable by future coding agents.

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

Allowed providers:

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

Run state is separate from workflow definition.

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
