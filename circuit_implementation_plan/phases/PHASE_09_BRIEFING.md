# Phase 9 Briefing — Runtime Bridge (CIR-20)

## Implemented

- Frontend `RuntimeBridge` 인터페이스: `readFile`, `spawn`, `cancel`, `subscribe`. 이벤트 union: `started` / `stdout` / `stderr` / `exited` / `cancelled` / `timeout` / `error`.
- 디스패처 `getRuntimeBridge()`: `window.__CIRCUIT_RUNTIME__` 주입(테스트/모킹) 우선, 없으면 lazy-loaded `tauriRuntimeBridge`. 기존 `host/bridge.ts` 의 `__CIRCUIT_BRIDGE__` 패턴 그대로.
- Frontend `pathPolicy`: `assertInsideRepoRoot(path, repoRoot)` 1차 가드 (정규화 후 prefix 비교, `..` 트래버설 거부).
- Mock RuntimeBridge: deterministic in-memory 구현. file map + scenario 함수로 시나리오 재생, cancel/timeout 분기 검증, listener 멀티 구독·언구독 지원.
- Tauri tauriRuntimeBridge: `invoke` + `listen("runtime://event")` 페이로드 필터링.
- Tauri backend (`runtime_bridge.rs`):
  - `runtime_read_file` — `Path::canonicalize` 후 repo root prefix 검증, 1 MiB 사이즈 가드.
  - `runtime_spawn` — `tokio::process::Command` + `BufReader::lines()` 로 stdout/stderr 라인 streaming. `tokio::select!` 으로 `wait` / `timeout` / `cancel` 경합. timeout/cancel 발생 시 `kill` + 해당 이벤트 emit. 잔여 라인 drain 후 종료.
  - `runtime_cancel` — `Mutex<HashMap<RunId, oneshot::Sender>>` 에서 sender 꺼내 `send(())` (idempotent).
  - 이벤트 채널: 단일 `runtime://event` (페이로드에 `runId` 포함) → 복수 listener 가 동일 채널을 공유하고 클라이언트가 필터.
- `lib.rs`: 모듈 선언, `manage(RuntimeBridgeState::default())`, `invoke_handler!` 에 세 command 등록.
- `Cargo.toml`: `tokio` features `process / io-util / rt-multi-thread / macros / time / sync`.

## Changed Files

- `app/src/runtime/bridge/RuntimeBridge.ts` — 인터페이스 + 디스패처.
- `app/src/runtime/bridge/RuntimeBridge.tauri.ts` — invoke/listen 구현.
- `app/src/runtime/bridge/RuntimeBridge.mock.ts` — 테스트 mock.
- `app/src/runtime/bridge/RuntimeBridge.mock.test.ts` — 6 테스트 (read/scripted stream/cancel/timeout/unsub/pending cleanup).
- `app/src/runtime/bridge/RuntimeBridge.dispatch.test.ts` — 디스패처 2 테스트.
- `app/src/runtime/safety/pathPolicy.ts` — frontend path 가드.
- `app/src/runtime/safety/pathPolicy.test.ts` — 8 테스트.
- `app/src-tauri/src/runtime_bridge.rs` — backend 구현 + 4 cargo 테스트.
- `app/src-tauri/src/lib.rs` — command 등록.
- `app/src-tauri/Cargo.toml` / `Cargo.lock` — tokio 의존성.

## Verification

| 수락 기준 | 확인 방법 | 결과 |
| --- | --- | --- |
| Frontend 가 native API 직접 호출 안 함 | `RuntimeBridge.ts` 만 export, `invoke` import 는 `RuntimeBridge.tauri.ts` 에 격리 | OK |
| `RuntimeBridge` interface 존재 | `app/src/runtime/bridge/RuntimeBridge.ts` | OK |
| Tauri command 로 repo-local 파일 읽기 | `runtime_read_file` + cargo `read_file_returns_content_inside_repo_root` | OK |
| repo root 밖 path 거부 | `pathPolicy.test.ts` (frontend) + cargo `read_file_rejects_path_outside_repo_root` / `read_file_rejects_traversal_escape` | OK |
| stdout/stderr 이벤트 UI 까지 전달 | mock `delivers scripted stdout / stderr / exited events in order` + tauri 채널 `runtime://event` | OK (mock 검증) |
| process cancel 가능 | mock `emits cancelled event when cancel is called mid-stream` + Rust `oneshot` cancel arm | OK (mock 검증) |
| timeout 가능 | mock `emits a timeout event when the scenario produces one` + Rust `tokio::time::sleep` arm | OK (mock 검증) |
| mock bridge 가 테스트에서 사용 가능 | 위 mock 테스트 16개 통과 | OK |

실행 명령:

```bash
cd app
pnpm test:run         # Vitest 122 / 122 pass
pnpm build            # tsc + vite 그린
cargo test --manifest-path src-tauri/Cargo.toml runtime_bridge  # 4 / 4 pass
cargo check --manifest-path src-tauri/Cargo.toml --tests        # warning 0
```

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `RuntimeBridge.mock.test.ts` | 8 (readFile 3 + spawn 5) | scripted stream / cancel / timeout / unsubscribe / pendingRunIds cleanup |
| `RuntimeBridge.dispatch.test.ts` | 2 | 주입 우선, fallback 객체 shape |
| `pathPolicy.test.ts` | 8 | inside / sibling-prefix / escape / normalize / throw |
| `runtime_bridge::tests` (Rust) | 4 | 정상 read / 외부 거부 / traversal / oversize |

전체: Vitest 122 passed, Cargo 4 passed.

## Runtime Notes

- Phase 09 는 RuntimeBridge **경계** 만 도입한다. UI 에서 실제로 이벤트를 구독해 화면에 띄우는 코드는 추가하지 않았다 (다음 Phase 10 의 RealWorkflowRunner 가 첫 consumer 가 될 예정).
- Tauri command 는 `tauri.conf.json` 의 별도 capabilities 추가 없이 동작한다 (직접 Rust command 라 plugin allowlist 불필요). 단, frontend 가 `@tauri-apps/api/event` 의 `listen` 을 호출하려면 기본 `core:event:default` capability 가 필요한데 Tauri 2 의 `default()` 빌더가 이를 포함하므로 별도 작업 없음.
- `runtime_read_file` 는 1 MiB 까지만 허용. 더 큰 파일은 Phase 10 에서 streaming 구조로 별도 처리하거나 SKILL.md 같은 텍스트 자산만 보낸다.
- `runtime_spawn` 의 stdout/stderr 라인 분리는 ASCII line break 기준이라 멀티바이트 입력 안전. 매우 긴 단일 라인은 `BufReader::lines` 의 내부 버퍼 한계까지 누적 후 분할될 수 있으나 MVP 수용.
- 단일 채널 `runtime://event` + payload `runId` 패턴이라 무관한 listener 가 늘어날수록 client filtering 비용이 증가. RunId 필터 fanout 이 실측 부담이 되면 채널을 `runtime://event/<runId>` 로 분리할 여지를 남긴다.
- Phase 종료 시점에 워크트리는 origin 미설정 — push/PR 미수행. 본 브리핑은 PR 본문 또는 Linear 코멘트로 갈음 가능.

## Known Limitations

- Claude / Codex adapter 미구현 (의도적 — Out of Scope).
- workflow graph traversal, real skill prompt construction, 임의 shell command, git command spawn 미지원 (Out of Scope).
- Rust 측 spawn/cancel/timeout 의 통합 테스트 없음. mock 시나리오로 frontend 계약은 검증되지만, 실제 child process 의 종료 시그널·zombie reap 동작은 다음 Phase 의 e2e 또는 Tauri 통합 테스트에서 추가 검증 필요.
- Playwright 시나리오 부재. UI 가 RuntimeBridge 를 직접 사용하지 않는 시점이라 본 Phase 에서 e2e 테스트는 도입하지 않았다.
- `runtime_read_file` 의 1 MiB 가드는 임의값. 운영하면서 SKILL.md 평균/최대 크기로 캘리브레이션 예정.
- `pathPolicy` (frontend) 와 `validate_inside_repo_root` (backend) 의 path 정규화 규칙이 미세하게 다를 수 있음 (frontend 는 lexical, backend 는 canonicalize). 보안 source of truth 는 backend.

## Next Recommendation

- **Phase 10 — RealWorkflowRunner**: workflow graph traversal 위에서 RuntimeBridge 를 첫 사용. node ID 별 RunSession 매니저 + previous outputs 결합 + UI streaming 패널.
- **Provider Adapter (Phase 11+)**: `ClaudeAdapter` / `CodexAdapter` 가 SKILL.md 를 읽어 prompt 구성 후 RuntimeBridge.spawn 호출. 본 Phase 의 read/spawn 인터페이스 재사용.
- **safety/commandPolicy.ts, timeoutPolicy.ts**: RUNTIME_ARCHITECTURE.md 에 자리만 잡혀 있고 구현 미착수. shell/git 어댑터 도입 시점에 함께 추가.
- **Capabilities/allowlist 정비**: Phase 10 에서 실제 spawn 대상이 늘어나면 `tauri.conf.json` 의 ACL 검토.
- **Origin 셋업**: `/takeoff` 가 동작하려면 GitHub remote 가 필요. 본 Phase 는 로컬 머지 또는 takeoff 까지 보류 상태.
