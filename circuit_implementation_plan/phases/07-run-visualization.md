# Phase 07 – Run Visualization

## Goal

Make workflow execution visually clear and easy to understand.

The user should immediately know which skill is running, which has completed, and where the workflow failed.

## Scope

- Strong running-node visual indicator
- Success/failure/queued/idle styling
- Edge progress indication
- Run log panel
- Failure display
- Retry affordance placeholder
- E2E tests for visual states

## Tasks

1. Define visual styles for each node state.
2. Add a pulse, glow, or similar indicator for `running`.
3. Add clear `success` and `failed` states.
4. Add a run log panel.
5. Log node start, success, and failure events.
6. Display failure details in the log.
7. Add a retry button or placeholder when a node fails.
8. Add E2E tests for:
   - running state is visible
   - success state is visible
   - failure state is visible
   - run log contains expected events

## Out of Scope for This Phase

- Real retry behavior
- Agent output parsing
- Multi-agent review loop
- Parallel branches

## Verification Checklist

- [ ] Current running node is visually obvious.
- [ ] Success, failure, queued, and idle states are distinguishable.
- [ ] Run log updates in order.
- [ ] Failure appears both on the graph and in the log.
- [ ] E2E test verifies visual state changes.


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
