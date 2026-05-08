# CIR-34 — Hardening / 미해결 항목 결정 문서

> Linear: [CIR-34](https://linear.app/enebin-test/issue/CIR-34/phase-6-hardening-미해결-항목) · Project: **Coding Agent 세션 관리 / Cold Start** · Phase 6.
>
> 본 문서는 v2 design §6 의 미해결 항목 — (1) Long-running tool call evict 정책, (2) 동시 task per repo 임계, (3) Sub-agent context cache — 의 결정과 그 근거를 못 박는다. 정합 정책은 `app/src-tauri/src/workspace/README.md` Phase 6 절을 참조.

## 1. 입력

Phase 1–5 의 산출물이 본 phase 의 입력이다.

| Phase | 산출물 | 본 phase 가 활용하는 부분 |
| -- | -- | -- |
| 1 (CIR-29) | cold-start 측정 *계획* | 데이터 부재 시 권고 트리. 실측 보고서는 별도 레포 위임. |
| 2 (CIR-30) | `WorkspaceManager::acquire` / `cleanup` / `abort` / `cold_resume` lifecycle | 동시 task 의 `<slug>-<n>` 분기가 결정 (2) 의 baseline. |
| 3 (CIR-31) | turn 경계 = checkpoint 모델 | `Error::TurnInFlight` 거부가 결정 (1) 의 baseline. |
| 4 (CIR-32) | Store = source of truth, 단일 진입점 `reconcile` | Store action log 가 표현하는 transition 집합이 결정 (1) 의 옵션 공간 제약. |
| 5 (CIR-33) | per-`(user_id, repo_url)` `WarmPool`, settled HEAD 보장 | `max_per_key` / `max_total` 가설이 결정 (2) 의 재평가 대상. |

본 레포 내 실측 데이터는 여전히 없다. 따라서 본 phase 의 결정은 모두 가설 + 후속 측정 hook 명시 형태다.

## 2. 결정

### 2.1 결정 1 — Long-running tool call: (B) 직전 settled turn 으로 롤백 채택

분 단위 build / test 같은 도구 호출이 turn 안에서 길어지고 외부에서 evict 시도가 들어왔을 때의 정책.

| 후보 | 채택 | 사유 |
| -- | -- | -- |
| (A) 부분 결과 보존 — 진행 중 산출물을 별도 stash / log 로 남기고 다음 resume 때 이어가기 | ❌ | Phase 4 Store action log 는 `Acquire` / `TurnBegin` / `TurnCommit` / `Stash` / `Cleanup` 만 다룬다. "부분 결과" 를 표현할 transition 이 없어 신규 action 타입 + reconcile 경로 추가가 필요. 단일 진입점 가정 (Phase 4) 과 충돌. |
| **(B) 직전 settled turn 으로 롤백** — turn 외부 evict 는 거부, 사용자가 명시 abort 하면 in-flight turn 만 cancel 후 last settled HEAD 로 복귀 | ✅ | Phase 3 turn 경계 모델의 자연스러운 귀결. `cleanup` / `release_to_pool` 의 `Error::TurnInFlight` 거부가 이미 (B) 를 강제. Phase 5 풀 슬롯의 settled HEAD 보장과 정합. |

**운영 규칙**:

- turn 외부에서 호출된 evict (`cleanup`, `release_to_pool`, TTL tick, warm pool put) 는 `active_turn` 이 있으면 즉시 `Error::TurnInFlight` 로 거부한다. 호출자가 `commit_turn` 또는 `abort` 까지 wait 하거나 명시적으로 `abort` 후 evict 를 재시도하는 책임을 갖는다.
- 사용자가 명시 `abort` 한 경우 in-flight turn 의 working tree 변경은 last settled HEAD 로 reset 된다 (Phase 3 의 기존 동작). 도구 호출의 외부 부수효과 (네트워크, 외부 프로세스) 는 보존되지 않는다.
- 풀 반환은 항상 settled 슬롯만 — Phase 5 의 invariant 를 그대로 유지.

**코드 인용**:

- `app/src-tauri/src/workspace/manager.rs::cleanup` — `if ws.active_turn().await.is_some() { return Err(Error::TurnInFlight(…)); }` 가 (B) 의 1차 게이트.
- `app/src-tauri/src/workspace/manager.rs::release_to_pool` — 동일 가드. 풀에 들어가는 슬롯은 항상 settled.

### 2.2 결정 2 — 동시 task per repo: (A) 별도 clone 유지, 풀 슬롯 임계 `max_per_key=2` 유지

같은 사용자 + 같은 repo 에 두 task 가 거의 동시에 들어왔을 때의 정책.

| 후보 | 채택 | 사유 |
| -- | -- | -- |
| **(A) 별도 clone** — `acquire` 가 idle 슬롯 미존재 시 `<root>/<user_id>/<slug>-<n>` 으로 새 clone | ✅ | Phase 2 의 기존 동작. Phase 5 풀 hit 시 clone 비용 ≈ 0 으로 (A) 의 약점이 추가로 완화됨. |
| (B) 큐잉 fallback — 두 번째 task 를 첫 번째 task 의 release 까지 wait | ❌ | Lifecycle entry-point (`acquire`) 를 차단하면 turn 경계 (Phase 3) 가 다른 task 진입을 막아버려 dead-lock 위험 + 사용자 인지 가능한 latency 증가. clone 비용 실측 없이 큐잉 latency 와의 비교 불가. |

**임계 (Phase 5 hyperparameter 재확인)**:

- `WarmPool::new(max_per_key = 2, max_total = 16)` 을 본 phase 에서도 그대로 유지한다. 근거는 [CIR-33 §3.2](./CIR-33-warm-pool-strategy.md#32-풀-사이즈) 와 동일.
- 본 시점에 production 에서 `WarmPool::new` 를 호출하는 부트스트랩 사이트가 아직 없다 — 호출 사이트 도입 시 위 hyperparameter 를 단일 출처 (`workspace/README.md` Phase 6 매핑 표) 에서 인용한다.

**재평가 트리거**:

- cold clone p95 latency > 30s 이고 (`(user_id, repo_url)` 당 동시 task 의 median > 2) 이면 (B) 큐잉 fallback 도입 검토.
- 그 시점에 `max_per_key` / `max_total` 도 동시 task 분포 + 디스크 가용량 기준으로 재산정.

### 2.3 결정 3 — Sub-agent context cache: (A) 현재 가정 유지 (보존 안 함, 재실행)

비싼 sub-agent (장기 분석, 외부 API) 결과를 별도 cache 에 보존할지 여부.

| 후보 | 채택 | 사유 |
| -- | -- | -- |
| **(A) 보존 안 함, 매번 재실행** | ✅ | 본 레포에 sub-agent cache 구현이 없고, sub-agent 비용/재실행 hit ratio 의 실측치도 없음. Phase 1 권고 트리: 데이터 부재 시 단순 가정 유지. |
| (B) 비싼 sub-agent 결과를 별도 cache 에 보존 | ❌ | 보존 단위 (sub-agent 입력 hash? turn id? user/repo?) 와 무효화 정책을 정하려면 실측 hit ratio 가 필요. 본 phase 시점엔 부재. |

본 phase 는 코드 변경 없이 결정만 문서화한다.

**재평가 트리거**:

- sub-agent 평균 wall time > 측정 보고서가 정의할 임계 (예: 5s) 이고 동일 입력 재실행 hit ratio > 30% 이면 (B) cache 도입 검토.
- 그 시점에 cache key 단위 (`(user_id, repo_url, sub_agent_id, input_hash)`) 와 무효화 정책 (`turn commit` 시 무효화 vs. content-addressed) 을 별도 phase 로 결정.

## 3. 후속 실측 hook 요약

| 결정 | 재평가 트리거 메트릭 | 임계 | 다음 행동 |
| -- | -- | -- | -- |
| 1 (Long-running) | turn 평균 wall time p95 / TTL | p95 > TTL × 0.5 | (1A) 부분 결과 보존 재검토 + Store action 신규 transition 설계 |
| 2 (동시 task) | cold clone p95 / `(user, repo)` 동시 task median | clone p95 > 30s 이고 median > 2 | (2B) 큐잉 fallback 도입, `max_per_key` / `max_total` 재산정 |
| 3 (Sub-agent cache) | sub-agent wall time + 동일 입력 hit ratio | wall > 5s 이고 hit ratio > 30% | (3B) cache 도입, 키·무효화 정책 별도 phase |

위 메트릭은 모두 CIR-29 측정 보고서가 정의할 dimension 의 직접 부분이다. 보고서 도착 시 본 표를 단일 진입점으로 하여 결정 (1)–(3) 을 재평가한다.

## 4. 본 phase 가 다루지 않는 것

- 실측 데이터 수집 — CIR-29 위임. 본 phase 는 데이터 도착 시의 재평가 절차만 정의.
- Store action log 의 신규 transition (부분 결과 보존용) — 결정 (1A) 채택 시점의 별도 phase.
- Sub-agent cache 구현 — 결정 (3B) 채택 시점의 별도 phase.
- 큐잉 fallback 의 동시성 모델 — 결정 (2B) 채택 시점의 별도 phase.

## 5. 본 결정의 코드 ↔ 문서 ↔ 출처 매핑

| 결정 | 코드 인용 | 문서 인용 |
| -- | -- | -- |
| 1B | `manager.rs::cleanup` `TurnInFlight` 가드, `manager.rs::release_to_pool` `TurnInFlight` 가드 | `workspace/README.md` Phase 6 §1 |
| 2A | `manager.rs::acquire` 의 `<slug>-<n>` 분기, `pool.rs::WarmPool::new(max_per_key, max_total)` | `workspace/README.md` Phase 6 §2, [CIR-33 §3.2](./CIR-33-warm-pool-strategy.md#32-풀-사이즈) |
| 3A | (없음 — 코드 미변경) | `workspace/README.md` Phase 6 §3 |
