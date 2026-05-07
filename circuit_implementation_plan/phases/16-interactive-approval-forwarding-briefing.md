# Phase 16 Briefing — Interactive Approval Forwarding (CIR-28)

## Implemented

- **per-runId Tauri Channel 마이그레이션**: 글로벌 `runtime://event` emit /
  `listen()` 패턴을 폐기하고 `tauri::ipc::Channel<RuntimeProcessEvent>` 를
  spawn 인자로 전달. JS 측 `TauriRuntimeBridge` 는 per-runId `Channel` 객체를
  생성·재사용하면서 listener 들을 동기적으로 dispatch — `Unsubscribe.ready` 가
  방어하던 spawn–listen race 를 구조적으로 제거. JS 인터페이스 (`spawn`,
  `subscribe`) 는 그대로 유지해 14 어댑터/probe 회귀 케이스가 호환된다.
- **child stdin pipe + `runtime_send_input` 커맨드**: `Stdio::null()` →
  `Stdio::piped()`. `RuntimeBridgeState` 의 value 를 `RunHandle { cancel,
  stdin }` 으로 확장해 진행 중 run 의 stdin 핸들을 안전하게 보관. 신규 Tauri
  커맨드 `runtime_send_input(run_id, text)` 가 `write_all + flush`. 자식이
  종료되면 spawn task 가 stdin slot 을 비워서 늦게 들어온 send 가 깨끗이
  reject 된다.
- **`ApprovalRequest` 이벤트 + `approval_required` AgentRunEvent**: Rust
  `RuntimeProcessEvent` 에 `ApprovalRequest { request_id, prompt, kind }`,
  `ApprovalKind = Trust | Command | Freeform` 추가. JS 측 RuntimeBridge,
  `SkillExecution.AgentRunEvent` 에 동일 정보의 `approval_required` variant
  추가. **terminal 아님** — `runViaBridge` 는 result 를 finish 까지 resolve
  하지 않는다. Rust variant 는 mock scenario 강제 주입용 surface 이며 v1 의
  실제 prod 경로는 JS 휴리스틱이 합성한다.
- **`approvalProtocol.ts` 휴리스틱**: stderr 한 줄을 받아 codex 의 trust
  prompt (`/Do you trust this directory|workspace|folder\?/i` 등) 와
  approve-command prompt (`/Allow this command\?/i` 등) 를 매칭. 매치 시
  `crypto.randomUUID()` 로 `requestId` 를 발급하고 `kind` 를 분류. multi-line
  chunk 헬퍼도 함께 제공. `runViaBridge` 가 stderr 이벤트를 받을 때마다 이
  헬퍼를 돌려 sink 에 추가 emit.
- **CodexAdapter default 복원**: `defaultBuildCommand` args 가
  `["exec", prompt]` — `--dangerously-bypass-approvals-and-sandbox` /
  `--skip-git-repo-check` 제거. 이제 codex 가 trust/approve 프롬프트를 띄우면
  forwarding 채널이 잡고, sandbox 정책은 CLI 기본값.
- **`pendingApprovals` store + `ApprovalPrompt` 컴포넌트**: `useRunLogStore` 에
  `pendingApprovals: Record<requestId, PendingApproval>` 추가. `appendEvent` 가
  `approval_required` 를 받으면 자동 add, `setNodeResult` 가 해당 노드의
  pending 을 정리, `resolvePendingApproval(requestId)` 액션으로 명시 제거,
  `reset` 시 비움. `ApprovalPrompt.tsx` 는 LogPanel 안의 inline `<li>` 한 줄
  컴포넌트 — `kind=trust|command` → Allow/Deny 버튼이 `y\n` / `n\n` 을
  send, `kind=freeform` → input + Send 가 `<text>\n` 을 send. blocking modal
  아님이라 parallel 노드 / multi-prompt 에 자연스럽다.
- **LogPanel 와이어업**: events 와 pendingApprovals 를 한 `<ul>` 에 흘리고,
  `handleRespond` 가 `getRuntimeBridge().sendInput(runId, text)` →
  `resolvePendingApproval` 호출. 테스트가 bridge 를 주입할 수 있도록
  `runtimeBridgeOverride` prop 도 추가.
- **테스트**: 신규 `approvalProtocol.test.ts` 8, `ApprovalPrompt.test.tsx` 4,
  `runViaBridge.test.ts` 2, `runLogStore.test.ts` 의 추가 3 (L5/L6/L7),
  `layout.test.tsx` 의 추가 1, `RuntimeBridge.mock.test.ts` 의 추가 2,
  `approvalForwarding.integration.test.ts` 7 = 신규 27 케이스. 회귀 14 케이스
  (Claude/Codex/AdapterRegistry/createDefaultRegistry/FakeAgentAdapter/
  RuntimeBridge.mock/RuntimeBridge.dispatch) 모두 그대로 통과.

## Changed Files

- `app/src-tauri/src/runtime_bridge.rs` (Channel 마이그레이션, stdin pipe,
  `RunHandle`, `runtime_send_input`, `ApprovalRequest`/`ApprovalKind` variant)
- `app/src-tauri/src/lib.rs` (`runtime_send_input` invoke handler 등록)
- `app/src/runtime/bridge/RuntimeBridge.ts` (인터페이스에 `sendInput` +
  `RuntimeApprovalKind` / `approvalRequest` variant)
- `app/src/runtime/bridge/RuntimeBridge.tauri.ts` (per-runId Channel 풀링,
  `sendInput` invoke, 글로벌 listen 제거)
- `app/src/runtime/bridge/RuntimeBridge.mock.ts` (`sendInput` spy, `onInput`
  스크립팅 훅, `ScenarioStep` export)
- `app/src/runtime/bridge/RuntimeBridge.mock.test.ts` (sendInput 케이스 2)
- `app/src/runtime/bridge/approvalProtocol.ts` (신규)
- `app/src/runtime/bridge/approvalProtocol.test.ts` (신규, 8 케이스)
- `app/src/runtime/contracts/SkillExecution.ts` (`approval_required` variant +
  `ApprovalKind`)
- `app/src/runtime/adapters/runViaBridge.ts` (approvalRequest 매핑 + stderr
  휴리스틱 적용)
- `app/src/runtime/adapters/runViaBridge.test.ts` (신규)
- `app/src/runtime/adapters/CodexAdapter.ts` (default 에서 sandbox bypass 제거)
- `app/src/runtime/adapters/CodexAdapter.test.ts` (C7 갱신, spy stub 에
  sendInput 추가)
- `app/src/runtime/adapters/ClaudeAdapter.test.ts` (spy stub 에 sendInput 추가)
- `app/src/runtime/probe/probeCli.test.ts` (spy stub 에 sendInput 추가)
- `app/src/runtime/adapters/approvalForwarding.integration.test.ts` (신규)
- `app/src/runner/runLogStore.ts` (`pendingApprovals`, `resolvePendingApproval`,
  appendEvent / setNodeResult / reset 확장)
- `app/src/runner/runLogStore.test.ts` (L5/L6/L7 추가, L4 갱신)
- `app/src/components/layout/ApprovalPrompt.tsx` (신규)
- `app/src/components/layout/ApprovalPrompt.test.tsx` (신규, 4 케이스)
- `app/src/components/layout/LogPanel.tsx` (pendingApprovals 인라인 렌더 +
  `runtimeBridgeOverride` prop + sendInput 와이어업)
- `app/src/components/layout/layout.test.tsx` (LogPanel approval 케이스 +
  `useRunLogStore.reset()` setup)
- `app/src/styles/global.css` (`.run-log__line--approval`, `.approval__*`)
- `circuit_implementation_plan/phases/16-interactive-approval-forwarding-briefing.md`
  (본 문서, 신규)

## Verification

- [x] `RuntimeBridge` per-runId Channel 마이그레이션 + 14 회귀 케이스 통과 —
  `npm --prefix app run test:run` 이 38 files / 271 cases 통과.
- [x] `bridge.sendInput(runId, text)` 가 child stdin 에 write — Rust
  `runtime_send_input` 이 `write_all + flush`, JS `TauriRuntimeBridge.sendInput`
  이 invoke. Mock spy 가 호출을 기록 (RuntimeBridge.mock.test 추가 케이스).
- [x] codex trust prompt → `approval_required` 매핑 —
  `approvalProtocol.detectApprovalPrompt` (8 케이스) + `runViaBridge` 통합
  (runViaBridge.test 2, 통합 I1/I2/I4).
- [x] LogPanel inline + Allow → `y\n` stdin — `ApprovalPrompt.test` (trust
  allow / deny / freeform / dismiss) + `layout.test` LogPanel 케이스에서
  `runtimeBridgeOverride.sendInput` 이 `("run_42", "y\n")` 로 호출됨을 확인.
- [x] 응답 후 정상 진행 → success, pendingApprovals 비움 — 통합 I1 (success +
  sentInputs 검증) + store 의 setNodeResult 가 노드별 pending 정리 (L7).
- [x] 어댑터 default = `codex exec <prompt>`, sandbox 안 끔 — CodexAdapter.C7
  가 args 길이·내용·금지 플래그를 함께 검증.
- [x] MockRuntimeBridge scenario 기반 7+ 테스트 —
  `approvalForwarding.integration.test` 의 I1~I7 (정확히 7 케이스, 트러스트
  허용·거부·freeform·multi-prompt·timeout·non-resolve·parallel).
- [ ] (수동) 사용자 환경에서 codex 가 처음 보는 디렉토리로 노드 실행 →
  LogPanel prompt → Allow → 진행 — takeoff 직전 수동 캡처 단계로 이월.
  Open Question 2 (codex 가 pipe 모드에서 trust prompt 를 suppress 하는지)
  와 함께 한 번에 검증할 예정.

### 실행 방법

```sh
# Vitest (38 files / 271 cases)
npm --prefix app run test:run

# 컴파일 (tsc + vite + cargo)
npm --prefix app run build
cargo check --manifest-path app/src-tauri/Cargo.toml
```

## Tests

- 신규 unit / integration: 위 §"Implemented" 마지막 줄 (총 신규 27).
- 모든 Vitest 통과: 38 files / 271 cases.
- Tauri `cargo check` 깨끗 (warning 0, error 0).

## Runtime Notes

- **Channel 라이프사이클**: `TauriRuntimeBridge` 는 첫 `subscribe(runId, ...)`
  나 `spawn({ runId, ... })` 호출 시 per-runId `Channel<unknown>` 을 생성해
  `bindings` 맵에 보관. 모든 listener 가 unsubscribe 되면 (그리고 spawn 이
  아직 invoke 되지 않았으면) 정리. spawn 후에는 terminal 이벤트 (`exited`,
  `cancelled`, `timeout`, `error`) 가 들어왔을 때 정리.
- **stdin 종료 시점**: 자식이 종료되면 (`exited`/`cancelled`/`timeout`/`error`
  중 어느 경로든) spawn task 가 `stdin_slot` 을 None 으로 비운다. 이후 호출된
  `runtime_send_input` 은 `stdin already closed` 로 reject.
- **Approval timeout 정책**: 본 phase 는 별도 timeout 을 도입하지 않는다.
  CIR-26 의 `execution.timeoutMs` 가 그대로 적용 — 사용자가 응답하지 않고
  timeoutMs 가 지나면 child 는 OS 레벨에서 kill 되고 `timeout` 이벤트가 흐른다
  (통합 I5 가 회귀 보장).
- **Multi-prompt 주문**: codex 가 같은 run 안에서 trust → approve-command 를
  순차로 띄우면 첫 prompt 에 응답한 직후 두 번째가 새 `requestId` 로 등록된다
  (통합 I4 가 검증).
- **Parallel 노드**: 두 노드가 동시에 prompt 를 띄워도 store 의
  `pendingApprovals` 는 requestId 키이므로 충돌 없이 둘 다 보관 (통합 I7).
- **휴리스틱 위치**: detection 은 JS 측 단일 위치 (`runViaBridge`). Rust 의
  `ApprovalRequest` variant 는 mock scenario / 향후 JSONL 모드 등에서
  Rust 가 직접 prompt 를 인식할 때 쓸 surface — 현재 prod 경로는 휴리스틱
  하나만 통과한다.

## Known Limitations

- **휴리스틱은 정규식 기반.** codex 가 메시지 문구를 바꾸거나 색상
  코드/유니코드 표시기를 섞으면 매치가 깨진다. takeoff 직전 실측 단계에서
  실제 stderr 라인을 캡처해 패턴을 보강해야 한다 (Open Question 2).
- **codex 가 isatty=false 에서 prompt 자체를 suppress 할 가능성**. 만약
  suppress 된다면 본 phase 의 forwarding 은 trigger 되지 않으며 PTY 도입
  (별 phase) 이 필요하다. 사용자 수동 캡처 결과로 결정.
- **claude / 기타 CLI 의 prompt 패턴은 미등록.** 1차는 codex 만. claude 의
  대화형 응답이 필요해지면 동일 헬퍼에 패턴을 한 줄 추가하고 회귀 케이스
  기록.
- **Approval 의 영속화 안 함**. `pendingApprovals` 는 in-memory 만. 새로고침
  하면 사라지고, past run 을 LogPanel 에서 다시 로드해도 prompt 는 복원되지
  않는다 (이미 응답이 끝난 상태에서 의미 없음).
- **`onDismiss`** 는 사용자에게 "응답 안 보내고 LogPanel 에서 숨김" 만 제공
  하고 child 는 여전히 살아있는 상태다 — 본질적으로는 cancel 이 권장.
  현재 UX 가 그 차이를 명시하지 않으므로 추후 라벨 보강 여지.

## Next Recommendation

1. **codex `--json` 모드 통합** — Open Question 3. `codex exec --json` 으로
   바꾸면 `approval_required` 같은 정형 이벤트가 stderr 의 free text 대신
   JSONL 로 들어와 휴리스틱이 사라진다. takeoff 후 codex 출력 캡처 결과로
   별 phase 로 분리.
2. **claude 의 forwarding 지원** — `--allowed-tools` 가 거부했을 때 claude
   가 띄우는 prompt 패턴을 등록.
3. **Approval timeout 옵션** — 사용자가 일정 시간 (예: 30s) 응답이 없으면
   자동 deny 로 가는 옵션. 현재는 `execution.timeoutMs` 만 의존.
4. **PTY spawn 옵션** — codex 가 pipe 모드에서 prompt 를 suppress 하면 PTY
   spawn 옵션을 같은 어댑터에 추가. 비용·복잡도 trade-off 확인 후 결정.
5. **LogPanel approval 역사 보존** — 응답한 prompt 와 응답을 별도 list 로
   남겨 디버깅·감사 로그로 활용. 현재는 응답 즉시 사라진다.
