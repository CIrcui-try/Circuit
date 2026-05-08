# `workspace/` — Phase 2 Lifecycle + Phase 3 Turn 경계 + Phase 4 Reconcile

Phase 2 (CIR-30) 가 워크스페이스 lifecycle 의 mutex / cleanup / abort / recover / cold_resume 를 마련했고, Phase 3 (CIR-31) 가 그 위에 **turn 경계 = resume 입자 = 체크포인트** 모델을 못박았다. Phase 4 (CIR-32) 는 Store ↔ Workspace 가 어긋날 때의 처리 정책을 단일 진입점 `reconcile` 로 모아 **Store = source of truth** 명제를 강제한다. 본 모듈은 코딩 에이전트가 git 워킹트리 단위로 attach·detach·cleanup·resume 하면서 turn 단위로만 evict / rollback 되도록 보장한다.

## 책임 경계

| 컴포넌트 | 책임 |
| -- | -- |
| `WorkspaceManager` | acquire / release / begin_turn / commit_turn / cleanup / abort / recover / cold_resume — 모든 lifecycle entry-point |
| `Workspace` | 단일 워크스페이스의 mutex 점유 (`Idle / Attached / Aborting / Cleaning / Removed`), in-flight turn 마커, CancellationToken |
| `WorkspaceMetadata` | HEAD commit / branch / dirty 파일 / stash ref / disk_path / last_turn 스냅샷 |
| `WorkspaceStore` | 디스크에 metadata + JSONL action log + stash bundle 저장 |
| `git_ops` | clone / fetch / checkout / status / stash save·apply · bundle export·import 의 shell-out 래퍼 |
| `ttl::tick` | Idle workspace 의 last-turn 시각 + TTL 비교 후 만료된 것만 cleanup |

## API 사용 예 (요약)

```rust
use std::time::Duration;
use app_lib::workspace::{WorkspaceManager, WorkspaceStore};

let store = WorkspaceStore::open("/var/lib/circuit/store").await?;
let mgr = WorkspaceManager::new(
    "/var/lib/circuit/workspaces",
    store,
    Duration::from_secs(15 * 60),
).await?;

// 1. 점유
let ws = mgr.acquire("alice", "https://github.com/foo/bar.git").await?;

// 2. turn 단위로 작업. begin / commit 사이가 in-flight 구간이고, 그 동안에는
//    cleanup / TTL evict 모두 거부된다.
mgr.begin_turn(&ws, 1).await?;
// ... tool call / 파일 변경 / sub-agent ...
mgr.commit_turn(&ws).await?;        // 변경사항이 git commit 으로 settle, last_turn 영속

// 3a. 정상 detach
ws.release().await?;
mgr.cleanup(&ws).await?;            // 메타·stash 영속, 디스크 제거

// 3b. 또는 강제 abort
ws.abort().await?;                   // CancellationToken 전파, in-flight 도구 호출 중단
ws.release().await?;

// 4. 재기동 후 (다른 프로세스)
let recovered = mgr.recover(&ws_id).await?;
// disk_ok 면 in-flight turn 을 base_head 로 reset_hard 후 재등록.
// disk 가 사라졌으면 cold_resume 으로 마지막 settled HEAD 까지 재구성.
```

## 인수 기준 ↔ 구현 매핑

| Linear 인수 기준 | 구현 |
| -- | -- |
| **Phase 2** | |
| 1 workspace = 1 active session mutex | `Workspace::attach` 의 `state == Idle` 가드 |
| 같은 user+repo 동시 task → 별도 clone | `WorkspaceManager::acquire` 가 contention 시 `<root>/<user>/<slug>-<n>` |
| Idle TTL cleanup (메타→Store, 디스크 제거) | `WorkspaceManager::cleanup` + `ttl::tick` |
| 강제 종료 → 마지막 완료 turn 시점 정리 | `Workspace::abort` + 메타의 `last_turn` 보존 |
| Cold path resume (re-clone + checkout + stash apply) | `WorkspaceManager::cold_resume` |
| **Phase 3 (CIR-31)** | |
| Turn 경계 evict (idle TTL 은 turn 사이에서만) | `ttl::is_idle_expired` 가 `active_turn.is_some()` 이면 false |
| Mid-turn evict 거부 | `WorkspaceManager::cleanup` 진입 가드 — in-flight 면 `Error::TurnInFlight` |
| 크래시 후 마지막 settled turn 으로 롤백 | `WorkspaceManager::recover` 가 액션 로그 스캔, 미완 `TurnBegin` 발견 시 `git_ops::reset_hard(base_head)` + `git clean -fd` |
| 통합 fuzz (무작위 종료 → resume → baseline 동일) | `tests/turn_resume_e2e.rs` — 5 시드 fingerprint 비교 |
| **Phase 4 (CIR-32)** | |
| Store=truth 단일 규칙 | `WorkspaceManager::reconcile` 의 3 갈래 결정 트리 + `ReconcileOutcome` |
| 외부 push / 사용자 직접 git → 액션 로그 기준 환원 | `try_replay` 가 `git reset --hard meta.head_commit` |
| Workspace 디스크 손상 / 누락 → cold path | `cold_resume` (변경 없음) + `ColdResumeReason::{MissingDisk, HeadUnreadable, ReplayFailed}` |
| 외부 divergence 통합 fuzz | `tests/external_divergence_e2e.rs` — 3 시나리오 |

## Phase 3: Turn 경계 모델

### 핵심 규칙

- **Turn = checkpoint = git commit.** `begin_turn` 이 base_head (현재 HEAD) 를 캡처하고, `commit_turn` 이 그 turn 동안 발생한 모든 변경을 단일 git commit 으로 settle 한다. 그래서 `commit_turn` 이 끝난 시점의 워크트리 상태는 항상 git 객체 DB 에 영속되어 있다.
- **In-flight = 보호 구간.** `active_turn` 마커가 설정된 동안 cleanup, idle TTL evict, recover 의 다른 turn 시작은 모두 거부 또는 무시된다.
- **롤백은 `base_head` 까지만.** 미완 turn 을 발견한 recover 는 `git reset --hard base_head` + `git clean -fd` 로 워킹트리를 turn 시작 시점 그대로 돌린다. 이전 turn 들의 commit 은 그대로 남는다.

### 액션 로그 스키마 (Phase 3 추가분)

| Variant | 의미 |
| -- | -- |
| `TurnBegin { turn_index, base_head }` | begin_turn 시점 — 롤백 시 이 `base_head` 로 reset 한다 |
| `TurnComplete { turn_index, head_commit, dirty_files }` | commit_turn 완료 — `head_commit` 은 turn 의 git commit, `dirty_files` 는 그 commit 의 변경 목록 |
| `TurnRollback { turn_index, rolled_back_to }` | recover 가 미완 turn 을 되감았음 — 액션 로그가 자기 기술적 |

`pending_turn_from_log` 헬퍼는 로그를 한 번 훑어 매칭되지 않은 마지막 `TurnBegin` 만 반환한다.

### 다음 phase 와의 연결

- **Phase 4 (Store ↔ Workspace 일관성)**: 본 phase 에서 `WorkspaceManager::reconcile` 로 정책을 단일화. `WorkspaceStore` trait 추출 / 다중 백엔드는 후속 phase.
- **Phase 5 (Warm pool)**: cold_resume 비용 측정 후 pre-cloned 워크스페이스 풀 구성. begin_turn 직전에 워밍된 클론을 attach 하는 hook.
- **Phase 6 (Sub-agent / nested turn)**: 본 phase 는 single in-flight turn / workspace 만 지원. RAII `TurnGuard`, sub-agent boundary 정책, nested rollback 은 phase 6 에서.

## Phase 4: Reconcile 정책

### 결정 트리

| 디스크 상태 | Store metadata 와의 관계 | Outcome | 액션 |
| -- | -- | -- | -- |
| `path.exists() == false` | (해당 없음) | `ColdResume { MissingDisk }` | `cold_resume` 으로 재 clone |
| `path.exists() && rev-parse HEAD` 실패 | `.git` 손상 | `ColdResume { HeadUnreadable }` | `cold_resume` |
| HEAD == `meta.head_commit` | 일치 | `HeadMatch` | 디스크 변경 없음, 그대로 등록 |
| HEAD != `meta.head_commit` | 외부 push / 사용자 commit / branch 이동 | `Replay { from, to }` | `git reset --hard meta.head_commit` + stash 재적용. 실패 시 `ColdResume { ReplayFailed }` 로 강등 |

세 갈래 모두 진입 시 액션 로그에서 미완 turn 을 먼저 스캔하여 (`TurnBegin` 이 `TurnComplete`/`TurnRollback` 없이 남아있는 경우) `base_head` 로 추가 reset 한 뒤 `TurnRollback` 을 append. 그 후 `StoreAction::Reconcile { strategy, before_head, after_head }` 가 항상 마지막에 append 되어 액션 로그가 자기 기술적이다.

### Store = source of truth

워크스페이스가 git 차원에서 어떤 상태든 (외부 push, 직접 commit, branch 전환, 손상, 통째 삭제) Reconcile 후의 disk HEAD 는 항상 `meta.head_commit` 과 같다. 워크스페이스에서 일어난 git 조작은 turn 경계 (`begin_turn` / `commit_turn`) 를 거치지 않는 한 보존되지 않는다. 사용자에게 분기 선택을 노출하는 인터랙티브 정책은 본 phase 에서 채택하지 않았다 — 항상 Store 우선 reset_hard.

### `recover` 와의 관계

`recover(id)` 는 `reconcile(id).map(|(ws, _)| ws)` 의 별칭으로 좁혀졌다. outcome 분기 정보가 필요 없는 호출자 (예: 단순 재기동 hook) 는 `recover` 를, 텔레메트리 / UX 분기에 outcome 이 필요한 호출자는 `reconcile` 을 직접 쓴다.

## 테스트

- 단위 테스트 (`cargo test --lib workspace::`): metadata snapshot / git_ops shell-out (reset_hard, commit_all 포함) / store round-trip / mutex / cleanup 가드 / abort / recover rollback / cold_resume / TTL skip in-flight.
- 통합 e2e:
  - `cargo test --test workspace_lifecycle_e2e` — golden flow / 동시성 / 크래시 복구 (디스크 보존) / 크래시 복구 (디스크 유실) / abort cancel.
  - `cargo test --test turn_resume_e2e` — 5 시드 fuzz, mid-turn 강제 종료 → recover → baseline fingerprint 일치.
  - `cargo test --test external_divergence_e2e` — 외부 push HEAD 이동 / 워크스페이스 디스크 누락 / 사용자 직접 git 조작 3 시나리오.

## 디스크 레이아웃

```
<store_root>/
  metadata/<workspace_id>.json         # 마지막 스냅샷
  actions/<workspace_id>.jsonl         # 액션 로그 (append-only)
  stashes/<workspace_id>/<stash_sha>   # bundle blob (cleanup 후 cold resume 용)

<workspace_root>/
  <user_id>/<slug>-<n>/                # 실제 git 워킹트리
```

## 주의

- 시스템에 `git` CLI 가 있어야 한다 (libgit2 미사용).
- `WorkspaceManager::cleanup` 과 `git_ops::reset_hard` 는 destructive — 전자는 `ensure_inside` 가드로 workspace_root 외부 경로 삭제 차단, 후자는 호출자가 SHA 출처 (액션 로그의 `TurnBegin.base_head`) 를 검증한 뒤에만 실행한다.
- `commit_turn` 호출 없이는 idle TTL 이 발동하지 않는다 (의도적 — cold-start-only 워크스페이스를 보호).
- `commit_turn` 은 워크스페이스 안에서 git commit 을 만든다. user.email/user.name 은 inline `-c` 로 `cir31-workspace` 를 강제하므로 호스트의 global git config 가 비어있어도 동작한다.
