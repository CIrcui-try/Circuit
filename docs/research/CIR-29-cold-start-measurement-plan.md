# CIR-29 — Cold Start 비용 분해 측정 계획

> Linear: [CIR-29](https://linear.app/enebin-test/issue/CIR-29/phase-1-cold-start-비용-분해-측정) · Project: **Coding Agent 세션 관리 / Cold Start** · Phase 1.
>
> 본 문서는 측정 **방법론·instrumentation 설계·보고서 템플릿** 만 정의한다. 측정 코드 자체는 별도 레포·후속 이슈에서 추가한다 (Circuit 데스크탑 앱과는 무관).

## 1. 목적

코딩 에이전트의 cold-start 비용을 4단계 (a)–(d) 로 분해해 wall-clock 으로 측정한다. 측정 결과는 **Phase 5 — warm pool 전략** 의사결정의 근거 자료가 된다. 즉 "어떤 단계를 미리 데워둘 가치가 있는가?" 를 데이터로 답하기 위한 입력이다.

Phase 5 가 critical path 의 다음 단계이므로 본 task 는 critical path 의 **시작점** 이며 다른 의존이 없다.

## 2. 측정 대상 — (a)–(d) 단계 정의

| 단계 | 정의 | 시작 sentinel | 종료 sentinel | 예상 비용 |
| -- | -- | -- | -- | -- |
| (a) Agent runtime 부팅 | 에이전트 호스트 프로세스 spawn 부터 명령 수신 가능 상태까지 | 프로세스 fork/spawn 직전 | runtime 의 첫 ready 신호 (예: `RuntimeReady` 이벤트, 첫 RPC accept) | 작음 (~100ms–1s) |
| (b) MCP 서버 부팅 | 모든 구성 MCP 서버가 `initialize` 응답을 돌려보낼 때까지 | 첫 MCP 서버 spawn 직전 | 마지막 MCP 의 `initialize` 응답 수신 | 중간 (~1–5s, 서버별 편차 큼) |
| (c) Workspace 준비 | 대상 repo 의 워킹트리가 준비되는 데 걸리는 시간 | clone/fetch 시작 | checkout 완료 (또는 fetch + reset 완료) | 큼 (~5s–수분) |
| (d) Code index / embedding | 첫 쿼리가 가능한 인덱스가 준비되는 시간 | 인덱싱/임베딩 작업 시작 | 첫 쿼리 가능 시점 (full index 또는 partial index 기준 명시) | 매우 큼 (~분) |

**단계 간 중첩 처리**: (a)–(d) 는 직렬이 아닐 수 있다 (예: (b) 와 (c) 병렬). 측정은 각 단계의 `start`/`end` 를 독립적으로 기록하고, 보고서에서는 **누적 wall-clock** 과 **단계 합** 을 모두 표시한다.

**부분 인덱스**: (d) 는 "전체 인덱스 완료" 와 "최소 사용 가능 부분 인덱스 완료" 두 변종을 모두 라벨로 측정한다 (`d_index.full`, `d_index.partial`).

## 3. Instrumentation 설계

### 3.1 시간 측정

- 모든 timestamp 는 **monotonic clock** (`std::time::Instant`, `process.hrtime.bigint()`, `clock_gettime(CLOCK_MONOTONIC)`) 의 ns 단위 차분.
- wall-clock 외에 (옵션) CPU time 을 별도 라벨로 함께 기록 — 단 1차 보고서에서는 wall-clock 만 사용.

### 3.2 이벤트 로그

단일 JSONL 로그 파일 `cold_start_events.jsonl` 에 `start` / `end` 이벤트를 append.

```json
{"run_id":"<uuid>","phase":"a_runtime","event":"start","t_ns":12345678901234,"labels":{}}
{"run_id":"<uuid>","phase":"a_runtime","event":"end",  "t_ns":12345678999999,"labels":{}}
```

**phase 값** — `a_runtime`, `b_mcp`, `c_workspace`, `d_index`.

**라벨**:
- (b) 의 row 에는 `labels.mcp_server` (서버명) 추가 — 서버별 분포를 따로 분석할 수 있게.
- (c) 의 row 에는 `labels.repo_size_bucket`, `labels.cache_state` (cold/warm).
- (d) 의 row 에는 `labels.index_kind` (`full` / `partial`).
- 모든 row 공통: `labels.run_env` (machine spec 식별자), `labels.session_id`.

### 3.3 Instrumentation 위치 (후보)

본 문서에서는 위치 **후보** 만 명시한다. 실제 코드는 다른 레포·후속 이슈에서 추가.

- (a) — agent host 의 `main()` 진입점 (혹은 supervisor 의 spawn 직전·직후).
- (b) — MCP client 의 `initialize` 송수신 hook. 서버별 timer.
- (c) — workspace manager 의 clone/fetch 진입·반환점.
- (d) — index pipeline 의 `start` 콜백과 첫 query 가능 신호 (queue drain or readiness flag).

## 4. 표본 수집 매트릭스

각 셀당 **최소 30 표본** 권장 (p99 추정 안정성 확보 목적).

| 차원 | 값 |
| -- | -- |
| repo 크기 | small (<10MB), medium (~100MB), large (>1GB) — 각 대표 repo 3+개 |
| MCP 구성 | minimal (0–1 server), typical (3–5), heavy (8+) |
| 캐시 상태 | cold (workspace fresh, index 없음), warm (5분 이내 재실행) |

**환경 메타** 도 함께 캡처: 머신 spec (CPU/RAM/디스크 종류), 네트워크 대역폭, OS, 에이전트 버전, 측정 시각.

**자동화**: 표본 수집은 스크립트로 자동 반복 — 셀 × 30 표본 = 9 × 2 × 30 = 540 표본/머신. 수동 수집은 비현실적이므로 후속 이슈에서 harness 작성.

## 5. 통계 · 시각화

### 5.1 단계별 통계

각 단계 (a)–(d) 에 대해 셀별로:
- p50 / p95 / p99
- 분포 히스토그램 (log-scale x 축 권장 — 단계별 비용 스케일이 다름)

### 5.2 누적 / 기여도

- **cold_total** = 단계별 wall-clock 합 (병렬 구간 보정 시 누적 wall-clock 별도 추가).
- **stacked bar** — 각 셀의 p50 cold_total 을 단계별 색으로 분해.
- **단계 기여도** — 각 셀에서 `phase_time / cold_total` 의 median. 가장 큰 값을 가진 단계가 warm 후보.

### 5.3 가장 비싼 단계 식별

각 셀의 단계 기여도 median 을 비교하여:
- 모든 셀에서 동일 단계가 최대인 경우 → 단일 warm 전략으로 충분.
- 셀에 따라 다른 단계가 최대인 경우 → 셀별 차등 warm 전략 필요 (예: large repo 는 (c), heavy MCP 는 (b)).

## 6. 보고서 템플릿

```
# Cold Start 비용 분해 보고서 — vN

## 요약
한 문단. 가장 비싼 단계, 셀별 패턴, Phase 5 권고 1줄.

## 환경
- 머신 / OS / 에이전트 버전 / 측정 기간 / 표본 총수

## 매트릭스 (p50 ms)
|  | small | medium | large |
| -- | -- | -- | -- |
| minimal MCP / cold | … | … | … |
| typical MCP / cold | … | … | … |
| heavy MCP / cold   | … | … | … |
| (warm 행 동일)     | … | … | … |

## 단계별 분포
- (a) histogram (placeholder)
- (b) histogram + 서버별 box plot
- (c) histogram + repo 크기별 violin
- (d) histogram + full vs partial 비교

## Stacked bar — cold_total 분해
(placeholder)

## Phase 5 권고 트리
- IF (c) 의 기여도 > 50% → pre-cloned workspace pool
- ELIF (d) 의 기여도 > 50% → persistent index 캐시
- ELIF (b) 의 기여도 > 30% → pre-warmed MCP pool
- ELSE → cold-start 그대로 두고 (a) 최적화에 시간 쓰지 말 것
```

## 7. 다음 단계 (Phase 5 입력)

**가설**: (c) 또는 (d) 가 가장 비쌀 가능성이 높다 (대형 repo 나 첫 인덱싱 기준).

**warm pool 후보**:
- **Pre-cloned workspace pool** — 자주 쓰는 repo 의 워킹트리를 미리 만들어 두고 fast-forward 만 수행.
- **Pre-warmed MCP pool** — 자주 쓰는 MCP 서버를 idle 상태로 유지해 (b) 를 0 에 가깝게.
- **Persistent index 캐시** — repo 별 인덱스를 디스크에 영속화. 변경분만 재인덱싱.

각 후보의 비용 (메모리/디스크/유지비) 과 cold-start 절감 기댓값을 Phase 5 에서 비교.

## 8. Open Questions

1. **Instrumentation owner** — 어느 프로세스 / 레포가 측정 로그를 책임지는가? (agent host? supervisor? 별도 telemetry sidecar?)
2. **자동화 harness 도구** — 측정 반복 자동화에 무엇을 쓸 것인가? (자체 스크립트 vs k6 / Locust 류 도구)
3. **표본 수집 머신** — 단일 머신 측정으로 충분한가? 다양한 spec 의 머신에서도 측정해야 하는가?
4. **(d) 의 "ready" 정의** — full index 와 partial index 중 어느 쪽을 1차 KPI 로 삼을 것인가?
5. **민감 정보** — 측정 로그에 repo 명·서버명이 포함된다. 사내 공유 시 마스킹 정책 필요.
