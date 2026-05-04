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
    provider: "claude" | "codex" | "shell" | "git"
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

## Output → Input Resolution

다음 노드의 `input` 안에 들어 있는 `${steps.<sourceNodeId>.output}` placeholder는 어댑터가 `execute` 를 호출하기 직전에 runner가 치환한다.

규칙:

- `previousOutputs` 의 키는 워크플로우의 노드 `id` 와 동일하다.
- `${steps.<id>.output}` 는 `previousOutputs[id].output` 의 값으로 치환된다. 해당 노드가 아직 성공하지 않았거나 (`status !== "success"`) `output` 이 없으면 placeholder 가 포함된 노드는 실행 거부 (`failed`) 처리된다.
- Phase 08 에서는 최상위 `output` 만 참조 가능하다. `${steps.x.output.foo}` 같은 경로 접근은 향후 typed output schema 와 함께 정의된다.
- 치환은 `input` 의 string 값에 대해서만 수행한다. 값 전체가 placeholder 면 (`"diff": "${steps.node_001.output}"`) 결과 타입 그대로 (`unknown`) 주입된다. 문자열 안에 끼워넣는 형태 (`"prompt": "review: ${steps.x.output}"`) 는 `String(...)` 로 직렬화한다.
- placeholder 형식이 잘못되었거나 (`${steps.x}` 처럼 `.output` 누락) 존재하지 않는 노드 id 를 가리키면 검증 단계에서 실패해야 한다 (`workflow/validate.ts`).

이 규약은 워크플로우 정의(`Workflow.nodes[].input`) 와 실행 컨텍스트(`SkillExecutionContext.previousOutputs`) 사이의 유일한 다리이다. typed output schema, 부분 경로 접근, 다중 placeholder 변환 함수는 Phase 08 범위 밖이다.
