# Phase 13 Briefing — Codex Adapter (CIR-24)

## Implemented

- **CodexAdapter** — `app/src/runtime/adapters/CodexAdapter.ts` 신설.
  `AgentAdapter` 의 두 번째 구체 구현. `provider` 가 `"codex"` 로 고정.
  생성자에 `RuntimeBridge` 를 주입받아 `canRun` / `run` 을 모두 bridge 로
  위임. ClaudeAdapter 와 동일한 옵션 표면 (`buildCommand` / `buildPrompt`
  / `probeCommand` / `probeTimeoutMs` / `skipProbe` / `newRunId`) 을
  제공하여 어댑터 등록 / 사용 시 두 어댑터를 동일 패턴으로 다룰 수 있다.
- **runViaBridge 공유 헬퍼** — `app/src/runtime/adapters/runViaBridge.ts`
  신설. ClaudeAdapter 의 `canRun` probe 흐름과 `run` 의
  `RuntimeProcessEvent` → `AgentRunEvent` 매핑·terminal → `status` 매핑을
  `probeViaBridge(...)` / `runViaBridge(...)` 두 함수로 추출. ClaudeAdapter
  / CodexAdapter 가 동일한 헬퍼를 호출. 어댑터별 차이는 옵션 default
  3종 (`provider` 식별자 / `DEFAULT_PROBE` / `defaultBuildCommand`) 으로
  국한된다. (Phase 12 §Next Recommendation §3 의 권장사항을 본 phase 에서
  함께 처리.)
- **ClaudeAdapter 내부 리팩터링** — `app/src/runtime/adapters/ClaudeAdapter.ts`
  의 `canRun` / `run` 본문을 `probeViaBridge` / `runViaBridge` 호출로
  교체. **public API (`ClaudeAdapter`, `ClaudeAdapterOptions`,
  `ClaudeCommand`, `provider`, `canRun`, `run`, 옵션 기본값) 100% 동일
  유지.** 기존 14 케이스 (`ClaudeAdapter.test.ts`) 를 변경 없이 그대로
  통과시켜 회귀를 가드한다.
- **Codex 기본값** — probe `codex --version` (timeout 5_000ms),
  `defaultBuildCommand` `(_, prompt) => ({ command: "codex", args:
  ["exec", prompt] })`. 근거: OpenAI codex CLI 의 비대화형 단발 실행
  형태. PATH 의존을 피하려면 호출자가 `buildCommand` 옵션으로 절대 경로
  / 다른 entrypoint 주입.
- **이벤트 매핑 (헬퍼 내부, 양 어댑터 공통)**
  | RuntimeProcessEvent | AgentRunEvent | terminal? | status |
  | --- | --- | --- | --- |
  | `started` | `start { message: "spawn <cmd>" }` | no | — |
  | `stdout` | `stdout { text }` | no | — |
  | `stderr` | `stderr { text }` | no | — |
  | `exited` | `finish { exitCode }` | yes | `success` (0) / `failed` (≠0) |
  | `cancelled` | `error { message: "cancelled" }` | yes | `cancelled` |
  | `timeout` | `error { message: "timeout" }` | yes | `timeout` |
  | `error` | `error { message }` | yes | `failed` |
  terminal 수신 시 `unsubscribe` 후 `SkillExecutionResult` (logs,
  startedAt, finishedAt, status, exitCode?) 반환. `exitCode` 는
  `exited` 매핑 시에만 채운다. 두 번째 terminal 이벤트는 무시
  (idempotent finish guard).
- **Codex 테스트 (vitest, mocked RuntimeBridge)** —
  `app/src/runtime/adapters/CodexAdapter.test.ts` 14 케이스. ClaudeAdapter
  의 spy / makeContext 패턴을 그대로 따르되 `skill.provider` 와 default
  command 검증 부분만 codex 에 맞춰 갱신.

## Changed Files

신규:

- `app/src/runtime/adapters/runViaBridge.ts` — `probeViaBridge` /
  `runViaBridge` 공유 헬퍼.
- `app/src/runtime/adapters/CodexAdapter.ts` — provider="codex" 어댑터.
- `app/src/runtime/adapters/CodexAdapter.test.ts` — vitest 14 케이스.
- `circuit_implementation_plan/phases/13-codex-adapter-briefing.md` —
  본 브리핑.

수정:

- `app/src/runtime/adapters/ClaudeAdapter.ts` — 내부 본문을 헬퍼 호출로
  교체. public API 동일.

## Verification

| CIR-24 §Verification Checklist | 확인 방법 | 결과 |
| --- | --- | --- |
| CodexAdapter 가 AgentAdapter 를 구현 | `tsc` 통과 + C1 | OK |
| provider 가 `codex` | C1 | OK |
| Codex command 가 설정 가능 | C8 (`buildCommand` 오버라이드 → spawn args 변경) | OK |
| RuntimeBridge 를 통해 process 실행 | C2 / C6 (`bridge.spawn` 인자 검증) | OK |
| cwd 가 repository path 로 설정 | C6 (`spawnCalls[0].cwd === ctx.execution.cwd`) | OK |
| prompt 에 SKILL.md content + node input 포함 | C7 (default builder) + C8 (override) | OK |
| stdout/stderr 가 run log event 로 전달 | C9 (순서 + payload) | OK |
| exit code 에 따라 success/failed 결정 | C10 + C11 (`exited(0)` → success, `exited(2)` → failed) | OK |
| mocked RuntimeBridge 테스트 존재 | 14 케이스 모두 | OK |

추가 회귀 가드 (헬퍼 추출 부수효과):

- ClaudeAdapter.test.ts 14 케이스가 코드 변경 없이 그린 — public API
  보존 검증.
- 전체 vitest 24 file / 177 case 그린 (Phase 12 의 23 file / 163 case
  대비 CodexAdapter 14 케이스 신규).

실행 명령 / 결과:

```bash
cd app
npm run test:run    # 24 file / 177 case green
npm run build       # tsc + vite 그린
```

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `app/src/runtime/adapters/CodexAdapter.test.ts` | 14 | C1 provider / C2 probe ok / C3 probe non-zero / C4 probe error / C5 skipProbe / C6 spawn cwd·env·timeout / C7 default `codex exec <prompt>` + prompt 내용 / C8 custom builder / C9 event 매핑 순서 / C10 success result / C11 terminal 매핑 (4 sub) |
| `app/src/runtime/adapters/ClaudeAdapter.test.ts` | 14 | 변경 없음. 헬퍼 통합 회귀 가드 역할. |

## Runtime Notes

- 기본 command 는 `codex` (PATH 의존). `codex exec <prompt>` 는 OpenAI
  codex CLI 의 비대화형 단발 실행 형태. 환경에 따라 `buildCommand` 옵션
  으로 절대 경로 / `chat` 서브커맨드 / wrapper script 주입 가능.
- probe 기본 timeout 은 5초. ClaudeAdapter 와 동일하게 매번 호출 시
  비용이 누적되므로 후속 phase 에서 registry / runner 레벨 캐싱 권장.
- 어댑터는 `previousOutputs` 를 prompt 에 주입하지 않는다. placeholder
  치환은 RealWorkflowRunner 가 입력에서 처리한 뒤 어댑터로 전달하는 흐름
  가정 (Phase 12 와 동일).
- `bridge.spawn` reject 케이스를 `error` 이벤트와 동일하게 처리.
  `run` 은 절대 reject 하지 않고 항상 result 로 resolve — runner 의
  처리 단순화.
- 헬퍼는 캐싱·재시도·로깅 정책을 갖지 않는다. 그 책임은 runner /
  registry 레이어로 분리.
- 워크트리는 `origin` 미설정 상태 (Phase 9–12 와 동일). push / PR 은
  `/takeoff` 단계에서 origin 셋업 후 처리.

## Known Limitations

- `AdapterRegistry` 에 자동 등록되지 않는다. RealWorkflowRunner 도입
  phase 에서 `registry.register(new CodexAdapter({ bridge }))` /
  `registry.register(new ClaudeAdapter({ bridge }))` 가 추가될 예정.
- Codex 응답의 구조화 파싱 없음. `summary` / `output` 필드는 비어 있음.
  후속 phase 의 응답 파서가 들어가는 자리 (`--output-format json` 등의
  CLI 인자 결합 검토 포함).
- multi-turn / session 관리 없음. 매 노드 실행이 독립 프로세스.
- 자동 retry 없음. 재시도 정책은 runner 책임.
- 실 CLI 와의 통합 테스트 (Tauri `runtime_spawn` Rust 측 동작 확인) 미수행
  — mocked bridge 단위 테스트만 존재. Rust 측 통합은 후속 phase.
- probe 결과를 캐시하지 않는다. canRun 호출마다 spawn 발생.
- `BridgeCommand` (헬퍼) 와 `ClaudeCommand` / `CodexCommand` (어댑터)
  은 형태가 동일하지만 별개로 export. 두 어댑터 type 이 향후 갈라질 여지
  를 위해 의도적으로 통합하지 않음.

## Next Recommendation

1. **RealWorkflowRunner skeleton** — 워크플로우 그래프 traversal 위에서
   `AdapterRegistry.get(provider)` → `canRun` 가드 → `run` 호출 →
   `previousOutputs` 누적의 흐름 + `${steps.<id>.output}` placeholder 치환.
   ClaudeAdapter / CodexAdapter 두 어댑터를 registry 에 등록하는 첫
   사용처.
2. **Provider availability cache** — runner 또는 registry 레벨에서
   canRun 결과를 워크플로우 실행 단위 (또는 짧은 TTL) 로 캐시. 매 노드
   spawn 비용 회피.
3. **Codex 응답 파서** — stdout 의 JSON / structured output 을
   `output` / `summary` 로 매핑. CLI 인자 (`--output-format`,
   `--json` 등) 결합도 같이 검토.
4. **사용자 설정 UI** — `command`, args, probe args 를 사용자가 설정
   화면에서 입력 → ClaudeAdapter / CodexAdapter 옵션으로 주입.
5. **헬퍼-only 단위 테스트** — 현재는 어댑터 테스트가 헬퍼를 통합
   테스트하지만, 헬퍼 자체에만 적용되는 시나리오 (예: spawn reject
   path, listener 등록 전 이벤트 도착) 가 늘어나면
   `runViaBridge.test.ts` 추가 검토.
