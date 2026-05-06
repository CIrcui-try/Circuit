# Phase 14 Briefing — Real Workflow Runner (CIR-25)

## Implemented

- **RealWorkflowRunner** — `app/src/runner/RealWorkflowRunner.ts` 신설.
  `WorkflowRunner` 계약을 구현해 `runWorkflow` 의 topo 순서대로
  실제 어댑터를 호출. 노드별로 `SkillExecutionContext` 를 빌드하고
  `previousOutputs` 를 다음 노드 컨텍스트에 누적 전달한다. 어댑터의
  `AgentRunEvent` 는 sink 를 통해 `runLogStore` 로 forward, 종료 시
  `SkillExecutionResult` 를 `nodeResults` 에 저장. `reset()` /
  `cancel()` 두 public 메서드를 제공해 Workspace 가 매 run 직전 상태
  초기화와 진행 중 취소를 트리거한다.
- **runLogStore** — `app/src/runner/runLogStore.ts` 신설.
  `AgentRunEvent[]` (전체 시간순 흐름 + 노드별) 와
  `SkillExecutionResult` (노드별 final result) 를 저장하는 zustand
  스토어. LogPanel 이 이 스토어를 구독해 라인을 그린다. `useRunStore`
  와 분리한 이유는 stdout 매 라인마다 캔버스 노드 색상 갱신이
  re-render 를 유발하지 않도록 하기 위함이다.
- **createDefaultRegistry** — `app/src/runtime/adapters/createDefaultRegistry.ts`
  신설. `RuntimeBridge` 를 받아 새 `AdapterRegistry` 에
  `ClaudeAdapter` (default 옵션) 와 `CodexAdapter` (default 옵션) 를
  등록해 반환한다. RealWorkflowRunner 의 첫 사용처. 두 어댑터의 default
  `newRunId` 가 `${ctx.runId}::${ctx.nodeId}` 형식이므로
  RealWorkflowRunner 의 `currentAdapterRunId` 추적 형식과 일치 →
  `bridge.cancel(runId)` 가 정확히 진행 중 프로세스를 끊는다.
- **Workspace 와이어업** — `app/src/routes/Workspace.tsx` 의 runner 를
  `createMockRunner({ delayMs: 250 })` 에서 `RealWorkflowRunner` 로
  교체. `repo` 가 바뀌면 새 runner 인스턴스를 만들고
  `useRunLogStore.reset()` 도 함께 호출. 툴바에 `data-testid="workflow-cancel"`
  Cancel 버튼 추가 (`disabled={!isRunning}`).
- **LogPanel** — `app/src/components/layout/LogPanel.tsx` 가
  `runLogStore` 를 구독해 노드 ID / 이벤트 타입 / payload 3-column
  으로 라인을 표시. 노드별 final result 도 동일 포맷으로 한 줄
  추가 (`failed/timeout/cancelled` → 빨강, `success` → 초록).
  이벤트가 없으면 기존 `No runs yet.` 빈 상태 보존. `app/src/styles/global.css`
  에 `.run-log` 관련 최소 클래스 추가.
- **이벤트 / status 매핑 (RealWorkflowRunner)**
  | adapter result.status | RunResult |
  | --- | --- |
  | `success` | `{ ok: true }` |
  | `failed` | `{ ok: false, reason: "failed (exit N)" }` |
  | `cancelled` | `{ ok: false, reason: "cancelled" }` |
  | `timeout` | `{ ok: false, reason: "timeout" }` |
  `runWorkflow` 가 ok=false 를 받으면 노드를 `failed` 로 표시하고
  후속 노드를 `skipped` 로 둔다 (기존 로직 그대로 활용 — 본 phase 가
  추가한 동작 아님).

## Changed Files

신규:

- `app/src/runner/runLogStore.ts` — zustand store.
- `app/src/runner/runLogStore.test.ts` — 4 케이스.
- `app/src/runner/RealWorkflowRunner.ts` — 본체.
- `app/src/runner/RealWorkflowRunner.test.ts` — 10 단위 케이스.
- `app/src/runner/RealWorkflowRunner.integration.test.ts` —
  `runWorkflow` 와 결합한 2 통합 케이스.
- `app/src/runtime/adapters/createDefaultRegistry.ts` — 헬퍼.
- `app/src/runtime/adapters/createDefaultRegistry.test.ts` — 2 케이스.
- `circuit_implementation_plan/phases/14-real-workflow-runner-briefing.md` —
  본 브리핑.

수정:

- `app/src/routes/Workspace.tsx` — runner 교체 + Cancel 버튼.
- `app/src/routes/Workspace.test.tsx` — `__CIRCUIT_RUNTIME__` 윈도우
  훅으로 `MockRuntimeBridge` 를 주입해 W9 등 실행 흐름 테스트가 새
  runner 로도 통과하도록 setup 보강.
- `app/src/components/layout/LogPanel.tsx` — store 구독.
- `app/src/styles/global.css` — `.run-log*` 클래스.

## Verification

| CIR-25 §Verification Checklist | 확인 방법 | 결과 |
| --- | --- | --- |
| RealWorkflowRunner 가 mock runner 와 분리 | `RealWorkflowRunner.ts` 신규, `mockRunner.ts` 무수정 | OK |
| graph 순서대로 실제 adapter 호출 | integration 테스트 1 (`a → b → c`, `seenContexts.map(.nodeId)` ) | OK |
| Claude 노드는 ClaudeAdapter | R1 + D2 (`get("claude").provider === "claude"`) | OK |
| Codex 노드는 CodexAdapter | R1 + D2 | OK |
| node input 이 adapter context 로 전달 | R2 (`ctx.input === { foo: 1 }`) | OK |
| previousOutputs 가 다음 노드로 전달 | R3 + integration 테스트 1 (`Object.keys(...)` 확장) | OK |
| adapter event 가 UI run log 에 표시 | R5 + LogPanel `data-testid="run-log-line"` 렌더 | OK |
| 실패 시 workflow 중단 | R6 + integration 테스트 2 (`a:failed, b:skipped, c:skipped`) | OK |
| cancel 가능 | R7 (`cancelSpy` 가 `"run_1::a"` 로 호출, result.status="cancelled") | OK |
| fake adapter 기반 테스트 존재 | R1~R10 + integration 2 케이스 모두 `FakeAgentAdapter` 사용 | OK |

실행 명령 / 결과:

```bash
cd app
npm run test:run    # 28 file / 195 case green (직전 phase 24 file / 177 → +4 file / +18 case)
npm run build       # tsc + vite 그린, dist 생성
```

`console.log` 검사: 변경 파일에 없음.

```bash
grep -nR "console.log" \
  app/src/runner/{RealWorkflowRunner,runLogStore}*.ts \
  app/src/runtime/adapters/createDefaultRegistry*.ts \
  app/src/components/layout/LogPanel.tsx \
  app/src/routes/Workspace.tsx
# (no matches)
```

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `app/src/runner/runLogStore.test.ts` | 4 | L1 beginRun reset / L2 appendEvent 순서 / L3 setNodeResult 격리 / L4 reset |
| `app/src/runtime/adapters/createDefaultRegistry.test.ts` | 2 | D1 has(provider) / D2 get().provider |
| `app/src/runner/RealWorkflowRunner.test.ts` | 10 | R1 provider lookup / R2 ctx.skill.content + cwd / R3 previousOutputs 누적 / R4 nodeResults 저장 / R5 events forwarding / R6 failure 매핑 / R7 cancel → bridge.cancel + status="cancelled" / R8 새 run 감지 / R9 unknown provider / 추가: missing node id |
| `app/src/runner/RealWorkflowRunner.integration.test.ts` | 2 | 3-노드 직선 그래프 e2e + previousOutputs / events / nodeResults / 실패 시 workflow 중단 |
| `app/src/routes/Workspace.test.tsx` | (변경) | `__CIRCUIT_RUNTIME__` 주입으로 기존 10 케이스 그대로 그린 |

기존 ClaudeAdapter / CodexAdapter / runWorkflow / runStore / topoSort /
buildSkillExecutionContext / FakeAgentAdapter / AdapterRegistry 등의
케이스는 코드 변경 없이 그대로 통과 (회귀 가드).

## Runtime Notes

- RealWorkflowRunner 는 `bridge.readFile` 로 SKILL.md 를 매 노드마다
  로드한다. Tauri 측에서 OS-level 캐시를 기대하며 어댑터 / runner
  내부 캐시는 갖지 않는다.
- 어댑터의 spawn runId 는 `${runId}::${nodeId}` 로 고정 가정.
  `createDefaultRegistry` 가 default 옵션으로 어댑터를 만들기 때문에
  성립. 사용자가 `newRunId` 옵션을 변경한 어댑터를 따로 등록할 경우
  `RealWorkflowRunner.cancel()` 이 잘못된 runId 로 bridge 를 호출할
  수 있다. 그 경우는 단일 사용자 시나리오 한정 — 이 plugin point 는
  다음 phase 에서 runner 의 옵션으로 노출 검토.
- Workspace 의 `__CIRCUIT_RUNTIME__` 윈도우 훅이 production 코드
  경로에서도 우선 적용되므로, e2e / Storybook 등에서 fake bridge 를
  주입할 수 있다. 본 phase 의 단위 테스트도 동일한 훅을 사용.
- `previousOutputs` 는 다음 노드의 ctx 로만 spread copy 해 전달한다.
  어댑터가 ctx 를 retain 하더라도 누적 맵은 안전.
- runner 가 throw 되지 않는 경로 (`runViaBridge` 가 항상 result 로
  resolve) 에 의존하지만, `try/catch` 안전망을 둬서 어댑터가 reject
  하면 `RunResult.ok=false, reason=<error.message>` 로 매핑.
- LogPanel 은 `events.length === 0 && nodeResults === {}` 조건일
  때만 빈 상태를 표시한다. 첫 spawn `started` 이벤트가 도착하면
  empty-state 가 사라진다.

## Known Limitations

- **`canRun` 가드 없음.** 어댑터의 `canRun` 호출 없이 바로 `run` 으로
  진입. CLI 부재 시 ENOENT 가 `error` 이벤트로 흘러
  `RunResult.ok=false, reason="failed"` 로 매핑되므로 흐름 자체는
  안전하지만, 실패 노드 이후 워크플로우가 통째로 중단된다. canRun
  + availability 캐시는 다음 phase 의 우선 작업.
- **`${steps.<id>.output}` placeholder 치환 없음.** 어댑터 default
  prompt 의 `## Previous Outputs` 섹션이 동등 정보를 전달하므로 본
  phase 에서는 미적용. 워크플로우 input 에서 직접 placeholder 를
  쓰는 시나리오는 다음 phase 에서.
- **자동 retry 없음.** 실패 즉시 중단. retry 정책은 후속 phase.
- **parallel / condition / loop 노드 미지원.** `runWorkflow` 가
  topo 순서로 직선 실행만 한다. 병렬·조건 분기는 후속 phase 의
  새 runner 옵션 / 그래프 traversal 변경 영역.
- **Codex 응답의 구조화 파싱 없음.** `result.output / summary` 는
  어댑터가 비워둔 채 그대로 둔다. JSON / structured output 매핑은
  Phase 13 §Next Recommendation §3 에 있는 작업.
- **사용자 정의 input 입력 UI 없음.** `WorkflowSkillNode.input` 은
  존재하지만 PropertiesPanel 이 입력 필드를 노출하지 않으므로 현재
  실 운영에서는 항상 `{}` 로 들어간다. 입력 UI 는 별도 phase.
- **Real CLI 실행과 통합 테스트 없음.** 본 phase 의 모든 테스트는
  `MockRuntimeBridge` + `FakeAgentAdapter` 기반. Tauri Rust 측
  `runtime_spawn` 동작과 결합한 통합 시나리오는 후속 phase.

## Next Recommendation

1. **Provider availability cache + canRun 가드** — Phase 13
   §Next Recommendation §2 와 결합. 워크플로우 시작 시 한 번만
   `canRun` 을 호출하고 결과를 runner 인스턴스에 캐시. canRun=false
   면 노드를 `skipped` 로 표시 (현재는 6-state 에 `unavailable`
   같은 신규 상태가 없으므로 우선은 `failed` 로 두는 옵션도 검토).
2. **`${steps.<id>.output}` placeholder 치환 + 노드 input 편집 UI** —
   `RealWorkflowRunner` 에서 `WorkflowSkillNode.input` 의 string
   값을 정규식으로 스캔해 이전 노드의 `output` 을 inject. PropertiesPanel
   에 input editor 를 함께 추가해야 의미가 산다.
3. **노드 단위 retry / timeout override 옵션** — workflow 단위
   timeout (`SkillExecutionContext.execution.timeoutMs`) 외에 노드별
   override + 재시도 횟수 / 백오프. 현재는 어댑터/bridge 의 timeout
   에만 의존.
4. **Codex 응답 파서** — `--output-format json` 도입 + adapter 가
   stdout 마지막 JSON 블록을 `result.output` 으로 매핑. 그래프 후속
   노드의 `previousOutputs` 가 의미 있는 JSON 으로 구성된다.
5. **Run history 영속화** — `runLogStore` 가 in-memory 라 페이지
   리프레시 시 사라진다. 워크플로우 ID + run ID 별로 호스트 디스크에
   저장 (Tauri filesystem) 하고 LogPanel 에 과거 run 선택 UI 추가.
6. **Cancel UX 강화** — 현재 Cancel 버튼은 진행 중 노드 1개만 끊고
   workflow 중단을 `runWorkflow` 의 failure 흐름에 위임한다. "전체
   중단" 신호가 명시적으로 필요하면 `runWorkflow` 에 cancel 토큰을
   주입하는 방향 검토.
