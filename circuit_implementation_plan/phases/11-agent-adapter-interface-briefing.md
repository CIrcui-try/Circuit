# Phase 11 Briefing — Agent Adapter Interface (CIR-22)

## Implemented

- **AgentAdapter 인터페이스 갱신** —
  `app/src/runtime/adapters/AgentAdapter.ts` 의 메서드를 `canHandle(skillRef)`
  / `execute(ctx)` 에서 `canRun(ctx) → Promise<AdapterAvailability>` /
  `run(ctx, events) → Promise<SkillExecutionResult>` 로 교체. provider 매칭은
  더 이상 어댑터 자신의 책임이 아니라 registry 가 담당. Phase 10 까지 호출자가
  없었으므로 시그니처 교체는 외부 영향 없음 (`grep -rn "canHandle\\|.execute("
  app/src` 결과 무 호출).
- **AdapterAvailability 타입** — 같은 파일에 추가. `ok` 필수, `reason` 과
  `details` 선택. provider 별 구현이 CLI 존재 여부, 권한, 환경 변수 등을 한
  형태로 보고할 수 있게 한다.
- **AgentRunEventSink 타입** — `(event: AgentRunEvent) => void` 함수 alias.
  `AgentRunEvent` 가 이미 discriminated union (`start` / `stdout` / `stderr` /
  `status` / `finish` / `error`) 이므로 callback 하나로 충분. 객체 형태
  (`onStdout` / `onError` …) 가 필요해지는 phase 에서 다시 검토.
- **AdapterRegistry** — `app/src/runtime/adapters/AdapterRegistry.ts` 신설.
  `register / get / has / list` 4 메서드의 얇은 `Map<WorkflowSkillProvider,
  AgentAdapter>` 래퍼. `WorkflowSkillProvider` 유니온 (`claude | codex | shell
  | git`) 을 그대로 사용 — Linear draft 의 `claude | codex` 보다 넓지만
  workflow schema 의 single source 와 일치. shell / git 어댑터는 이번 phase
  에서 등록되지 않은 채 남는다.
- **UnknownProviderError** — registry 의 named error. 미등록 provider 조회
  시 `name = "UnknownProviderError"`, `provider` 프로퍼티, 그리고 메시지에
  provider 이름을 포함한 형태로 throw. 호출자는 instanceof 또는 name 으로
  분기 가능.
- **FakeAgentAdapter** —
  `app/src/runtime/adapters/FakeAgentAdapter.ts` 신설. 옵션 객체로 provider /
  availability / events / result / failWith 를 받아 다음 phase 의 runner
  단위 테스트에서 실 CLI 없이 success / failure / event-sequence 를 시뮬레이션.
  `seenContexts` 배열에 호출 받은 context 를 기록해 runner 가 어댑터에
  전달한 값까지 검증할 수 있게 한다.
- **registry 의 overwrite 정책** — 같은 provider 로 두 번 register 하면
  덮어쓴다. MVP 단계의 단순 정책으로 의도. 충돌 감지가 필요해지면 후속
  phase 에서 옵션화.

## Changed Files

수정:

- `app/src/runtime/adapters/AgentAdapter.ts` —
  `canHandle / execute` 제거, `canRun / run` 추가, `AdapterAvailability` /
  `AgentRunEventSink` export. 기존 re-export (`AgentRunEvent`,
  `SkillExecutionContext`, `SkillExecutionResult`) 유지.

신규:

- `app/src/runtime/adapters/AdapterRegistry.ts` — registry + named error.
- `app/src/runtime/adapters/AdapterRegistry.test.ts` — Vitest 5 케이스
  (R1–R5).
- `app/src/runtime/adapters/FakeAgentAdapter.ts` — 테스트용 fake.
- `app/src/runtime/adapters/FakeAgentAdapter.test.ts` — Vitest 8 케이스
  (F1–F8).
- `circuit_implementation_plan/phases/11-agent-adapter-interface-briefing.md`
  — 본 briefing.

## Verification

| CIR-22 §Verification Checklist | 확인 방법 | 결과 |
| --- | --- | --- |
| AgentAdapter interface 정의 | Step 1 + tsc | OK |
| AdapterRegistry 가 provider 별 adapter 반환 | R1 / R3 | OK |
| 없는 provider 에 대한 명확한 error | R4 (`UnknownProviderError` + `provider` + message) | OK |
| FakeAgentAdapter 로 성공/실패 이벤트 시뮬레이션 | F4 / F5 / F7 | OK |
| adapter availability check 구조 | F2 / F3 + `AdapterAvailability` 타입 | OK |

실행 명령 / 결과:

```bash
cd app
npm run test:run    # 모든 기존 + 신규 13 케이스 green
npm run build       # tsc 통과 + vite 그린
```

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `app/src/runtime/adapters/AdapterRegistry.test.ts` | 5 | R1 register+get / R2 has 변화 / R3 list 포함 / R4 UnknownProviderError / R5 overwrite |
| `app/src/runtime/adapters/FakeAgentAdapter.test.ts` | 8 | F1 provider / F2 default canRun / F3 configured availability / F4 events 순서 / F5 result 필드 / F6 seenContexts / F7 failWith reject / F8 default success |

## Runtime Notes

- 어댑터 자체는 RuntimeBridge / Tauri / 외부 CLI 와 아직 무관하다 — Fake 만
  존재. 실제 ClaudeAdapter / CodexAdapter 가 도입될 때 RuntimeBridge.spawn 과
  연결된다.
- `canRun` 의 `details` 필드는 향후 진단용 (검색한 PATH, 검출된 버전 등). 본
  phase 에서는 시그니처만 정의.
- registry 는 thread-safe 가 아니다 (single-threaded JS 가정). 필요해지면
  Map 대체.
- 워크트리는 `origin` 미설정 상태 — Phase 9, 10 과 동일. push / PR 은
  `/takeoff` 에서 origin 셋업 후 처리.

## Known Limitations

- 실제 ClaudeAdapter / CodexAdapter 구현 없음. shell / git 어댑터도 미구현
  (Linear §Out of Scope).
- `canRun` 호출자 없음. RealWorkflowRunner 가 도입되는 phase 에서 어댑터를
  실행 직전에 호출하는 흐름이 추가될 예정.
- `AgentRunEventSink` 는 동기 콜백. 이벤트 처리에 backpressure 가 필요해지면
  async iterator 또는 `Promise<void>` 반환으로 변경 필요.
- registry 는 충돌 시 silent overwrite — 명시적 정책이지만 production 에서는
  `register({ replace: false })` 같은 옵션이 안전할 수 있다.
- `FakeAgentAdapter` 는 timing 시뮬레이션 (delay, partial flush) 을 지원하지
  않는다. 실제 비동기 흐름을 다루는 테스트가 필요해지면 옵션 추가.

## Next Recommendation

1. **Phase 12 — RealWorkflowRunner skeleton**: 워크플로우 그래프 traversal
   위에서 `AdapterRegistry.get(provider)` → `canRun` 가드 → `run` 호출 →
   `previousOutputs` 누적의 흐름. `${steps.<id>.output}` placeholder 치환은
   여기서 포함. FakeAgentAdapter 로 단위 테스트.
2. **ClaudeAdapter** — `AgentAdapter` 의 첫 구체 구현. RuntimeBridge.spawn
   호출, stdout / stderr → `AgentRunEventSink`, exit code → result 매핑.
   `canRun` 에서 CLI 존재 여부 + 인증 상태 확인.
3. **provider availability cache** — 매 노드 실행마다 `canRun` 을 호출하면
   비싼 작업 (PATH lookup, version check) 이 반복된다. registry 또는 runner
   레벨에서 캐싱 정책 검토.
4. **registry 충돌 정책** — production 사용처가 등장하면 silent overwrite 를
   명시적 옵션으로 전환.
