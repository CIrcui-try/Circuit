# Phase 12 Briefing — Claude Adapter (CIR-23)

## Implemented

- **ClaudeAdapter** — `app/src/runtime/adapters/ClaudeAdapter.ts` 신설.
  `AgentAdapter` 의 첫 구체 구현. `provider` 가 `"claude"` 로 고정. 생성자에
  `RuntimeBridge` 를 주입받아 `canRun` / `run` 을 모두 bridge 로 위임.
- **설정 가능한 command builder** — Linear 이슈가 요구한 _"특정 CLI 인자에
  강하게 결합하지 말고, 설정 가능한 command builder 구조를 우선"_ 을
  `buildCommand(ctx, prompt) → { command, args }` 한 함수로 충족. 기본값은
  `claude -p <prompt>`. 사용자가 오버라이드하면 spawn 인자가 그대로 바뀐다.
- **설정 가능한 prompt builder** — `buildPrompt(ctx) → string`. 기본 빌더는
  `# Skill: <name>` / SKILL.md content / `# Input` / JSON.stringify(input)
  네 섹션을 합친 단순 마크다운 문자열을 만든다. `previousOutputs` 는 의도적으로
  포함하지 않음 (Phase 13 runner 에서 placeholder 가 치환된 input 만 어댑터로
  들어오는 가정).
- **canRun 의 probe** — `bridge.spawn` 으로 짧은 probe 프로세스를 띄우고
  terminal event 로 가용성 판정. 기본 probe 는 `claude --version`,
  default timeout 5_000ms. 매핑:
  | terminal | 결과 |
  | --- | --- |
  | `exited` exitCode === 0 | `{ ok: true, details: { command, args } }` |
  | `exited` exitCode !== 0 | `{ ok: false, reason: "probe exited with code N", details: { …, exitCode: N } }` |
  | `error` | `{ ok: false, reason: "spawn error: <message>" }` |
  | `timeout` | `{ ok: false, reason: "probe timed out" }` |
  | `cancelled` | `{ ok: false, reason: "probe cancelled" }` |
  `skipProbe: true` 옵션으로 probe 자체를 끌 수 있다. spawn 호출 자체가
  reject 하면 `spawn rejected: <message>` 으로 매핑 (CLI 미설치 환경에서
  Tauri side 가 reject 로 노출하는 케이스 대비).
- **run 의 이벤트 매핑** — `bridge.subscribe(runId, …)` → `bridge.spawn(…)`
  순서로 등록. `RuntimeProcessEvent` 를 `AgentRunEvent` 로 변환하여 sink 에
  emit + logs 에 누적:
  | RuntimeProcessEvent | AgentRunEvent | terminal? | status |
  | --- | --- | --- | --- |
  | `started` | `start { message: "spawn <cmd>" }` | no | — |
  | `stdout` | `stdout { text }` | no | — |
  | `stderr` | `stderr { text }` | no | — |
  | `exited` | `finish { exitCode }` | yes | `success` (0) / `failed` (≠0) |
  | `cancelled` | `error { message: "cancelled" }` | yes | `cancelled` |
  | `timeout` | `error { message: "timeout" }` | yes | `timeout` |
  | `error` | `error { message }` | yes | `failed` |
  terminal 수신 시 `unsubscribe` 후 `SkillExecutionResult` (logs, startedAt,
  finishedAt, status, exitCode?) 반환. `exitCode` 는 `exited` 매핑 시에만
  채운다. 두 번째 terminal 이벤트는 무시 (idempotent finish guard).
- **runId 생성** — 기본 `${ctx.runId}::${ctx.nodeId}`, probe 는 `::probe`
  접미사. 동일 ctx 재호출 시 충돌 가능성이 있으면 사용자가 `newRunId` 옵션
  으로 교체.
- **타임아웃 / 취소 책임 분리** — 어댑터는 타이머나 cancel 을 직접 다루지
  않고, `bridge` 가 `timeout` / `cancelled` 이벤트를 emit 하는 것만 매핑한다.
  실제 타이머는 RuntimeBridge 구현체 책임.
- **테스트 (vitest, mocked RuntimeBridge)** —
  `app/src/runtime/adapters/ClaudeAdapter.test.ts`. 14 케이스. 기존
  `createMockRuntimeBridge` 에 spawn 인자를 기록하는 얇은 spy 래퍼를 씌워
  `bridge.spawn` 인자 검증과 시나리오 주입을 동시에 수행.

## Changed Files

신규:

- `app/src/runtime/adapters/ClaudeAdapter.ts` — 어댑터 구현.
- `app/src/runtime/adapters/ClaudeAdapter.test.ts` — vitest 14 케이스.
- `circuit_implementation_plan/phases/12-claude-adapter-briefing.md` — 본
  브리핑.

수정: 없음. Phase 11 의 `AgentAdapter` / `AdapterRegistry` / contracts /
RuntimeBridge / mock 은 그대로 사용.

## Verification

| CIR-23 §Verification Checklist | 확인 방법 | 결과 |
| --- | --- | --- |
| ClaudeAdapter 가 AgentAdapter 를 구현 | tsc + C1 | OK |
| provider 가 `claude` | C1 | OK |
| Claude command 가 설정 가능 | C8 (`buildCommand` 오버라이드 → spawn args 변경) | OK |
| RuntimeBridge 를 통해 process 실행 | C2 / C6 (`bridge.spawn` 인자 검증) | OK |
| cwd 가 repository path 로 설정 | C6 (`spawnCalls[0].cwd === ctx.execution.cwd`) | OK |
| prompt 에 SKILL.md content + node input 포함 | C7 (default builder 검증) + C8 (override 검증) | OK |
| stdout/stderr 가 run log event 로 전달 | C9 (순서 + payload) | OK |
| exit code 에 따라 success/failed 결정 | C10 + C11 (`exited(0)` → success, `exited(2)` → failed) | OK |
| mocked RuntimeBridge 테스트 존재 | 모든 14 케이스 | OK |

실행 명령 / 결과:

```bash
cd app
npm run test:run    # 전체 23 file / 163 case green (신규 14 포함)
npm run build       # tsc + vite 그린
```

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `app/src/runtime/adapters/ClaudeAdapter.test.ts` | 14 | C1 provider / C2 probe ok / C3 probe non-zero / C4 probe error / C5 skipProbe / C6 spawn cwd·env·timeout / C7 default prompt / C8 custom builder / C9 event 매핑 순서 / C10 success result / C11 terminal 매핑 (4 sub: exited(2)·cancelled·timeout·error) |

## Runtime Notes

- 기본 command 는 `claude` (PATH 의존). 환경에 따라 절대 경로로 바꿀 수 있게
  `buildCommand` 옵션 제공. 호출자는 사용자 설정으로 이를 주입한다 (UI/설정
  레이어는 후속 phase 에서).
- probe 기본 timeout 은 5초. 매번 호출되면 비용이 누적되므로 후속 phase
  에서 registry/runner 레벨 캐싱 권장 (Phase 11 briefing §Next Recommendation
  과 일치).
- 어댑터는 `previousOutputs` 를 prompt 에 주입하지 않는다. placeholder
  치환은 RealWorkflowRunner 가 입력에서 처리한 뒤 어댑터로 전달하는 흐름
  가정.
- `bridge.spawn` reject 케이스 (Tauri 측 이벤트 채널이 열리기 전 실패 등)
  를 `error` 이벤트와 동일하게 처리. 따라서 `run` 은 절대 reject 하지 않고
  항상 result 로 resolve — runner 의 처리 단순화.
- 워크트리는 `origin` 미설정 상태 (Phase 9–11 과 동일). push / PR 은
  `/takeoff` 단계에서 origin 셋업 후 처리.

## Known Limitations

- `AdapterRegistry` 에 자동 등록되지 않는다. Phase 13 의 RealWorkflowRunner
  도입 시 `registry.register(new ClaudeAdapter({ bridge }))` 가 추가될
  예정.
- Claude 응답의 구조화 파싱 없음 (JSON / tool-call). `summary` /
  `output` 필드는 비어 있음. 후속 phase 의 응답 파서가 들어가는 자리.
- multi-turn / session 관리 없음. 매 노드 실행이 독립 프로세스.
- 자동 retry 없음. 재시도 정책은 runner 책임.
- 실 CLI 와의 통합 테스트 (Tauri `runtime_spawn` Rust 측 동작 확인) 미수행
  — mocked bridge 단위 테스트만 존재. Rust 측 통합은 후속 phase.
- probe 결과를 캐시하지 않는다. canRun 호출마다 spawn 발생.

## Next Recommendation

1. **Phase 13 RealWorkflowRunner skeleton** — 워크플로우 그래프 traversal
   위에서 `AdapterRegistry.get(provider)` → `canRun` 가드 → `run` 호출 →
   `previousOutputs` 누적의 흐름 + `${steps.<id>.output}` placeholder 치환.
   ClaudeAdapter 를 registry 에 등록하는 첫 사용처.
2. **Provider availability cache** — runner 또는 registry 레벨에서 canRun
   결과를 워크플로우 실행 단위 (또는 짧은 TTL) 로 캐시. 매 노드 spawn 비용
   회피.
3. **CodexAdapter** — ClaudeAdapter 와 동일 패턴으로 codex CLI 용 어댑터.
   `buildCommand` / `buildPrompt` / probe 만 다른 구조. ClaudeAdapter 의
   구현을 부분 추출 (e.g. `runViaBridge(bridge, ctx, sink, command)` 유틸)
   해 공유 가능.
4. **Claude 응답 파서** — stdout 의 JSON 출력을 `output` / `summary` 로
   매핑. `--output-format json` 같은 CLI 인자 결합도 같이 검토.
5. **사용자 설정 UI** — `command`, args, probe args 를 사용자가 설정 화면
   에서 입력 → ClaudeAdapter 옵션으로 주입.
