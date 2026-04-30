# Phase 08 – Agent Handoff Contract

## Goal

Define the contract that allows future coding agents to read a Circuit workflow and execute the referenced skills.

This phase is about schema and adapter boundaries, not a full real agent runtime.

## Scope

- Agent-readable workflow schema refinement
- `skillRef` contract
- Input/output placeholder design
- Execution context design
- Agent adapter interface
- Tests that validate schema completeness

## Tasks

1. Update `SCHEMA.md` to clearly document required fields for agent execution.
2. Define how a node points to a repository-local `SKILL.md`.
3. Define how node input is represented.
4. Define how output from one node may be passed to another.
5. Define an `AgentAdapter` interface.
6. Document future provider adapters:
   - Claude
   - Codex
   - shell
   - git
7. Add schema validation tests.
8. Add a sample workflow JSON that an agent could read.

## Out of Scope for This Phase

- Full Claude execution
- Full Codex execution
- Shell command execution
- Git mutations
- Human approval node
- Conditions and loops

## Verification Checklist

- [ ] Workflow JSON contains enough information for a future agent to know execution order.
- [ ] Each node preserves provider and `SKILL.md` path.
- [ ] Input field is documented.
- [ ] Future output passing strategy is documented.
- [ ] Agent adapter boundary is documented.
- [ ] Schema validation tests exist.


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
