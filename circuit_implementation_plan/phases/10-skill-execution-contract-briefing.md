# Phase 10 Briefing — Skill Execution Contract (CIR-21)

## Implemented

- **Contracts 모듈 분리** — `app/src/runtime/contracts/SkillExecution.ts` 신설.
  Phase 8 이 `app/src/runtime/adapters/AgentAdapter.ts` 안에 인라인으로 두었던
  `SkillExecutionContext` / `SkillExecutionResult` / `AgentRunEvent` 를 본
  파일로 이동. Phase 8 briefing 의 "소비처가 두 곳 이상 생기면 contracts 로
  분리" 라는 후속 조건 (CLAUDE.md §3) 이 Phase 10 에서 처음 충족됨 —
  `AgentAdapter`, `buildSkillExecutionContext`, `buildDefaultPrompt`, 두 개의
  테스트 파일이 동일 타입을 가져온다.
- **AgentAdapter.ts 슬림화** — 기존 위치를 깨지 않기 위해 contracts 에서
  re-export 만 하도록 축소. `AgentAdapter` 인터페이스 본체만 남김.
- **`buildSkillExecutionContext`** — `app/src/runtime/context/buildSkillExecutionContext.ts` 신설.
  workflow `WorkflowSkillNode` + repository + previousOutputs 를 받아
  `SkillExecutionContext` 를 만든다.
  - skillFile resolution: `/` 시작이면 그대로 absolute, 아니면
    `repository.path + skillFile` 로 join 후 정규화. `..` 트래버설을 정규화하면
    repo root 밖으로 나갈 수 있으므로 `assertInsideRepoRoot` (Phase 9
    pathPolicy) 로 가드한다. 위반 시 `PathOutsideRepoRootError` 그대로 throw —
    별도 wrapping 없이 named error 를 노출해 호출자가 분기 가능.
  - SKILL.md content 는 의존성 주입된 `readSkillFile(absPath, repoRoot)` 으로
    읽는다. RuntimeBridge.readFile 시그니처와 동일해 후속 phase 에서
    `getRuntimeBridge().readFile` 를 그대로 주입할 수 있다. 테스트는 fake
    reader 로 RuntimeBridge / Tauri 의존성 없이 통과.
  - `skill.name` 은 `parseSkillMeta(content, basename(rootDir))` 로 추출
    (frontmatter `name` → 첫 `# heading` → 디렉토리 이름 fallback).
  - `execution.timeoutMs` 기본값 `DEFAULT_TIMEOUT_MS = 300_000` (5 분).
    `env` 가 미제공이면 출력 객체에서 `env` 키 자체를 생략 (exactOptionalProps
    에 안전).
  - `node.input` 미제공 → `{}` 보강.
- **`buildDefaultPrompt`** — `app/src/runtime/prompt/buildPrompt.ts`. 컨텍스트를
  결정적 markdown 문자열로 직렬화. 섹션 순서: `Skill heading` →
  `Repository` → `SKILL.md` → `Input` → `Previous Outputs` →
  `Execution Instructions`. 빈 input / previousOutputs 는 `(none)` 한 줄로
  표기. 실행 지시문은 `repository.path` 를 명시해 어댑터가 path 가드를 망각해도
  prompt 자체에 경계가 적힌다.
- **out-of-scope 유지** — 실제 Claude/Codex spawn, provider 별 prompt 최적화,
  condition/loop output routing, code mutation 검증은 phase 범위 밖. Linear
  CIR-21 의 §"Out of Scope for This Phase" 와 정합.

## Changed Files

신규:

- `app/src/runtime/contracts/SkillExecution.ts` — Skill 실행 계약 타입의 정식
  위치.
- `app/src/runtime/context/buildSkillExecutionContext.ts` — context 빌더 +
  내부 path normalize / dirname / basename 헬퍼.
- `app/src/runtime/context/buildSkillExecutionContext.test.ts` — Vitest
  케이스 8 개 (B1–B8).
- `app/src/runtime/prompt/buildPrompt.ts` — default prompt 직렬화.
- `app/src/runtime/prompt/buildPrompt.test.ts` — Vitest 케이스 6 개 (P1–P5
  + 섹션 순서 결정성).
- `circuit_implementation_plan/phases/10-skill-execution-contract-briefing.md`
  — 본 briefing.

수정:

- `app/src/runtime/adapters/AgentAdapter.ts` — 타입 정의를 contracts 에서
  re-export. `AgentAdapter` 인터페이스만 보존.

## Verification

| CIR-21 §Verification Checklist | 확인 방법 | 결과 |
| --- | --- | --- |
| workflow node → SkillExecutionContext 변환 가능 | B1 / B2 / B3 / B7 / B8 | OK |
| context 가 repository / skill / input / previousOutputs 포함 | B1 / B6 | OK |
| `SKILL.md` content 가 context 에 포함 | B1 / B7 (reader 결과를 그대로 `skill.content` 로 노출) | OK |
| repository 밖 skill path 거부 | B4 (`PathOutsideRepoRootError`), 정규화 후 `assertInsideRepoRoot` | OK |
| 기본 prompt 생성 | P1–P5 + 섹션 순서 결정성 테스트 | OK |
| contract 관련 unit test 존재 | 14 개 케이스 (context 8 + prompt 6) | OK |

실행 명령 / 결과:

```bash
cd app
npm run test:run    # 20 files / 136 tests passed (1.85 s)
npm run build       # tsc 통과 + vite 583 ms (dist/assets 432.40 kB / gzip 139.27 kB)
```

회귀: Phase 9 의 122 → 136 (+14, 본 phase 의 신규 케이스), 기존 122 개 모두
green.

## Tests

| 파일 | 케이스 수 | 비고 |
| --- | --- | --- |
| `app/src/runtime/context/buildSkillExecutionContext.test.ts` | 8 | B1 happy path / B2 relative resolve / B3 absolute passthrough / B4 escape rejection / B5 default+override timeout / B6 previousOutputs passthrough / B7 name fallback chain / B8 input default |
| `app/src/runtime/prompt/buildPrompt.test.ts` | 6 | P1 SKILL.md / P2 input JSON / P3 previousOutputs entries / P4 execution instructions / P5 (none) markers / 섹션 순서 결정성 |

## Runtime Notes

- `buildSkillExecutionContext` 는 RuntimeBridge 를 직접 import 하지 않고
  `readSkillFile` 함수만 받는다. 후속 phase 의 RealWorkflowRunner 가
  `getRuntimeBridge().readFile` 을 주입하면 그대로 동작 — 테스트는 fake
  함수로 통과시킨다 (Tauri / Playwright 없이 단위 검증).
- Path normalize 는 pathPolicy.ts 와 동일한 알고리즘을 작은 분량 (≈15 줄)
  으로 별도 정의. pathPolicy 의 normalize 는 비교 전용 internal helper 라
  shape 도 export 의도가 없었다. 동일 로직이 세 번째 호출자를 가지면 그 시점에
  공용 모듈 (`safety/pathOps.ts` 등) 로 묶는다 — 현재는 over-engineering 회피
  (CLAUDE.md §3).
- `DEFAULT_TIMEOUT_MS = 5 분` 은 컨텍스트의 기본값일 뿐. RUNTIME_ARCHITECTURE.md
  의 `timeoutPolicy` 가 도입되면 단일 source 로 정리해야 한다.
- 어댑터가 prompt 안의 `Execution Instructions` 문구를 system prompt 로
  다시 strip 하거나 구조화된 messages 로 분해할 가능성이 있다. 이 phase 의
  prompt 는 "default" 라 부르고, provider 별 최적화는 Claude/Codex 어댑터
  도입 phase 에서 별도 함수로 갈라낸다.
- 워크트리는 `origin` 미설정 상태로 종료 (Phase 9 와 동일). push / PR 은
  `/takeoff` 단계에서 origin 셋업 후 처리.

## Known Limitations

- `${steps.<id>.output}` placeholder 치환은 본 phase 범위 밖. SKILL_EXECUTION_CONTRACT.md
  §Output → Input Resolution 의 규약은 그대로 유지되며, 실제 치환은
  RealWorkflowRunner 가 어댑터의 `execute` 직전에 수행할 예정.
- previousOutputs 는 reference 그대로 ctx 에 들어간다 (clone 하지 않음). 호출
  측이 이후 mutate 하지 않는다는 가정. Phase 11+ 의 runner 가 이를 frozen 으로
  넘기는 게 자연스럽다.
- Windows backslash path 는 미고려 (MVP macOS 타깃, Tauri backend 도 POSIX
  기준 정규화).
- AgentAdapter 인터페이스만 존재하고 ClaudeAdapter / CodexAdapter 의 실제
  구현은 없음 (의도적, Phase 11+).
- prompt builder 는 `skill.content` 를 그대로 끼워 넣는다 — SKILL.md 가
  매우 큰 경우의 토큰 한도 처리, frontmatter 제거 옵션, multi-message 분할 등은
  provider 어댑터 도입 phase 에서 다룬다.

## Next Recommendation

1. **Phase 11 — RealWorkflowRunner**: workflow graph traversal 위에서
   `buildSkillExecutionContext` + `buildDefaultPrompt` + `RuntimeBridge.spawn`
   조합. 어댑터 호출 직전에 `${steps.<id>.output}` placeholder 치환 (SKILL_EXECUTION_CONTRACT.md
   §Output → Input Resolution).
2. **ClaudeAdapter** — `AgentAdapter` 의 첫 구체 구현. SKILL.md 를 system
   prompt 로, node `input` 을 user prompt 로 갈라 보내는 provider-specific
   prompt builder 가 등장하는 시점에 `buildDefaultPrompt` 와 책임을 분리.
3. **timeoutPolicy 모듈화** — 본 phase 의 `DEFAULT_TIMEOUT_MS` 와 RuntimeBridge
   의 spawn 시 `timeoutMs` 를 단일 source 로 묶는다. shell/git provider 활성화
   전에 commandPolicy 와 함께 정리.
4. **공용 path 헬퍼 추출 검토** — pathPolicy 내부 normalize 와 buildSkillExecutionContext
   내부 normalize 가 동일하다. 세 번째 사용처가 등장하면
   `runtime/safety/pathOps.ts` 로 묶는다.
5. **origin / takeoff 준비** — `/takeoff` 가 동작하려면 GitHub remote 가
   필요. Phase 9 와 마찬가지로 본 phase 도 로컬 머지 또는 origin 셋업까지
   보류 상태로 종료.
