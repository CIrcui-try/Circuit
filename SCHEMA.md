# Circuit Workflow Schema

## Goal

The workflow schema must restore the visual graph and be readable by future coding agents. An agent that loads a workflow JSON must be able to (1) determine execution order from `nodes` + `edges`, (2) locate the SKILL.md for each node via `skillRef`, and (3) feed values from upstream node outputs into downstream node inputs via placeholders.

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
shell
git
```

`shell` and `git` are reserved for future provider adapters; see `RUNTIME_ARCHITECTURE.md`. MVP only ships `claude` and `codex` adapters.

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

Required fields for an agent to execute the workflow:

| field          | required | notes                                                          |
|----------------|----------|----------------------------------------------------------------|
| `version`      | yes      | Must match the runtime's supported version (`0.1` for MVP).    |
| `id`           | yes      | Stable workflow identifier.                                    |
| `repositoryId` | yes      | Resolves the local repo root the agent runs against.           |
| `nodes`        | yes      | At least one node; each must validate per "Skill Node" below.  |
| `edges`        | yes      | May be empty. Each `source`/`target` must reference a node id. |
| `name`         | no       | Display only.                                                  |
| `createdAt` / `updatedAt` | no | Display only.                                              |

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

Required fields for agent execution:

| field                  | required | notes                                                                                        |
|------------------------|----------|----------------------------------------------------------------------------------------------|
| `id`                   | yes      | Unique within the workflow. Used as the key in `previousOutputs` and in `${steps.<id>.…}`.   |
| `type`                 | yes      | `"skill"` for MVP. Future types (e.g. `"approval"`) are out of scope for Phase 08.           |
| `skillRef.provider`    | yes      | One of `claude` / `codex` / `shell` / `git`.                                                 |
| `skillRef.skillFile`   | yes      | Repo-relative path to the SKILL.md the adapter should read.                                  |
| `label`                | no       | Display only.                                                                                |
| `position`             | no       | UI only — agents may ignore.                                                                 |
| `input`                | no       | `Record<string, unknown>`. Free-form for MVP; may match the SKILL.md frontmatter input schema in the future. May contain placeholders (see below). |

## Edge

```json
{
  "id": "edge_001",
  "source": "node_001",
  "target": "node_002",
  "kind": "dependency"
}
```

`source` and `target` MUST reference existing node ids. Edges with `kind: "dependency"` define execution order: `target` runs after `source` succeeds. Cycles are not supported in Phase 08.

## Output → Input Placeholders

A downstream node may reference an upstream node's output inside its `input`:

```json
{
  "id": "node_002",
  "type": "skill",
  "skillRef": { "provider": "codex", "skillFile": ".codex/skills/review-code/SKILL.md" },
  "input": {
    "diff": "${steps.node_001.output}"
  }
}
```

Syntax: `${steps.<sourceNodeId>.output}` resolves to the upstream node's `SkillExecutionResult.output`. Resolution timing and access rules are defined in `SKILL_EXECUTION_CONTRACT.md` ("Output → Input Resolution"). For Phase 08 only top-level `output` is referenceable; field paths (`${steps.x.output.foo}`) are reserved for future work.

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

## Out of Scope for Phase 08

- Conditions, loops, fan-out
- Human approval nodes
- Typed output schemas (only top-level `output` is referenceable)
- Real provider execution (only the contract is fixed; adapters land in later phases)
