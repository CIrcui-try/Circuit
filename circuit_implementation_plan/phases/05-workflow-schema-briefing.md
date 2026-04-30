# Phase 5 Briefing

## Implemented

- **Workflow schema 모듈 신설** — `app/src/workflow/schema.ts`. `SCHEMA.md` §Workflow / §Skill Node / §Edge 와 1:1 로 매핑되는 TypeScript 타입 (`Workflow`, `WorkflowSkillNode`, `WorkflowEdge`, `WorkflowSkillRef`, `WorkflowSummary`) + `WORKFLOW_VERSION = "0.1"` 상수만 노출. `workflowStore` 는 이 모듈을 import 하지 않는다 (AGENTS.md §1).
- **toWorkflow / fromWorkflow 순수 변환 함수** — `app/src/workflow/serialize.ts`. React Flow 의 `SkillNode[]` / `Edge[]` 와 `Workflow` schema 사이를 양방향 변환. `toWorkflow` 는 `now: () => string` 을 주입받아 테스트가 `updatedAt` 을 결정론적으로 검증할 수 있게 했다. `fromWorkflow` 는 unknown version, missing `skillRef`, unsupported node type 을 던지는 가벼운 boundary 검증을 포함 — 이 이상의 schema validation 은 over-engineering 이라 의도적으로 제외 (CLAUDE.md §1).
- **workflowService — bridge × serialize 오케스트레이션** — `app/src/workflow/workflowService.ts`. `saveCurrent({ repoPath, repositoryId })`, `loadById({ repoPath, workflowId })`, `listForRepo(repoPath)` 세 entry point 만. 첫 Save 시 `crypto.randomUUID()` 로 workflow id 를 생성하고 store 에 mirror, 이후 Save 는 같은 id 로 overwrite. JSON 은 string 으로 bridge 에 흘려보내 host 레이어가 schema 진화에 무관해진다.
- **HostBridge 확장** — `app/src/host/bridge.ts` 의 `HostBridge` 인터페이스에 `listWorkflows / loadWorkflow / saveWorkflow` 추가. JSON payload 는 string 으로만 다룬다 — bridge 가 schema 모듈에 의존하지 않는 일방향 의존성 유지. `tauriBridge.ts` 가 새 Tauri command 들을 invoke.
- **Tauri Rust commands** — 신규 `app/src-tauri/src/workflow_store.rs` + `lib.rs` 의 `invoke_handler!` 등록. `<repo>/.circuit/workflows/<workflow-id>.json` 경로로 atomic write (`<id>.json.tmp` → `fs::rename`). `workflow_id` 는 `[A-Za-z0-9_-]+` 만 허용해 path traversal 차단. `list_workflows` 는 `serde_json::Value` 로 `id` / `name` / `updatedAt` 만 뽑아 summary 반환 — schema 전체 struct 를 Rust 에 정의하지 않아 schema 진화가 TS 단독으로 가능하다.
- **workflowStore UUID 마이그레이션 + 새 액션** — `app/src/stores/workflowStore.ts`. `nextNodeId()` 가 모듈 스코프 카운터 → `crypto.randomUUID()`. 새 state `workflowName` (기본 `"Untitled workflow"`), `currentWorkflowId`. 새 액션 `setWorkflowName`, `replaceCanvas({ nodes, edges, workflowId, workflowName })`. `replaceCanvas` 는 이미 React Flow 형태로 풀어진 객체만 받아 store 가 schema 결합을 갖지 않는다. `resetWorkflow` 가 새 두 필드도 함께 클리어.
- **Workspace toolbar 활성화** — `app/src/routes/Workspace.tsx`. `Workflow ▾` 비활성 버튼이 사라지고 `<input data-testid="workflow-name-input">` (이름 편집), `<select data-testid="workflow-menu">` (저장된 workflow + "New workflow"), `<button data-testid="workflow-save">` 가 들어왔다. repo 진입 / 변경 시 `listForRepo` 로 menu 를 채우고, Save 후에도 refresh. 저장 결과는 `data-testid="workflow-save-status"` toast 로 표시. `Start Circuit` 버튼만 여전히 disabled (Phase 6 영역).
- **Playwright mock bridge — localStorage backed** — `app/e2e/fixtures/installBridge.ts`. workflow CRUD 와 repository 목록을 `__circuit_mock_workflows__` / `__circuit_mock_repositories__` 로 localStorage 에 백업. `addInitScript` 가 reload 마다 closure 를 재실행하기 때문에, page reload 후에도 저장된 데이터가 유지되어야 F6 의 "save → reload → restore" 시나리오를 실제 path 로 검증할 수 있다.

## Changed Files

신규:

- `app/src/workflow/schema.ts` — TypeScript 타입.
- `app/src/workflow/serialize.ts` — `toWorkflow` / `fromWorkflow`.
- `app/src/workflow/serialize.test.ts` — Vitest 5 개 (SR1–SR5).
- `app/src/workflow/workflowService.ts` — bridge × serialize 오케스트레이션.
- `app/src-tauri/src/workflow_store.rs` — Rust commands + 5 단위 테스트.
- `app/e2e/workflow-persistence.spec.ts` — Playwright F6.
- `circuit_implementation_plan/phases/05-workflow-schema-briefing.md` — 본 브리핑.

수정:

- `app/src/host/bridge.ts` — `HostBridge` 에 3개 메서드 + `WorkflowSummaryDTO`.
- `app/src/host/tauriBridge.ts` — invoke 래퍼 3개.
- `app/src/stores/workflowStore.ts` — UUID, `replaceCanvas`, `setWorkflowName`, `workflowName`, `currentWorkflowId`, `DEFAULT_WORKFLOW_NAME`.
- `app/src/stores/workflowStore.test.ts` — WS11–WS14 추가.
- `app/src/routes/Workspace.tsx` — toolbar 활성화 + workflow menu / save status.
- `app/src/routes/Workspace.test.tsx` — bridge mock 확장, W5 disabled → enabled 어서션 갱신, W8 (Save 호출 시 직렬화 JSON) 추가.
- `app/src/components/layout/layout.test.tsx` — bridge mock 확장.
- `app/src/App.test.tsx` — bridge mock 확장 (workspace 마운트 시 listWorkflows 호출).
- `app/src-tauri/src/lib.rs` — `mod workflow_store` + 3 command 등록.
- `app/src/styles/global.css` — `.workspace__toolbar-input`, `.workspace__toolbar-status`.
- `app/e2e/fixtures/installBridge.ts` — workflow CRUD + repos localStorage backing.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 단위) | `cd app && pnpm test:run` | 11 files / **80 tests passed** (≈ 1.4 s) |
| Playwright (E2E) | `cd app && pnpm test:e2e` | **11 tests passed** (smoke 5 + flow-editor 5 + workflow-persistence 1, 9 workers, ≈ 1.9 s) |
| Rust 단위 테스트 | `cargo test --manifest-path app/src-tauri/Cargo.toml --lib` | **7 tests passed** (skill_scan 2 + workflow_store 5) |
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 606 ms 빌드 (`dist/assets/index-*.js` 429.27 kB / gzip 138.13 kB) |

스펙 체크리스트 매핑 (`circuit_implementation_plan/phases/05-workflow-schema.md` §Verification Checklist):

- [x] Workflow can be saved as JSON — Save 버튼 → `workflowService.saveCurrent` → bridge.saveWorkflow → Rust `save_workflow` 가 `<repo>/.circuit/workflows/<uuid>.json` 으로 atomic write. F6 + W8 + Rust `save_then_load_round_trips_json`.
- [x] Saved JSON includes `repositoryId`, nodes, edges — W8 (단위) 가 `parsed.repositoryId === "id-alpha"` 와 `nodes.length === 1` 을 단언. SR2 가 `version` / `repositoryId` 주입을 검증.
- [x] Each node includes `skillRef` — SR1 round-trip + W8 의 `parsed.nodes[0].skillRef` 매칭.
- [x] Workflow can be loaded again — F6 가 reload 후 menu 에서 항목을 선택하면 `replaceCanvas` 로 캔버스가 복원됨을 확인.
- [x] Loaded graph visually matches saved graph — F6 이 reload 전후의 node id / position / edge 를 `evaluate` 로 비교.
- [x] Unit tests cover serializer/deserializer — SR1–SR5.
- [x] E2E test covers save and load flow — F6.

## Tests

추가 / 변경:

- **Vitest — serialize.test.ts (5개, 신규)** : SR1 round-trip identity, SR2 `version`/`repositoryId`/`updatedAt` 주입, SR3 unknown version 거부, SR4 missing `skillRef` 거부, SR5 재직렬화 시 `updatedAt` 갱신 + `createdAt` 보존.
- **Vitest — workflowStore.test.ts (4개 추가)** : WS11 UUID 비충돌, WS12 `setWorkflowName`, WS13 `resetWorkflow` 가 새 필드도 클리어, WS14 `replaceCanvas` 가 selection 클리어 + 새 nodes/edges 로 교체.
- **Vitest — Workspace.test.tsx** : W5 가 "Save / Workflow menu enabled" 로 갱신 (회귀 가드 invertion), W8 신규 (Save 클릭 → `bridgeMock.saveWorkflow` 가 `repositoryId`+`skillRef` 가 들어간 JSON 으로 호출됨).
- **Vitest — App.test.tsx / layout.test.tsx** : workflow 메서드 stub 추가 (Workspace 가 listWorkflows 를 호출하므로 필요).
- **Rust — workflow_store (5개, 신규)** : save_then_load_round_trips_json, list_workflows_returns_summaries_sorted_desc, list_workflows_returns_empty_when_dir_missing, save_workflow_rejects_path_traversal, load_workflow_rejects_illegal_id.
- **Playwright (1개, 신규 파일 `workflow-persistence.spec.ts`)** : F6 save → reload → menu 에서 항목 선택 → 노드/엣지/위치/이름 모두 복원.

실행 명령 / 결과:

```
cd app && pnpm test:run                                                    # 11 files / 80 tests passed
cd app && pnpm test:e2e                                                    # 11/11 passed
cargo test --manifest-path app/src-tauri/Cargo.toml --lib                  # 7/7 passed
cd app && pnpm build                                                       # tsc + vite 606 ms
```

## Known Limitations

- **자동 로드는 일부러 빼두었다.** repo 를 다시 진입하면 캔버스는 비고, Workflow ▾ 에서 명시적으로 선택해야 복원된다. SCHEMA.md / 스펙 §Tasks 가 "list or selector" 만 요구해 over-scope 회피 (CLAUDE.md §1).
- **이름 검증 / 중복 이름 처리 없음.** workflow id 는 UUID 라 충돌 없지만, 이름은 자유 텍스트 — 같은 이름의 workflow 두 개를 허용한다. Phase 5 범위 밖.
- **삭제 / 이름변경 기능 없음.** menu 의 Workflow 항목을 지우거나 rename 하는 UI 가 없다. 디스크에서 직접 파일을 지우면 사라지므로 escape hatch 는 있지만 UX 는 미정.
- **Run state / runtime 영속화는 별도 파일로 가져갈 예정** (SCHEMA.md §Run State 가 별도 모델로 정의되어 있고, Phase 6/7 범위).
- **Schema 진화 전략 (마이그레이션 / 옛 version 변환) 미정.** 현재 `0.1` 외 버전은 `fromWorkflow` 가 던진다. 다음 메이저 변경 시 마이그레이션 함수를 `serialize.ts` 옆에 두는 것이 가장 자연스러울 것.
- **F6 의 reload 후 mock 데이터 보존은 mock bridge 가 localStorage 에 직접 쓰는 구조에 의존.** 이는 스펙이 요구하는 "프로덕션 path 와 동일한 함수를 거친다" 원칙 (Phase 4 briefing §Known Limitations 와 같은 트레이드오프) 을 유지하기 위한 의도적 선택.

## Next Recommendation

다음은 **Phase 6 — Manual Runner** (`circuit_implementation_plan/phases/06-manual-runner.md`). 이번 phase 에서 schema / 영속화 / 캔버스 복원이 모두 갖춰졌으니:

1. Workflow store 에 `runState` 를 합치는 대신, SCHEMA.md §Run State 의 모델을 그대로 따르는 별도 store / module (`app/src/runner/`) 을 만든다 — AGENTS.md §1 의 "Editor / Schema / Runner 분리" 를 계속 유지.
2. `Start Circuit` 버튼을 활성화하고, 위상 정렬 (toposort) 한 노드에 대해 mock 실행기를 순차 호출 (Phase 6 스펙 §Sequential mock execution + Duplicate run prevention).
3. `node.skillRef.skillFile` 를 실제 agent (claude / codex CLI) 로 보낼 adapter 인터페이스를 정의 — 단, Phase 6 에서는 mock 만, 실제 실행은 Phase 8 의 Agent Handoff Contract 에서.
4. Run log UI 와 노드별 status badge (idle/queued/running/success/failed) 는 Phase 7 가 다루므로 6 단계에서는 store 에 `nodeStates` 만 채우고 시각화는 미루는 것이 깔끔.
5. F7 E2E: 두 노드 직렬 연결 후 Start → 1초 후 둘 다 success, 실행 중 다시 Start 누르면 무시되는지 확인.
