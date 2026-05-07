# `workspace/` — Phase 2 Workspace Lifecycle

CIR-30 의 구현체. Linear 프로젝트 *Coding Agent 세션 관리 / Cold Start* 설계 문서 v2 §2 의 정의를 따른다. 본 모듈은 코딩 에이전트가 git 워킹트리 단위로 attach·detach·cleanup·resume 하는 lifecycle 을 제공한다.

## 책임 경계

| 컴포넌트 | 책임 |
| -- | -- |
| `WorkspaceManager` | acquire / release / cleanup / abort / recover / cold_resume — 모든 lifecycle entry-point |
| `Workspace` | 단일 워크스페이스의 mutex 점유 (`Idle / Attached / Aborting / Cleaning / Removed`), CancellationToken |
| `WorkspaceMetadata` | HEAD commit / branch / dirty 파일 / stash ref / disk_path / last_turn 스냅샷 |
| `WorkspaceStore` | 디스크에 metadata + JSONL action log + stash bundle 저장 |
| `git_ops` | clone / fetch / checkout / status / stash save·apply · bundle export·import 의 shell-out 래퍼 |
| `ttl::tick` | Idle workspace 의 last-turn 시각 + TTL 비교 후 만료된 것만 cleanup |

## API 사용 예 (요약)

```rust
use std::time::Duration;
use app_lib::workspace::{WorkspaceManager, WorkspaceStore, TurnBoundary};

let store = WorkspaceStore::open("/var/lib/circuit/store").await?;
let mgr = WorkspaceManager::new(
    "/var/lib/circuit/workspaces",
    store,
    Duration::from_secs(15 * 60),
).await?;

// 1. 점유
let ws = mgr.acquire("alice", "https://github.com/foo/bar.git").await?;

// 2. tool call 실행 ... 끝나면 turn 경계 기록
ws.record_turn(TurnBoundary::now(1)).await;

// 3a. 정상 detach
ws.release().await?;
mgr.cleanup(&ws).await?;          // 메타·stash 영속, 디스크 제거

// 3b. 또는 강제 abort
ws.abort().await?;                  // CancellationToken 전파, in-flight 도구 호출 중단
ws.release().await?;

// 4. 재기동 후 (다른 프로세스)
let recovered = mgr.recover(&ws_id).await?; // 디스크 살아있으면 재등록, 없으면 cold_resume 폴백
```

## 인수 기준 ↔ 구현 매핑

| Linear 인수 기준 | 구현 |
| -- | -- |
| 1 workspace = 1 active session mutex | `Workspace::attach` 의 `state == Idle` 가드 |
| 같은 user+repo 동시 task → 별도 clone | `WorkspaceManager::acquire` 가 contention 시 `<root>/<user>/<slug>-<n>` |
| Idle TTL cleanup (메타→Store, 디스크 제거) | `WorkspaceManager::cleanup` + `ttl::tick` |
| 강제 종료 → 마지막 완료 turn 시점 정리 | `Workspace::abort` + 메타의 `last_turn` 보존 |
| 크래시 복구 (메타+디스크 검증, 실패 시 액션 로그 replay) | `WorkspaceManager::recover` 가 disk_ok 확인 후 cold_resume 폴백 |
| Cold path resume (re-clone + checkout + stash apply) | `WorkspaceManager::cold_resume` |

## 다음 phase 와의 연결

본 모듈은 의도적으로 **다음 phase 들의 dependency** 만 만들어 두고 멈춘다.

- **Phase 3 (Resume granularity)**: 본 phase 의 `TurnBoundary` 는 placeholder. 실제 turn emitter 와 sub-agent boundary 정책은 phase 3 에서 추가.
- **Phase 4 (Store ↔ Workspace 일관성)**: 현재 `WorkspaceStore` 는 파일시스템 기반 단일 구현. 일관성 정책 도입 시 trait 추출 예정.
- **Phase 5 (Warm pool)**: cold_resume 의 비용을 측정하면 warm pool 의 후보 (pre-cloned workspace) 가 본 모듈에 hook 으로 들어온다.
- **Phase 6 (Hardening)**: long-running tool call 강제 종료 정책, sub-agent 컨텍스트 보존, 외부 git push 충돌 처리 등.

## 테스트

- 단위 테스트 (`cargo test --lib workspace::`): 47 cases — metadata snapshot / git_ops shell-out / store round-trip / mutex / cleanup / abort / recover / cold_resume / TTL.
- 통합 e2e (`cargo test --test workspace_lifecycle_e2e`): 5 cases — golden flow / 동시성 / 크래시 복구 (디스크 보존) / 크래시 복구 (디스크 유실) / abort cancel.

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

- 시스템에 `git` CLI 가 있어야 한다 (Phase 2 는 libgit2 미사용).
- `WorkspaceManager::cleanup` 은 destructive — `ensure_inside` 가드로 workspace_root 외부 경로 삭제 차단.
- `record_turn` 호출 없이는 idle TTL 이 발동하지 않는다 (의도적 — cold-start-only 워크스페이스를 보호).
