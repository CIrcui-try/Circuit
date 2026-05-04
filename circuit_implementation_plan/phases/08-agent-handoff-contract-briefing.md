# Phase 8 Briefing

## Implemented

- **SCHEMA.md 에이전트 실행 계약 명문화** — Workflow / Skill Node / Edge 의 필수 필드를 표 형태로 정리. `skillRef.provider` 허용 값을 `claude` / `codex` / `shell` / `git` 으로 확장 (shell·git 은 reserved). 노드 출력 → 다음 노드 입력 placeholder 표기 `${steps.<sourceNodeId>.output}` 를 §Output → Input Placeholders 섹션으로 신설. 조건/루프/사람 승인은 §Out of Scope for Phase 08 박스에 명시.
- **SKILL_EXECUTION_CONTRACT.md 에 §Output → Input Resolution 추가** — runner 가 어댑터의 `execute` 직전에 `${steps.<id>.output}` 을 `previousOutputs[id].output` 으로 치환한다는 시점·규칙 정의. 값 전체 placeholder 면 raw 타입 주입, 문자열 끼워넣기는 `String(...)` 직렬화. typed output schema·경로 접근은 future work 로 명시. `provider` 타입을 4가지 union 으로 확장.
- **AgentAdapter 인터페이스 정의** — `app/src/runtime/adapters/AgentAdapter.ts` 신규. `provider`, `canHandle(skillRef)`, `execute(ctx)` 세 멤버만. `SkillExecutionContext` / `SkillExecutionResult` / `AgentRunEvent` 타입을 같은 파일에 인라인으로 두어 SKILL_EXECUTION_CONTRACT.md 와 1:1 매칭 — 별도 `runtime/contracts/*.ts` 파일은 아직 소비처가 없어 만들지 않았다 (CLAUDE.md §1·§3, AGENTS.md "deferred abstraction" 원칙).
- **WorkflowSkillProvider 확장 + UI 경계 보호** — `app/src/workflow/schema.ts` 의 `WorkflowSkillProvider` 를 `WORKFLOW_SKILL_PROVIDERS` const tuple 에서 파생되는 4-원 union 으로 변경. UI 의 `SkillProvider` (`stores/skillStore.ts`) 는 여전히 `claude | codex` narrow 로 두고, `fromWorkflow` 가 shell/git 을 만났을 때 명시적으로 거부하는 보강 검증을 추가 — 디스크 schema 는 4가지를 표현하지만 UI 런타임은 MVP 의 두 provider 만 처리.
- **provider 어댑터 책임 범위 문서화** — `RUNTIME_ARCHITECTURE.md` 에 §Provider Adapters 섹션 추가. claude / codex 는 SKILL.md 를 system prompt + `input` 을 user prompt 로 실행, shell / git 은 reserved 로 두고 향후 commandPolicy 통과 + read-only 한도를 명시.
- **`validateWorkflow` 순수 함수** — `app/src/workflow/validate.ts`. 외부 라이브러리 없이 (zod/ajv 미설치) workflow 객체의 필수 필드, `skillRef.provider` 허용 값, 노드 id 중복, edge `source`/`target` 의 노드 참조 무결성, `${steps.<id>.output}` placeholder 의 (a) 형식 (b) 가리키는 source 노드 존재 여부를 검사. 결과는 `{ ok: true } | { ok: false; errors: string[] }`. 기존 `serialize.ts` 의 가벼운 boundary 체크와는 책임 분리 — serialize 는 RF↔Workflow 양방향 변환, validate 는 임의 unknown 입력의 schema 적합성 (CLAUDE.md §3 의 "책임 경계가 명확해진 시점").
- **샘플 워크플로우 fixture** — `fixtures/workflows/sample-agent-handoff.json`. claude → codex 두 노드 + dependency edge 1개, 두 번째 노드의 `input.diff` 가 `${steps.node_implement.output}` 을 사용 (값 전체 placeholder), `input.prompt` 는 문자열 끼워넣기 형태 — 두 모드 모두 검증 테스트가 커버한다. `fixtures/repos/sample-repo/` 의 기존 SKILL.md 경로 (`.claude/skills/implement-feature/SKILL.md`, `.codex/skills/review-code/SKILL.md`) 와 정합.

## Changed Files

신규:

- `app/src/runtime/adapters/AgentAdapter.ts` — AgentAdapter 인터페이스 + Skill 실행 컨텍스트/결과/이벤트 타입.
- `app/src/workflow/validate.ts` — `validateWorkflow` 순수 검증 함수.
- `app/src/workflow/validate.test.ts` — Vitest 8 개 (V1–V8).
- `fixtures/workflows/sample-agent-handoff.json` — 에이전트가 그대로 읽을 수 있는 샘플 워크플로우.
- `circuit_implementation_plan/phases/08-agent-handoff-contract-briefing.md` — 본 브리핑.

수정:

- `SCHEMA.md` — 필수 필드 표, provider 4종, output→input placeholder 섹션, out-of-scope 박스.
- `SKILL_EXECUTION_CONTRACT.md` — provider union 확장, §Output → Input Resolution 신설.
- `RUNTIME_ARCHITECTURE.md` — §Provider Adapters 추가.
- `app/src/workflow/schema.ts` — `WORKFLOW_SKILL_PROVIDERS` const tuple + 파생 union.
- `app/src/workflow/serialize.ts` — `fromWorkflow` 가 shell/git provider 를 명시적으로 거부.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 단위) | `cd app && npm run test:run` | 15 files / **104 tests passed** (~1.66 s) |
| TypeScript + Vite 프로덕션 빌드 | `cd app && npm run build` | tsc 통과, Vite 630 ms 빌드 (`dist/assets/index-*.js` 432.47 kB / gzip 139.30 kB) |

E2E (Playwright) 와 Rust 테스트는 본 phase 의 변경 표면 (스키마 문서·TS 인터페이스·검증 함수) 과 무관해 회귀 영향 없음. 워크트리 안에서 `npm` 으로 받은 `package-lock.json` 은 정리해 git status clean 으로 종료했다.

CIR-19 §Verification Checklist 매핑:

- [x] Workflow JSON contains enough information for a future agent to know execution order — SCHEMA.md §Workflow / §Edge 필수 필드 표 + `fixtures/workflows/sample-agent-handoff.json` 의 nodes/edges 가 그대로 topological 순서를 표현.
- [x] Each node preserves provider and `SKILL.md` path — SCHEMA.md §Skill Node 표가 `skillRef.provider` / `skillRef.skillFile` 을 yes 로 표기 + `validateWorkflow` 가 둘 다 검사 (V1, V3, V5).
- [x] Input field is documented — SCHEMA.md §Skill Node 표 + `${steps.<id>.output}` 섹션이 free-form `Record<string, unknown>` 임을 명시.
- [x] Future output passing strategy is documented — SCHEMA.md §Output → Input Placeholders + SKILL_EXECUTION_CONTRACT.md §Output → Input Resolution.
- [x] Agent adapter boundary is documented — `AgentAdapter.ts` 의 인터페이스 + RUNTIME_ARCHITECTURE.md §Provider Adapters.
- [x] Schema validation tests exist — `validate.test.ts` (V1–V8).

## Tests

추가 / 변경:

- **Vitest — `app/src/workflow/validate.test.ts` (8 개, 신규 파일)**
  - V1 sample-agent-handoff fixture 가 통과
  - V2 missing repositoryId 거부
  - V3 unsupported provider (`openai`) 거부
  - V4 dangling edge target 거부
  - V5 missing skillRef 거부
  - V6 placeholder 가 가리키는 source 노드가 없으면 거부
  - V7 malformed placeholder shape (`${steps.x}` — `.output` 누락) 거부
  - V8 노드 id 중복 거부
- **회귀**: 기존 `serialize.test.ts` (SR1–SR5) 등 96 개 테스트 그대로 통과.

실행 명령 / 결과:

```
cd app && npm run test:run    # 15 files / 104 tests passed (≈1.66 s)
cd app && npm run build       # tsc + vite 630 ms
```

## Known Limitations

- **검증 라이브러리 미도입.** zod/ajv 등 외부 라이브러리는 의도적으로 skip — 현재 검증 규칙이 13줄 정도의 직선 코드라 라이브러리 도입은 over-engineering (CLAUDE.md §1). 향후 SKILL.md frontmatter input schema·typed output schema 를 도입할 때 zod 로 마이그레이션하는 것이 자연스럽다.
- **Placeholder 는 최상위 `output` 만.** `${steps.x.output.foo}` 같은 path 표현은 SCHEMA.md / SKILL_EXECUTION_CONTRACT.md 양쪽에서 future work 로 명시. typed output schema 가 들어오기 전에 path 표현만 풀면 형식 검증 비용이 비대해진다.
- **AgentAdapter 인터페이스만 정의 — 실제 어댑터·runner 통합은 없음.** `runtime/runner/`, `runtime/bridge/`, `runtime/safety/` 모듈은 RUNTIME_ARCHITECTURE.md 에 그려진 채로 비어 있다 (Phase 09+).
- **`runtime/contracts/*.ts` 파일을 만들지 않았다.** 인터페이스가 단일 소비처 (AgentAdapter.ts) 만 가지므로 인라인 정의로 충분 (CLAUDE.md §3). 실제 어댑터 구현이 추가되어 컨텍스트 타입을 두 곳 이상에서 import 하게 되는 시점에 분리.
- **`fromWorkflow` 는 shell/git provider 를 거부한다.** 디스크 schema 는 4가지를 표현해도 UI 런타임은 claude/codex 만 처리 — sample fixture 도 두 provider 만 사용. shell/git 어댑터 도입 phase 에서 UI 의 `SkillProvider` 를 함께 확장해야 한다.
- **`shell` / `git` provider 는 SKILL.md 의 frontmatter 안전 명령 contract 가 정해지기 전에는 활성화 금지.** RUNTIME_ARCHITECTURE.md §Safety Layer 의 commandPolicy / pathPolicy 와 함께 다음 phase 에서 묶어 다루는 것이 자연스럽다.

## Next Recommendation

다음은 **Phase 9 — Real Claude Adapter** (CIR-20 / `circuit_implementation_plan/phases/09-real-claude-adapter.md`). 본 phase 에서 인터페이스·placeholder 규약·검증·샘플이 모두 갖춰졌으니:

1. `AgentAdapter` 를 구현하는 `ClaudeAdapter` 를 `app/src/runtime/adapters/ClaudeAdapter.ts` 에 추가. SKILL.md 를 system prompt 로, `input` 을 user prompt 로 prepend.
2. `${steps.<id>.output}` placeholder resolver 를 runner 측에 (`app/src/runtime/runner/RealWorkflowRunner.ts`) 두고, 어댑터 호출 직전에 `previousOutputs` 로 치환. resolver 의 단위 테스트가 V6/V7 의 negative case 를 행위 측에서도 보장하도록 한다.
3. RUNTIME_ARCHITECTURE.md §Safety Layer 의 `timeoutPolicy` 부터 도입 — 모든 `execute` 호출에 timeout 강제. shell/git 활성화는 commandPolicy 가 들어온 뒤로 미룬다.
4. `mockRunner` 는 `RealWorkflowRunner` 가 들어와도 그대로 둬서 Phase 6/7 의 회귀 시나리오를 지킨다 (AGENTS.md §1).
5. E2E: 단일 노드 워크플로우 → Start → mock claude CLI 가 ok 출력 → 노드 success 와 `previousOutputs` 에 기록. real CLI binding 은 그 다음 phase.
