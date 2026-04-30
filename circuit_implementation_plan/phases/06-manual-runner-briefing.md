# Phase 6 Briefing

## Implemented

- **Runner 모듈 신설** — `app/src/runner/`. AGENTS.md §1 의 Editor / Schema / Runner 분리를 유지하기 위해 Phase 5 의 `app/src/workflow/` 와 대칭으로 새 모듈을 만들었다. 이 모듈은 `@xyflow/react`, `workflowStore`, `workflow/schema` 어느 것도 import 하지 않는다. 외부와의 결합은 `RunnableNode` / `RunnableEdge` 라는 최소 타입을 통해서만 일어난다.
- **runner.ts — 인터페이스/타입 단일 정의** — `NODE_RUN_STATES = ["idle","queued","running","success","failed","skipped"]` (SCHEMA.md §MVP Node States 그대로), `RunStatus`, `WorkflowRunner`, `RunResult`. 이후 phase 의 Claude/Codex adapter 가 같은 인터페이스를 구현하면 된다.
- **topoSort.ts — Kahn 위상 정렬** — `topoSort(nodeIds, edges)` 가 `{ cycle: false, order } | { cycle: true }` 를 반환. 순수 함수, React Flow 의존 없음. 분리된 노드도 결과에 포함되며 ties 는 입력 순서로 깨진다 (재실행 결정성).
- **mockRunner.ts — manual 데모 + 테스트 주입** — `createMockRunner({ delayMs, shouldFail })`. 기본 `shouldFail` 은 라벨 prefix `[fail]` 매칭으로, 수동 데모 시 라벨 한 글자만 바꾸면 실패 시뮬레이션이 가능하다. 테스트는 `shouldFail` 콜백을 직접 주입해 결정적이다.
- **runStore.ts — Run state 전용 zustand store** — `{ status, runId, workflowId, startedAt, nodeStates }` (SCHEMA.md §Run State 와 1:1). 액션: `beginRun`, `setNodeState`, `finishRun`, `reset`. 셀렉터 helper `useNodeRunState(id)` 도 같이 제공해 SkillNode 가 자기 노드 상태만 구독하게 한다 (re-render 최소화). `window.__RUN_STORE__` 로 노출해 Playwright 가 race 없이 store 를 박을 수 있다 (workflowStore 의 `__WORKFLOW_STORE__` 와 같은 패턴).
- **runWorkflow.ts — orchestration entry point** — `runWorkflow({ nodes, edges, workflowId, runner, store, now, newRunId })` 가 (a) duplicate 가드 (`status === "running"` 이면 즉시 reject), (b) 빈 workflow reject, (c) `beginRun` → topo sort → cycle 이면 모든 노드 skipped + run failed, (d) 정상 흐름은 sequential `running → runner.runNode → success | failed`, (e) 첫 실패 이후 잔여 노드 모두 skipped, (f) `finishRun(success | failed)` 으로 마무리. `now` / `newRunId` 는 inject 가능해 테스트가 결정적이다. runner 가 throw 한 경우도 그 노드의 failure 로 동등하게 처리된다.
- **Workspace toolbar — Start Circuit 활성화** — `app/src/routes/Workspace.tsx`. 새 핸들러 `handleStart` 가 `workflowStore` 의 nodes/edges 를 `RunnableNode`/`RunnableEdge` 로 변환해 `runWorkflow` 를 호출. 버튼은 `!repo || isRunning || nodeCount === 0` 일 때 disabled, 실행 중에는 라벨이 `Running…` 으로 바뀐다. repo 진입/변경 시 `useRunStore.reset()` 도 같이 클리어해 이전 run 잔상이 새 캔버스에 남지 않게 했다.
- **SkillNode 노드 상태 시각화** — `app/src/components/canvas/SkillNode.tsx`. `useNodeRunState(id)` 로 자기 노드의 state 를 구독해 className 에 `skill-node--{state}` 와 `data-run-state={state}` 를 부여. CSS (`global.css`) 에서 queued / running / success / failed / skipped 별 시각 단서를 추가했고 running 은 1.2 s pulse 애니메이션. Phase 7 의 풀 visualization 전 단계라 색상 단서만 — over-design 회피.
- **Playwright fixture 무수정** — runner 는 host bridge 를 우회하므로 `installBridge.ts` 에 손댈 필요가 없었다.

## Changed Files

신규:

- `app/src/runner/runner.ts` — 타입 / 인터페이스.
- `app/src/runner/topoSort.ts` — Kahn's algorithm.
- `app/src/runner/topoSort.test.ts` — TS1–TS5.
- `app/src/runner/mockRunner.ts` — `createMockRunner`.
- `app/src/runner/runStore.ts` — zustand run state store + `useNodeRunState`.
- `app/src/runner/runStore.test.ts` — RS1–RS4.
- `app/src/runner/runWorkflow.ts` — orchestration.
- `app/src/runner/runWorkflow.test.ts` — RW1–RW6.
- `app/e2e/workflow-runner.spec.ts` — F7a / F7b.
- `circuit_implementation_plan/phases/06-manual-runner-briefing.md` — 본 브리핑.

수정:

- `app/src/routes/Workspace.tsx` — Start Circuit 버튼 활성화 + `handleStart` + `useRunStore` 구독 + repo 변경 시 run reset.
- `app/src/routes/Workspace.test.tsx` — bridge mock 그대로, W5 어서션 갱신 (Start 가 노드 추가 후 enable), W9 신규 (Start 클릭 → status `success`, 노드 state `success`), runStore reset 을 `beforeEach` 에 추가.
- `app/src/components/canvas/SkillNode.tsx` — `useNodeRunState` 구독 + className/data attr 확장.
- `app/src/styles/global.css` — `.skill-node--{queued,running,success,failed,skipped}` + pulse keyframe.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 단위) | `cd app && pnpm test:run` | 14 files / **96 tests passed** (≈ 1.9 s) |
| Playwright (E2E) | `cd app && pnpm test:e2e` | **13 tests passed** (smoke 5 + flow-editor 5 + workflow-persistence 1 + workflow-runner 2, ≈ 3.2 s) |
| Rust 단위 테스트 | `cargo test --manifest-path app/src-tauri/Cargo.toml --lib` | **7 tests passed** (skill_scan 2 + workflow_store 5) |
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 606 ms (`dist/assets/index-*.js` 432.19 kB / gzip 139.20 kB) |

스펙 체크리스트 매핑 (`circuit_implementation_plan/phases/06-manual-runner.md` §Verification Checklist):

- [x] Workflow starts only after the user clicks Start Circuit — `Start Circuit` 버튼이 유일한 트리거. F7a 가 클릭 전에는 success 상태 노드가 없음을 implicit 확인.
- [x] Nodes execute in graph order — `topoSort` 의 결과 순서대로 sequential `await`. RW1 이 `["a","b","c"]` 순서를 단언.
- [x] Running node state is visible — `data-run-state="running"` + `.skill-node--running` (pulse). F7a 가 final state 만 단언하지만 W9 가 `nodeStates` 로 transition 을 검증.
- [x] Completed node state becomes success — F7a 가 두 노드 모두 `data-run-state="success"` 임을 단언. W9 가 `nodeStates[id] === "success"` 단언.
- [x] Failed node state is represented — RW2 / RW6 / mockRunner `[fail]` prefix 로 검증.
- [x] Starting while already running is prevented — F7b 가 store 를 `running` 으로 박은 뒤 버튼이 disabled 임을 단언, RW3 이 dup call 시 runner 가 호출되지 않음을 단언.
- [x] Tests cover run state transitions — RS / RW / W9 / F7.

## Tests

추가:

- **Vitest — `app/src/runner/topoSort.test.ts` (5개, 신규)** : TS1 linear, TS2 diamond, TS3 cycle, TS4 disconnected, TS5 empty.
- **Vitest — `app/src/runner/runStore.test.ts` (4개, 신규)** : RS1 beginRun 모든 노드 queued, RS2 setNodeState 단일 transition, RS3 finishRun 이 nodeStates 보존, RS4 reset.
- **Vitest — `app/src/runner/runWorkflow.test.ts` (6개, 신규)** : RW1 sequential success, RW2 failure → 후속 skipped, RW3 already-running 가드, RW4 cycle → 모든 skipped + failed, RW5 empty 거부, RW6 throw 도 failure 로 동등.
- **Vitest — `app/src/routes/Workspace.test.tsx`** : W5 갱신 (Start 가 노드 추가 후 활성), W9 신규 (Start 클릭 → run success). `useRunStore.reset()` 을 `beforeEach` 에 추가.
- **Playwright — `app/e2e/workflow-runner.spec.ts` (2개, 신규 파일)** : F7a sequential success (두 노드 모두 `data-run-state="success"`), F7b duplicate prevention (`__RUN_STORE__.beginRun` 으로 store 를 running 으로 박아 race 없이 disabled 단언 + runId 보존 단언).

실행 명령 / 결과:

```
cd app && pnpm test:run                                                    # 14 files / 96 tests passed
cd app && pnpm test:e2e                                                    # 13/13 passed
cargo test --manifest-path app/src-tauri/Cargo.toml --lib                  # 7/7 passed
cd app && pnpm build                                                       # tsc + vite 606 ms
```

## Known Limitations

- **시각화는 최소.** queued / running / success / failed / skipped 별 색상·테두리·pulse 만 있고, badge / spinner / per-node 메시지 / log panel 은 없다. Phase 7 (`run-visualization`) 가 다룬다.
- **Run history 미영속화.** runStore 는 메모리 only. 새 run 을 시작하면 이전 run 의 nodeStates 는 덮어쓴다. SCHEMA.md §Run State 의 영속화 결정이 아직 없어 의도적 보류.
- **Failure propagation 은 "잔여 일괄 skip" 단순 버전.** topo 후속이 아닌 노드까지도 첫 실패 발견 시 모두 skipped 로 마킹. parallel / branch 시맨틱이 들어오기 전에는 reachability 기반 partial-skip 이 over-engineering 이라 단순 버전을 채택 (CLAUDE.md §1).
- **Mock runner 의 실패 트리거가 라벨 prefix `[fail]` 에 의존.** 데모용으로는 충분하지만, 실제 production runner 는 Phase 8 (Agent Handoff Contract) 에서 다룬다.
- **Empty workflow 는 disabled 로 차단되지만, 직접 `runWorkflow({ nodes: [] })` 호출 시 store 에 변화 없이 reject 만 한다.** 의도적: status 를 success 로 마무리해 사용자에게 노이즈를 주는 것보다 무동작이 안전.
- **Cycle 감지 시 사용자 피드백이 없음.** 현재는 `status: "failed"` + 모든 노드 skipped 로만 표현. 실제 UI 에서 "cycle detected" 메시지를 띄우는 것은 Phase 7 의 log panel 작업으로 미룸.
- **Concurrent skill 실행 / branch 분기 / 조건 분기 / 루프** 모두 명시적 out-of-scope (`06-manual-runner.md` §Out of Scope).
- **F7a 가 두 노드 사이의 순서를 명시적으로는 검증하지 않는다.** 둘 다 success 인 final state 만 본다. 순서 자체는 RW1 (vitest) 에서 결정적으로 검증되므로 E2E 에서는 race 회피를 우선했다.

## Next Recommendation

다음은 **Phase 7 — Run Visualization** (`circuit_implementation_plan/phases/07-run-visualization.md`).

이번 phase 에서 runStore / runWorkflow 가 갖춰졌으니 Phase 7 에서는:

1. SkillNode 에 status badge / spinner / 마지막 실패 사유 (`RunResult.reason`) 노출. 현재 `runWorkflow` 가 `RunResult` 의 `reason` 을 nodeStates 에 합치지 않는데, Phase 7 에서 `nodeMessages: Record<string, string>` 같은 확장이 필요해질 것.
2. LogPanel 을 활성화해 runId / startedAt / 노드별 transition 타임라인을 보여준다 (현재 `app/src/components/layout/LogPanel.tsx` 가 placeholder).
3. Cycle 감지 / empty / duplicate-run 같은 reject 케이스에 대한 토스트 / 인라인 메시지.
4. Run 종료 후 노드 클릭 시 PropertiesPanel 에 그 노드의 마지막 결과 노출.
5. 가능하면 progress bar (전체 노드 중 완료된 비율) — 단, parallel 이 들어오기 전에는 사실상 sequential 이라 단순 카운터로 충분.

Phase 8 (Agent Handoff Contract) 으로 넘어가기 전에 visualization 을 확정해두면, 실제 Claude/Codex CLI 가 들어왔을 때 같은 UI 가 그대로 동작한다.
