# Phase 06 – Manual Runner

## Goal

Allow the user to manually start a workflow using a mock runner.

The goal is not real skill execution yet. The goal is to validate traversal, run state, and UI feedback.

## Scope

- Start Circuit button
- Mock workflow runner
- Sequential traversal
- Node run state
- Duplicate run prevention
- Basic failure handling
- Tests for run state transitions

## Tasks

1. Add a `Start Circuit` button.
2. Create a `WorkflowRunner` interface.
3. Implement a mock runner.
4. Traverse connected nodes in dependency order.
5. Update node states:
   - idle
   - queued
   - running
   - success
   - failed
6. Prevent duplicate starts while a run is active.
7. Add a simple failure mode for testing.
8. Add tests for:
   - manual start only
   - sequential node execution
   - running to success transition
   - duplicate run prevention
   - failure state

## Out of Scope for This Phase

- Real Claude/Codex execution
- Shell command execution
- Automatic triggers
- Parallel execution
- Condition loops

## Verification Checklist

- [ ] Workflow starts only after the user clicks Start Circuit.
- [ ] Nodes execute in graph order.
- [ ] Running node state is visible.
- [ ] Completed node state becomes success.
- [ ] Failed node state is represented.
- [ ] Starting while already running is prevented.
- [ ] Tests cover run state transitions.


## Required End-of-Phase Briefing

코딩 에이전트는 Phase를 완료한 뒤 반드시 아래 형식으로 브리핑을 작성해야 한다.

```md
# Phase N Briefing

## Implemented
- 구현한 기능을 요약한다.

## Changed Files
- 변경한 주요 파일과 역할을 적는다.

## Verification
- 직접 확인한 체크리스트와 실행 방법을 적는다.

## Tests
- 추가하거나 수정한 테스트를 적는다.
- 테스트 실행 명령어와 결과를 적는다.

## Known Limitations
- 아직 구현하지 않은 것과 의도적으로 제외한 것을 적는다.

## Next Recommendation
- 다음 Phase에서 해야 할 일을 제안한다.
```
