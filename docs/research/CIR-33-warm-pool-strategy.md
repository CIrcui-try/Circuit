# CIR-33 — Warm Pool 전략 결정 문서

> Linear: [CIR-33](https://linear.app/enebin-test/issue/CIR-33/phase-5-warm-pool-전략) · Project: **Coding Agent 세션 관리 / Cold Start** · Phase 5.
>
> 본 문서는 풀 종류·사이즈·eviction·pre-warm 트리거의 결정과 그 근거를 못 박는다. 구현은 `app/src-tauri/src/workspace/pool.rs`, 정합 정책은 같은 디렉토리의 `README.md` Phase 5 절을 참조.

## 1. 입력

[CIR-29](./CIR-29-cold-start-measurement-plan.md) 가 cold-start 비용을 (a) agent runtime / (b) MCP / (c) workspace 준비 / (d) code index 4단계로 분해해 측정 *방법론* 만 정의한 상태다. 실측 보고서는 별도 레포·후속 이슈에 위임되어 있어 본 phase 시작 시점에는 데이터가 없다.

CIR-29 §7 의 가설 — "(c) 또는 (d) 가 가장 비쌀 가능성이 높다" — 과 본 레포의 구조 (인덱싱 파이프라인이 없고, agent runtime / MCP 부팅은 별도 프로세스 책임이며 `WorkspaceManager` 가 직접 호출하는 건 `git_ops::clone` 뿐) 를 합쳐 보면, 본 레포 내에서 `WorkspaceManager::acquire` 를 호출하는 cold path 의 비용은 사실상 (c) clone 이 지배한다. 따라서 본 phase 의 결정 입력은 **"(c) 가 지배적"** 이라는 가설이다.

## 2. 가장 비싼 단계 식별

| 단계 | 본 레포 내 비용 | 비고 |
| -- | -- | -- |
| (a) agent runtime | 본 레포 범위 밖 | tauri 부팅과 별개 |
| (b) MCP 부팅 | 본 레포 범위 밖 | runtime_bridge 가 spawn 하나, warm pool 의 대상은 아님 |
| (c) workspace 준비 | **`WorkspaceManager::acquire` 의 `git_ops::clone`** | repo 크기에 비례, 수 초~수 분. 본 phase 의 직접 타겟. |
| (d) code index | 본 레포에 인덱서 없음 | 추후 phase 에서 (d) 가 도입되면 별도 결정 |

→ 본 phase 의 직접 절감 대상은 (c). CIR-29 §6 의 권고 트리에서 "(c) 의 기여도 > 50% → pre-cloned workspace pool" 분기에 해당.

## 3. 결정

### 3.1 풀 종류 — per-workspace pool 채택

| 후보 | 채택 | 사유 |
| -- | -- | -- |
| Generic Session pool (repo-agnostic) | ❌ | 본 레포의 cold path 비용이 `git_ops::clone(repo_url, …)` 로 repo 마다 다름. repo 추상의 generic 풀로는 (c) 절감 불가. |
| **Per-workspace pool** (key = `(user_id, repo_url)`) | ✅ | (c) 의 비용이 repo 단위로 분리되며 user 별 isolation 도 키로 자연스럽게 충족. |
| 혼합 (per-repo + 별도 generic) | ❌ | 본 레포에는 generic 풀이 절감할 단계가 없음. 복잡도만 증가. |

### 3.2 풀 사이즈

`max_per_key = 2`, `max_total = 16`. 근거:

- `max_per_key = 2`: 같은 user+repo 의 동시 task 가설 (Phase 2 의 `acquire` 가 이미 contention 시 `<slug>-<n>` 으로 별도 clone 을 만든다) 을 풀에서도 동일하게 다룰 수 있도록 최소 2 슬롯. 1 이면 동시 task 발생 시 곧장 cold path.
- `max_total = 16`: 단일 호스트에서 동시에 다룰 user × repo 조합의 가벼운 상한. 디스크 공간이 슬롯 수 × repo 크기 만큼 잡히므로 의미 없는 큰 값을 고르지 않음.

위 값들은 **실측 입력 없이 정한 초기 hyperparameter** 이며, §6 의 후속 hook 으로 재평가한다.

### 3.3 Eviction = LRU

- 풀에 슬롯이 들어오는 순간을 사용 시각으로 보고, `take` (hit) 가 발생하면 그 슬롯이 풀을 떠나므로 LRU 큐에서 제거된다.
- `max_per_key` / `max_total` 초과 시 가장 오래 미사용된 슬롯을 evict 후보로 반환. evict 된 슬롯은 호출자 (`WorkspaceManager`) 가 기존 `cleanup` 경로로 영속 + 디스크 제거.
- **Turn 경계와의 정합**: 풀에 들어오는 슬롯은 항상 `release_to_pool(ws)` 진입점을 거치며, `active_turn` 이 있으면 거부한다. 즉 풀에 머무는 슬롯의 HEAD 는 항상 settled — Phase 3 의 turn 경계 = checkpoint 모델과 어긋나지 않는다.

### 3.4 Pre-warm 트리거

- (T1) **명시 호출**: `WorkspaceManager::prewarm(user_id, repo_url, count)`. 같은 (user, repo) 에 `count` 개의 슬롯을 미리 채운다. 호출자 = 상위 runtime (예: 사용자가 repo 를 즐겨찾기 했을 때).
- (T2) **release-to-pool**: 정상 detach (`release_to_pool`) 가 슬롯을 풀에 넣는 그 자체가 다음 acquire 의 hit 가 된다. 별도 트리거 불필요.
- 자동 백그라운드 prefetch (예: idle 시간에 자주 쓰는 repo 미리 clone) 는 본 phase 범위 밖. 필요 신호가 관찰되면 후속 phase 로.

### 3.5 Isolation

- `PoolKey { user_id, repo_url }` 가 키. `take(key)` 는 **정확히 일치하는 키의 슬롯만** 반환한다. 다른 user 의 슬롯은 절대 받지 못한다.
- 풀 슬롯의 디스크 경로도 기존 `<workspace_root>/<user_id>/<slug>-<n>` 컨벤션을 그대로 사용 — user 별 디렉토리 자체가 OS 권한 격리의 1차 boundary.

### 3.6 Reconcile 통합

- `take` 로 풀에서 꺼낸 슬롯은 그대로 attach 하지 않고, Phase 4 의 `reconcile` 을 통과시킨 뒤 등록한다. 외부 divergence (디스크 손상·외부 git 조작) 에 대해 풀이 면역이 아니기 때문이다.
- 단, fast-path 인 `HeadMatch` 에서 끝나는 게 정상 case. `Replay` / `ColdResume` 가 자주 발생하면 풀이 절감하는 시간보다 reconcile 비용이 커질 수 있어 §6 의 후속 hook 에서 측정한다.

## 4. 인터페이스 요약

```rust
pub struct PoolKey { pub user_id: String, pub repo_url: String }

pub struct PoolStats { pub hits: u64, pub misses: u64, pub evictions: u64, pub size: usize }

impl WarmPool {
    pub fn new(max_per_key: usize, max_total: usize) -> Self;
    pub async fn take(&self, key: &PoolKey) -> Option<PooledSlot>;
    pub async fn put(&self, key: PoolKey, slot: PooledSlot) -> Option<PooledSlot>; // returns evicted
    pub async fn stats(&self) -> PoolStats;
}

impl WorkspaceManager {
    pub fn with_pool(self, pool: Arc<WarmPool>) -> Self;
    pub async fn release_to_pool(&self, ws: &Arc<Workspace>) -> Result<()>;
    pub async fn prewarm(&self, user_id: &str, repo_url: &str, count: usize) -> Result<()>;
}
```

## 5. 목표 (관측 가능한 시그널)

본 phase 의 p95 cold-start 절감은 풀 hit 시 `git_ops::clone` 호출이 발생하지 않는다는 사실로 환산된다. 통합 테스트가 다음을 검증한다:

1. 같은 user+repo 재요청 시 `pool.stats().hits` 가 1 증가 — clone 미발생.
2. `prewarm(count=N)` 직후 첫 `acquire` 가 hit.
3. 다른 user 가 같은 repo 로 acquire 해도 hit 가 발생하지 않음 (isolation).
4. `max_total` 초과 시 LRU 슬롯이 evict 되고 호출자가 cleanup 경로로 정리한다.

실측 wall-clock 비교는 본 레포의 단위 테스트로는 의미가 없으므로 (clone 대상이 file:// 로컬 repo 라 ms 단위) §6 후속 실측 hook 에서 다룬다.

## 6. 후속 실측 hook

CIR-29 의 측정 보고서가 도착하면 다음 절차로 본 결정을 재평가한다.

1. (c) 가 cold_total 의 50% 이상이면 본 결정 유지. 30~50% 이면 `max_per_key` / `max_total` 만 조정.
2. (b) MCP 부팅이 30% 초과면 별도 phase 에서 generic MCP pool 추가 (per-workspace 풀과 별개).
3. (d) index 가 도입되고 50% 초과면 persistent index 캐시를 추가 — 풀 슬롯의 메타에 인덱스 포인터 부착.
4. Reconcile fast-path 비용이 풀 절감보다 크면 풀 슬롯에 한해 `HeadMatch` 까지만 검증하는 lightweight reconcile 도입 검토.

## 7. 본 phase 가 다루지 않는 것

- 풀 슬롯의 TTL — 시간 기반 만료는 본 phase 범위 밖. LRU 만 사용. 필요 신호가 관찰되면 후속 phase.
- 백그라운드 자동 prefetch — 사용 패턴 학습 기반 prefetch 는 본 phase 범위 밖.
- Pool persistence — 프로세스 재시작 시 풀은 비어있는 상태로 시작. 디스크에 남은 워크스페이스는 `cold_resume` / `reconcile` 에서 다뤄진다.
- Pre-warmed MCP / index pool — 위 §6 에 따라 후속 결정.
