# Phase 15 Briefing — Runtime Safety Controls (CIR-26)

## Implemented

- **Provider allowlist**: `AdapterRegistry` 에 `setAllowlist` / `getAllowlist` /
  `isAllowed` 추가, `get()` 호출 시 allowlist 미포함이면
  `ProviderNotAllowedError` 던짐. `createDefaultRegistry` 가 기본값
  `["claude", "codex"]` 를 자동 적용.
- **경로 재검증**: `buildSkillExecutionContext` 가 `repository.path` 자체를
  정규화·재검증 (절대경로·non-root·`..` 없음). 기존 `skillFileAbsPath` 검증은
  유지.
- **노드별 timeout override**: `WorkflowSkillNode.input.timeoutMs` (number) 가
  있으면 `RealWorkflowRunner` 가 `buildSkillExecutionContext` 로 전달.
  음수·non-finite 값은 무시. `buildSkillExecutionContext` 안에서
  [MIN_TIMEOUT_MS=1s, MAX_TIMEOUT_MS=1h] 로 clamp.
- **민감 작업 감지**: `runtime/safety/sensitiveAction.ts` 가
  skillName / prompt / skillContent 세 소스에서 `push|deploy|delete|rm|release`
  를 단어 경계 기준 case-insensitive 매치. dedup 후 canonical 순서로 반환.
- **실행 전 preview modal**: `components/run/RunPreviewModal.tsx` 가 workflow
  name, repo path, node list, allowlist, 각 node 의 provider / skillFile /
  timeout / command summary 를 보여줌. allowlist 위반 노드가 있으면 빨간 경고
  + Confirm 비활성. 민감 키워드가 있으면 "I understand" 체크박스 ack 후 활성.
  Workspace 의 Run 버튼이 직접 실행 대신 modal 을 열고 confirm 후에만
  `runWorkflow` 호출.
- **Run log 영속화**: `app/src/runner/runLogPersistence.ts` 에
  serialize/parse JSONL 헬퍼 + Tauri 측 `app/src-tauri/src/run_log_store.rs`
  에 `save_run_log` / `list_run_logs` / `load_run_log` invoke 핸들러.
  `RealWorkflowRunner` 는 옵셔널 `persistRunLog` 콜백을 받고 노드 종료
  시점마다 best-effort 로 호출. Workspace 가 `getHostBridge().saveRunLog` 와
  연결. `LogPanel` 에 "Past runs" 드롭다운 추가, 선택 시 `loadRunLog` 후
  store 에 주입.
- **Cancel UX 보강**: cancel 클릭 시 즉시 `cancelling=true`, 버튼 라벨
  "Cancelling…" + 비활성. 실행이 끝나면 (성공/실패/cancelled) 자동 해제.
- **테스트**: AdapterRegistry 4 + createDefaultRegistry 3 + buildContext 3 +
  RealWorkflowRunner 2 + sensitiveAction 8 + runLogPersistence 5 +
  RunPreviewModal 5 + Workspace W9~W12 변경/추가 = 신규 ~30 케이스.
  Tauri Rust unit test 5 (run_log_store).

## Changed Files

- `app/src/runtime/adapters/AdapterRegistry.ts` (allowlist 도입)
- `app/src/runtime/adapters/AdapterRegistry.test.ts`
- `app/src/runtime/adapters/createDefaultRegistry.ts` (기본 allowlist 주입)
- `app/src/runtime/adapters/createDefaultRegistry.test.ts`
- `app/src/runtime/safety/sensitiveAction.ts` (신규)
- `app/src/runtime/safety/sensitiveAction.test.ts` (신규)
- `app/src/runtime/context/buildSkillExecutionContext.ts` (경로 재검증 +
  timeout clamp)
- `app/src/runtime/context/buildSkillExecutionContext.test.ts`
- `app/src/runner/RealWorkflowRunner.ts` (node.input.timeoutMs 추출 +
  persistRunLog 콜백)
- `app/src/runner/RealWorkflowRunner.test.ts`
- `app/src/runner/runLogPersistence.ts` (신규)
- `app/src/runner/runLogPersistence.test.ts` (신규)
- `app/src/host/bridge.ts` (RunLogEntryDTO + 옵셔널 saveRunLog/listRunLogs/
  loadRunLog 추가)
- `app/src/host/tauriBridge.ts` (invoke 매핑)
- `app/src-tauri/src/run_log_store.rs` (신규 — save/list/load 핸들러 + path
  traversal 거부)
- `app/src-tauri/src/lib.rs` (모듈 + invoke handler 등록)
- `app/src/components/run/RunPreviewModal.tsx` (신규)
- `app/src/components/run/RunPreviewModal.test.tsx` (신규)
- `app/src/components/layout/LogPanel.tsx` (Past runs 드롭다운)
- `app/src/routes/Workspace.tsx` (preview 게이트, persistRunLog 와이어업,
  cancelling 상태)
- `app/src/routes/Workspace.test.tsx` (preview/cancel/safety 시나리오)
- `app/src/styles/global.css` (.modal\_\_\* / .run-log\_\_past)
- `circuit_implementation_plan/phases/15-runtime-safety-controls-briefing.md`
  (본 문서, 신규)

## Verification

- [x] 사용자가 preview 를 확인해야 실행된다 — `Workspace.handleStart` 가
  `runWorkflow` 를 직접 호출하지 않고 modal 만 연다. Confirm 후에만 실제
  실행. (Workspace.test W9, W10)
- [x] 실행할 node 와 provider 가 표시된다 — `RunPreviewModal` 의 nodes 테이블
  + allowlist dl. (RunPreviewModal.test M1)
- [x] command/provider summary 표시 — `RunPreviewNode.commandSummary` 칼럼.
- [x] provider allowlist 적용 — `AdapterRegistry.get` 이 throw, 모달에서
  미리 차단 (Workspace.test W11).
- [x] repository 밖 path 차단 — `buildSkillExecutionContext` (B4 기존, B9/B10
  신규).
- [x] timeout 적용 — `RealWorkflowRunner` 가 `node.input.timeoutMs` 전달
  (R10/R11) + `buildSkillExecutionContext` clamp (B11).
- [x] cancel button 동작 — 기존 R7 + 본 phase 의 cancelling 상태 반영.
- [x] 민감 작업 경고 — `detectSensitiveAction` (S1~S8) + 모달 ack 게이트
  (M4, Workspace W12).
- [x] run log 저장 — `serializeRunLogJsonl` / `parseRunLogJsonl` (P1~P5) +
  Tauri side (cargo test 5 케이스).
- [x] safety 관련 테스트 존재 — 위 모든 항목.

### 실행 방법

```sh
# Vitest 단위/통합 (242 케이스)
npm --prefix app run test:run

# Tauri Rust 단위 (run_log_store 5 + 기존 11)
cargo test --manifest-path app/src-tauri/Cargo.toml

# 컴파일 (tsc + vite + cargo)
npm --prefix app run build
cargo check --manifest-path app/src-tauri/Cargo.toml
```

## Tests

- 신규 unit / integration: 위 §"Verification" 참조.
- 모든 Vitest 파일 통과: 34 files / 242 cases.
- Tauri cargo test (run_log_store) 통과: 5 cases.

## Runtime Notes

- run log 저장 위치: `<repo_path>/.circuit/run_logs/<workflowId>/<runId>.jsonl`.
  workflow 와 동일하게 repo 내부에 저장하므로 추가 fs capability 불필요.
- workflowId / runId 는 영문·숫자·`-`·`_` 만 허용 — path traversal 방어.
- timeout 은 1s 미만이면 1s, 1h 초과면 1h 로 clamp.
- 모달이 Confirm 비활성 상태일 때 사용자가 진행하려면:
  - allowlist 위반 → 워크플로우에서 해당 노드 제거 / provider 변경.
  - sensitive 키워드 → "I understand" 체크박스 ack 후 진행.
- run log 영속화는 best-effort. host bridge 가 `saveRunLog` 를 구현하지
  않거나 호출이 실패해도 노드 실행은 영향 없음.

## Known Limitations

- **민감 키워드 매칭은 단어 경계 기반.** `pushed`, `deployed`, `releases` 같은
  파생어는 매치되지 않는다. 의도적 trade-off (false positive 줄이기).
- **Skill 본문(`content`) 기반 sensitive 감지는 preview 시점에선 사용 안 함.**
  현재는 skillName + prompt 만 검사. 본문까지 보려면 modal 을 열기 전에
  bridge.readFile 을 await 해야 하므로 UX 비용이 큼. 본문 검사는 실제 실행
  단계에서 추가 검토 가능.
- **node 별 timeout 입력 UI 없음.** `node.input.timeoutMs` 는 schema 로는
  허용되지만 PropertiesPanel 에서 편집 필드를 노출하지 않음 (입력 UI 자체가
  Phase 14 한정 미구현 항목).
- **run log 영속화는 successful run 노드별로 매번 전체 JSONL 을 다시 쓴다.**
  파일 크기가 작은 MVP 환경에서는 문제 없음. 대용량 / append 최적화는 후속.
- **Cancel 의 일관성**: `cancelling` 상태는 Workspace 의 로컬 state. 어댑터가
  cancel 신호를 무시하면 UI 가 "Cancelling…" 으로 남을 수 있음. 적당한
  타임아웃 후 강제 해제는 후속 phase 검토.
- **Tauri spawn 단계의 timeout 강제는 RuntimeBridge 가 이미 지원.** 본
  phase 는 그 전 단계의 ctx clamp만 추가했으며, OS 레벨 sandboxing 은
  out-of-scope.

## Next Recommendation

1. **PropertiesPanel 에 input editor 추가** — `prompt`, `timeoutMs`,
   기타 input 필드를 편집할 수 있게 하면 본 phase 의 sensitive / timeout
   기능이 실제 사용자에게 노출된다.
2. **민감 키워드 list 를 사용자 settings 로 노출** — 현재는 hard-coded.
   repository 별 allow/deny 리스트를 추가하면 false positive 회피 가능.
3. **Run log retention 정책** — 무제한 누적 방지를 위해 워크플로우당
   최근 N 개만 유지 + 오래된 .jsonl 자동 정리.
4. **Skill content 기반 sensitive 감지** — 모달이 열리기 전에 비동기로
   skillContent 를 읽어 검사. 이미 캐시된 content 가 있다면 동기 fast-path.
5. **Cancel 강제 타임아웃** — `cancelling` 상태가 일정 시간 (예: 5s) 이상
   지속되면 사용자에게 "force kill" 옵션 노출.
