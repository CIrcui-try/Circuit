# Phase 05 – Workflow Schema

## Goal

Serialize the visual graph into a workflow schema and restore the graph from that schema.

## Scope

- TypeScript schema types
- Graph-to-schema serialization
- Schema-to-graph deserialization
- Repository-local workflow storage
- Workflow list in the workspace
- Save and load UI
- Unit tests and E2E tests for persistence

## Tasks

1. Define TypeScript types based on `SCHEMA.md`.
2. Convert React Flow nodes and edges into a `Workflow` object.
3. Convert a `Workflow` object back into React Flow nodes and edges.
4. Save workflows under the selected repository, for example:
   - `.circuit/workflows/<workflow-id>.json`
5. Add a workflow list or selector.
6. Add Save Workflow and Load Workflow actions.
7. Add tests for:
   - schema serialization
   - schema deserialization
   - saving a workflow
   - loading and restoring a graph
8. Ensure saved nodes preserve `skillRef`.

## Out of Scope for This Phase

- Manual runner
- Runtime state persistence
- Agent execution
- Complex condition/loop schema

## Verification Checklist

- [ ] Workflow can be saved as JSON.
- [ ] Saved JSON includes `repositoryId`, nodes, and edges.
- [ ] Each node includes `skillRef`.
- [ ] Workflow can be loaded again.
- [ ] Loaded graph visually matches the saved graph.
- [ ] Unit tests cover serializer/deserializer.
- [ ] E2E test covers save and load flow.


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
