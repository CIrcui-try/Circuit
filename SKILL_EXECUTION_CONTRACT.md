# Skill Execution Contract

## Goal

각 workflow node가 실제 에이전트에게 실행될 때 필요한 입력, 컨텍스트, 출력 형식을 정의한다.

## SkillExecutionContext

```ts
export interface SkillExecutionContext {
  runId: string
  workflowId: string
  nodeId: string
  repository: {
    id: string
    name: string
    path: string
  }
  skill: {
    provider: "claude" | "codex"
    name: string
    rootDir: string
    skillFile: string
    skillFileAbsPath: string
    content: string
  }
  input: Record<string, unknown>
  previousOutputs: Record<string, SkillExecutionResult>
  execution: {
    timeoutMs: number
    cwd: string
    env?: Record<string, string>
  }
}
```

## SkillExecutionResult

```ts
export interface SkillExecutionResult {
  status: "success" | "failed" | "cancelled" | "timeout"
  exitCode?: number
  output?: unknown
  summary?: string
  logs: AgentRunEvent[]
  startedAt: string
  finishedAt: string
}
```

## AgentRunEvent

```ts
export type AgentRunEvent =
  | { type: "start"; timestamp: string; message: string }
  | { type: "stdout"; timestamp: string; text: string }
  | { type: "stderr"; timestamp: string; text: string }
  | { type: "status"; timestamp: string; status: string }
  | { type: "finish"; timestamp: string; exitCode?: number }
  | { type: "error"; timestamp: string; message: string }
```

## Prompt Construction

Adapter는 다음 정보를 조합해 provider에 넘길 prompt를 구성한다.

- SKILL.md content
- current node input
- previous node outputs
- repository path
- workflow/node metadata

## Default Input Policy

MVP에서는 구조화된 input schema가 없어도 실행 가능해야 한다.

```json
{
  "prompt": "사용자가 이 노드에 전달한 지시문"
}
```

## Future Input Schema

향후 `SKILL.md` frontmatter에 input schema를 정의할 수 있다.

```md
---
name: implement-feature
inputs:
  featureDescription:
    type: string
    required: true
outputs:
  summary:
    type: string
---
```
