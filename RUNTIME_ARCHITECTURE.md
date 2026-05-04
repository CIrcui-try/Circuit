# Runtime Architecture

## Goal

Circuit의 runtime architecture는 저장된 workflow schema를 실제 에이전트 실행으로 연결한다.

## High-level Flow

```text
User clicks Start Circuit
-> UI sends workflowId to RuntimeBridge
-> RuntimeBridge creates RunSession
-> RealWorkflowRunner resolves nodes in order
-> Runner selects AgentAdapter by provider
-> Adapter reads SKILL.md and builds prompt
-> Adapter launches Claude/Codex process
-> Process output streams back to UI
-> Runner records node result
-> Runner continues to next node
```

## Main Modules

```text
runtime/
├── bridge/
│   ├── RuntimeBridge.ts
│   └── RuntimeBridge.mock.ts
├── runner/
│   ├── RealWorkflowRunner.ts
│   └── graphTraversal.ts
├── adapters/
│   ├── AgentAdapter.ts
│   ├── ClaudeAdapter.ts
│   └── CodexAdapter.ts
├── contracts/
│   ├── SkillExecutionContext.ts
│   ├── SkillExecutionResult.ts
│   └── AgentRunEvent.ts
└── safety/
    ├── commandPolicy.ts
    ├── pathPolicy.ts
    └── timeoutPolicy.ts
```

## Safety Layer

최소 정책:

- repository root 밖 파일 접근 금지
- 허용된 provider만 실행
- 임의 shell command node 금지
- 실행 전 preview 제공
- timeout 필수
- cancel 가능
