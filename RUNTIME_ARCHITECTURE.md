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

## Provider Adapters

각 어댑터는 `app/src/runtime/adapters/AgentAdapter.ts` 의 `AgentAdapter` 인터페이스를 구현한다. 책임 범위:

- **claude** — Claude Code CLI / API 를 통해 SKILL.md 를 system prompt 로 두고 `input` 을 user prompt 로 실행한다.
- **codex** — Codex CLI 를 통해 동일한 입력으로 실행한다.
- **shell** — Phase 08 시점에는 reserved. 향후 SKILL.md 의 frontmatter 에 정의된 안전 명령만을 spawn 한다 (safety layer 의 commandPolicy 통과 필수).
- **git** — Phase 08 시점에는 reserved. 향후 read-only git 조회 (status / diff / log) 를 SKILL.md 가 지정한 인자로만 수행한다. 변경 명령은 별도 승인 노드 도입 시까지 금지.

MVP 에서는 claude / codex 만 실제 구현되며, shell / git 어댑터는 인터페이스만 예약된다.

## Safety Layer

최소 정책:

- repository root 밖 파일 접근 금지
- 허용된 provider만 실행
- 임의 shell command node 금지
- 실행 전 preview 제공
- timeout 필수
- cancel 가능
