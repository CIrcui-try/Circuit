# Phase 3 Briefing

## Implemented

- **Host bridge 추출** (`app/src/host/bridge.ts`, `app/src/host/tauriBridge.ts`). 네 개 메서드 (`openRepositoryDialog`, `scanSkills`, `loadRepositories`, `saveRepositories`) 만 노출하는 `HostBridge` 인터페이스를 정의하고, `getHostBridge()` 가 `window.__CIRCUIT_BRIDGE__` 가 주입돼 있으면 그걸, 아니면 Tauri 구현 (`tauriHostBridge`) 을 반환한다. 그동안 컴포넌트와 store 가 `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-store`, `@tauri-apps/api/core` 를 직접 import 하던 부분이 모두 한 군데로 모였다 — Vitest, Playwright, 향후 다른 host 구현이 같은 한 면에서 가로채면 된다.
- **3개 프로덕션 호출지점 리팩터** — `RepositoryList.tsx` 의 `open(...)` 호출, `repositoryStore.ts` 의 `LazyStore` 사용, `skillStore.ts` 의 `invoke("scan_skills", ...)` 호출이 모두 `getHostBridge()` 를 거치도록 위임형으로 바뀌었다. Tauri 종속은 이제 `tauriBridge.ts` 한 파일 안에만 존재한다. 동작 자체는 변하지 않았다.
- **Sidebar 빈 상태 분기에 `data-testid="skill-list-empty"` 추가** + skill 목록 `<ul>` 에 `data-testid="skill-list"` 부여. Phase 4 에서 노드 추가 인터랙션이 들어올 때를 대비해 비어있는 상태와 비어있지 않은 상태 양쪽을 안정적으로 잡을 수 있도록 양쪽에 testid 를 부여했다.
- **Workspace / Canvas testid 추가** — `Workspace.tsx` 의 루트 `<div>` 에 `data-testid="workspace-root"`, `Canvas.tsx` 의 `<section>` 에 `data-testid="workflow-canvas"`. `RepositoryList.tsx` 의 Add 버튼에 `data-testid="add-repository-button"`, 목록 `<ul>` 에 `data-testid="repository-list"` 부여. Phase 1 시점에 이미 들어가 있던 `badge-claude` / `badge-codex` 는 그대로 유지.
- **Vitest 테스트 6개 파일을 브리지 모킹으로 마이그레이션** — `App.test.tsx`, `repositoryStore.test.ts`, `skillStore.test.ts`, `Sidebar.test.tsx`, `Workspace.test.tsx`, `RepositoryList.test.tsx`. 더 이상 `vi.mock("@tauri-apps/*", ...)` 으로 세 패키지를 각각 mocking 하지 않고, `vi.mock("../host/bridge", () => ({ getHostBridge: () => bridgeMock }))` 한 면만 mock 한다. Playwright 와 단일 mocking 패턴을 공유한다.
- **Fixture repo** `fixtures/repos/sample-repo/` 를 만들었다. `.claude/skills/implement-feature/SKILL.md`, `.codex/skills/review-code/SKILL.md`, `docs/ignored-skill/SKILL.md` 세 파일이 들어 있고, 마지막 파일은 *반드시 발견되지 않아야 하는* 음성 케이스다 (`.claude/skills` / `.codex/skills` 외부의 임의 SKILL.md 가 결과에 새지 않는지 확인하는 용도).
- **Rust 단위 테스트 2개** 를 `app/src-tauri/src/skill_scan.rs` 에 추가했다. `scan_skills_returns_only_recognized_skill_dirs` 는 위 fixture 에 대해 정확히 2개 skill 만 반환되고 그 어떤 항목도 `docs/` 경로를 포함하지 않음을 단언한다. 즉 path-restriction 규칙은 *Rust 측에서* 검증된다 — Playwright 는 mock 만 보므로 진짜 가드는 Rust 단위 테스트가 맡는다. `scan_skills_errors_for_missing_dir` 는 존재하지 않는 경로에 대해 `Err` 가 반환되는 회귀 가드.
- **Playwright 도입** (`@playwright/test` ^1.59, chromium 만 설치). `app/playwright.config.ts` 가 `npm run dev -- --port 1420 --strictPort` 를 `webServer` 로 띄우고, 로컬에선 `reuseExistingServer: true` 로 이미 떠 있는 dev 서버를 재사용한다. CI 에선 `forbidOnly` + `retries: 1` 로 보수화.
- **E2E smoke 5개** (`app/e2e/smoke.spec.ts`) — (E1) 앱이 떠서 "Repositories" 헤딩이 보임, (E2) repo 0 개일 때 안내 문구 + Add 버튼이 보임, (E3) Add 클릭 → mock `openRepositoryDialog` 가 fixture 경로 반환 → 행이 추가됨, (E4) workspace 진입 → `skill-list` 에 Implement Feature / Review Code 두 항목 + provider chip, (E5) 같은 workspace 에 "Ignored Skill" / "ignored-skill" 텍스트가 절대 새지 않음. 각 테스트는 `page.addInitScript` 로 `window.__CIRCUIT_BRIDGE__` 를 주입하므로 native macOS picker 는 직접 자동화하지 않는다.
- **Scripts 추가** (`app/package.json`): `test:e2e` (Playwright 단독), `test:e2e:install` (chromium 설치 헬퍼), `test:all` (Vitest → Playwright 직렬). CI 단일 진입점은 `pnpm test:all`.
- **Vitest 격리** — `vitest.config.ts` 의 `include` / `exclude` 를 명시해 `e2e/**` 가 Vitest 에 잡히지 않도록 했다. `vite.config.ts` 의 watch ignore 에도 `e2e/**` 를 추가해 dev 서버 HMR 이 e2e 파일 변경에 반응하지 않게 했다. `app/.gitignore` 에 `test-results`, `playwright-report`, `.playwright` 추가.

## Changed Files

신규:
- `app/src/host/bridge.ts` — `HostBridge` 인터페이스 + `getHostBridge()`.
- `app/src/host/tauriBridge.ts` — Tauri 의존을 단일 모듈로 격리한 실제 구현.
- `app/playwright.config.ts` — Vite dev 서버 자동 기동 + chromium 단독 프로젝트.
- `app/e2e/smoke.spec.ts` — E1 ~ E5 smoke 테스트.
- `app/e2e/fixtures/installBridge.ts` — `page.addInitScript` 로 `window.__CIRCUIT_BRIDGE__` 를 주입하는 헬퍼 + fixture 경로 상수.
- `fixtures/repos/sample-repo/.claude/skills/implement-feature/SKILL.md` — 양성 fixture (Claude provider).
- `fixtures/repos/sample-repo/.codex/skills/review-code/SKILL.md` — 양성 fixture (Codex provider).
- `fixtures/repos/sample-repo/docs/ignored-skill/SKILL.md` — 음성 fixture (반드시 무시되어야 함).
- `circuit_implementation_plan/phases/03-ui-e2e-test-infrastructure-briefing.md` — 본 브리핑.

수정:
- `app/src/routes/RepositoryList.tsx` — `open(...)` 직접 호출을 `getHostBridge().openRepositoryDialog()` 로 위임. Add 버튼과 목록 `<ul>` 에 testid 부여.
- `app/src/stores/repositoryStore.ts` — `LazyStore` 상수/인스턴스 제거, `bridge.loadRepositories` / `bridge.saveRepositories` 위임.
- `app/src/stores/skillStore.ts` — `invoke("scan_skills", ...)` 를 `bridge.scanSkills` 위임. Inline 으로 들고 있던 `RawSkill` 타입은 bridge.ts 로 이주.
- `app/src/components/layout/Sidebar.tsx` — 빈 상태 분기에 `skill-list-empty`, 목록 `<ul>` 에 `skill-list` testid 추가.
- `app/src/routes/Workspace.tsx` — 루트 `<div>` 에 `workspace-root` testid.
- `app/src/components/layout/Canvas.tsx` — `<section>` 에 `workflow-canvas` testid.
- `app/src-tauri/src/skill_scan.rs` — `#[cfg(test)] mod tests { ... }` 추가 (위 단위 테스트 2개).
- `app/src/App.test.tsx`, `app/src/stores/repositoryStore.test.ts`, `app/src/stores/skillStore.test.ts`, `app/src/components/layout/Sidebar.test.tsx`, `app/src/routes/Workspace.test.tsx`, `app/src/routes/RepositoryList.test.tsx` — 모두 `vi.mock("@tauri-apps/*", …)` → `vi.mock("../host/bridge", …)` 로 모킹 surface 통일. testid 단언 추가 (Sidebar SB3/SB4, Workspace W6, RepositoryList R1/R2/R3/R5).
- `app/package.json` — `test:e2e`, `test:e2e:install`, `test:all` 스크립트 추가; `@playwright/test` devDependency 추가.
- `app/pnpm-lock.yaml` — `@playwright/test` 추가에 따른 lockfile 갱신.
- `app/vite.config.ts` — watch ignore 에 `e2e/**` 추가.
- `app/vitest.config.ts` — `include` 를 `src/**/*.{test,spec}.{ts,tsx}` 로 좁히고 `e2e/**` 등 명시 exclude.
- `app/.gitignore` — `test-results`, `playwright-report`, `.playwright` 추가.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 유닛) | `cd app && pnpm test:run` | 8 files / **54 tests passed** (Duration ≈ 1.0 s) |
| Playwright (E2E) | `cd app && pnpm test:e2e` | **5 tests passed**, 5 workers 병렬 (≈ 1.4 s) |
| 통합 진입점 | `cd app && pnpm test:all` | Vitest 직후 Playwright, 양쪽 모두 통과 |
| Rust 단위 테스트 | `cd app/src-tauri && cargo test --lib skill_scan` | **2 tests passed** |
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 601 ms 빌드 (`dist/assets/index-*.js` 420.50 kB / gzip 135.38 kB) |
| 코드 에디터 의존성 부재 | `pnpm ls --depth=Infinity \| grep -ciE 'monaco\|codemirror'` | `0` (Phase 0/1 회귀 가드) |

스펙 체크리스트 매핑 (`circuit_implementation_plan/phases/03-ui-e2e-test-infrastructure.md` §Verification Checklist):

- [x] `pnpm test:run` 으로 core 테스트 실행 (Vitest).
- [x] `pnpm test:e2e` 로 Playwright 실행 (chromium).
- [x] Playwright 가 앱을 로드한다 (E1).
- [x] Native folder picker 를 직접 자동화하지 않는다 (`installMockBridge` 가 `openRepositoryDialog` 만 mock).
- [x] Tauri/host bridge 가 mock 가능하다 (`getHostBridge()` 가 `window.__CIRCUIT_BRIDGE__` 우선).
- [x] Fixture 에 Claude / Codex 양쪽 skill 이 들어 있다.
- [x] E2E 가 `.claude/skills` 와 `.codex/skills` 만 발견됨을 검증한다 (E4).
- [x] E2E 가 그 외 위치의 SKILL.md 가 무시됨을 검증한다 (E5). 진짜 path-restriction 가드는 Rust 단위 테스트 `scan_skills_returns_only_recognized_skill_dirs` 가 맡는다.
- [x] 핵심 UI 요소에 안정적인 `data-testid` 가 있다 (`repository-list`, `add-repository-button`, `skill-list`, `skill-list-empty`, `workspace-root`, `workflow-canvas`, `badge-claude`, `badge-codex`).

## Tests

추가 / 변경:

- Rust — `scan_skills_returns_only_recognized_skill_dirs`, `scan_skills_errors_for_missing_dir` (2개, fixture 경로는 `CARGO_MANIFEST_DIR/../../fixtures/repos/sample-repo`).
- Playwright — E1 (앱 로드), E2 (empty state), E3 (Add → mock dialog → 행 등장), E4 (workspace 진입 → skill-list 2 entries + provider chips), E5 (ignored-skill 부재).
- Vitest — Sidebar SB3/SB4 가 `skill-list-empty` / `skill-list` testid 를 단언, Workspace W6 가 `workspace-root` / `workflow-canvas` testid 를 단언, RepositoryList R1/R2/R3/R5 가 `add-repository-button` / `repository-list` testid 를 단언. 기존 51 개 테스트는 mocking 면 변경에 따라 모두 갱신, 신규 테스트와 합쳐 총 54 개.

실행 명령 / 결과:

```
cd app && pnpm test:all                 # vitest 54/54 + playwright 5/5
cd app/src-tauri && cargo test --lib skill_scan   # 2/2
```

## Known Limitations

- Playwright 는 Vite dev 서버만 대상으로 하며 packaged Tauri 앱은 다루지 않는다 (스펙 §Out of Scope 와 일치). Tauri 측 IPC / 윈도우 동작 자체에 대한 회귀는 여전히 수동 검증.
- Playwright 의 mock bridge 는 fixture 의 SKILL.md 본문을 *런타임에 읽지 않고* hardcoded payload 로 갖고 있다. 디스크의 fixture 와 mock 데이터가 어긋나면 Rust 단위 테스트가 잡지만 Playwright 단언은 그대로 통과할 수 있다 — Phase 4 이후 fixture 가 늘어나면 재평가.
- Repository 영속화 (`loadRepositories`/`saveRepositories`) 는 Tauri 런타임에서만 동작한다. Playwright 의 mock 은 in-memory 라 새로고침 직후 상태가 초기화된다 — smoke 테스트엔 영향 없지만 향후 영속화 회귀 테스트가 필요하면 mock 도 같이 영속화해야 한다.
- `e2e/` 디렉터리는 `tsconfig.json` 의 `include` 에 들어가지 않으므로 `tsc` 가 type-check 하지 않는다. Playwright 는 자체 ts-node 로 컴파일한다. Phase 4 이후 e2e 가 커지면 별도 `tsconfig.e2e.json` 분리를 검토.
- Workflow / Save / Start Circuit 버튼은 여전히 disabled placeholder. Phase 4 에서 활성화 예정.

## Next Recommendation

다음은 **Phase 4 — Visual Flow Editor** (`circuit_implementation_plan/phases/04-visual-flow-editor.md`). 이번에 깔린 인프라 위에서:

1. Sidebar 의 skill 항목을 HTML5 drag source 로 만들고, `Canvas` 가 drop 을 받아 새 노드로 생성. Skill ID (`${provider}:${rootDir}`) 가 결정론적이라 Phase 5 의 schema 변환에서 별도 매핑 없이 그대로 `skillRef` 로 쓸 수 있다.
2. `workflowStore` 신설 — React Flow 의 nodes/edges 만 들고 있고 schema 변환은 하지 않는다 (Editor / Schema / Runner 분리, AGENTS.md §1).
3. 노드 컴포넌트는 Sidebar 의 시각 언어 (이름 + provider chip) 를 그대로 재사용. 선택된 노드를 PropertiesPanel 에 노출 (편집은 Phase 5).
4. 기본 인터랙션 4개만: 노드 추가 / 노드 이동 / 노드 삭제 / 엣지 연결. 토폴로지 검증, loop / condition / approval 같은 노드 타입은 Schema 단계 (Phase 5).
5. 새로 추가할 testid: `skill-list__item` (drag source 식별), `node-properties-panel` (기존 PropertiesPanel 의 컨테이너), 그리고 노드별 `node-{id}` 혹은 `data-node-skill={skillId}` 정도. Playwright 시나리오는 TESTING_STRATEGY.md §Phase 04 에 명시된 "add skill as node, select node, connect nodes" 세 가지를 그대로 구현.
