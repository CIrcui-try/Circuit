# Phase 04 – Visual Flow Editor

## Goal

Allow discovered skills to be placed onto a visual workflow canvas as nodes and connected with edges.

## Scope

- Skill list to canvas node creation
- React Flow canvas
- Node movement
- Node selection
- Node deletion
- Edge creation
- Edge deletion
- Selected node properties panel
- E2E tests for core graph interactions

## Tasks

1. Render the workflow canvas using React Flow.
2. Allow the user to add a discovered skill to the canvas.
3. Ensure each node stores a `skillRef` with:
   - provider
   - skill file path
   - repository id or repository-relative path
4. Allow nodes to be moved on the canvas.
5. Allow nodes to be selected.
6. Show selected node properties in the right panel.
7. Allow nodes to be connected with edges.
8. Allow node and edge deletion.
9. Add E2E tests for:
   - adding a skill as a node
   - selecting a node
   - verifying `skillRef` in the properties panel
   - connecting two nodes
   - deleting a node or edge

## Out of Scope for This Phase

- Workflow persistence
- Manual execution
- Real skill execution
- Code editing
- Automatic layout
- Condition or loop nodes

## Verification Checklist

- [ ] A discovered skill can be added to the canvas.
- [ ] The node references the original `SKILL.md`.
- [ ] A node can be moved.
- [ ] A node can be selected.
- [ ] The right panel shows provider and skill path.
- [ ] Two nodes can be connected.
- [ ] Nodes and edges can be deleted.
- [ ] E2E tests cover the main graph editing flow.


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
