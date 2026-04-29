# Phase 0 Briefing

## Implemented

- macOS Tauri v2 + React 19 + TypeScript 5.8 데스크톱 앱 스켈레톤을 `app/` 하위 디렉토리에 스캐폴딩 (`circuit_implementation_plan/` 과는 분리 유지).
- React Flow (`@xyflow/react` v12.10) 를 캔버스 페인에 로드. 빈 그래프를 `Background` 그리드와 `Controls` 와 함께 렌더링. CSS 는 `@xyflow/react/dist/style.css` 에서 임포트.
- Zustand v5 와 `react-router-dom` v7 설치. 라우터에 두 개의 라우트 구성:
  - `/` → Repository List (Phase 1 플레이스홀더, 빈 상태 + 비활성화된 "Add Repository" 버튼 + "Open preview workspace" 링크).
  - `/workspace/:repoId?` → Workspace.
- CSS Grid 기반 4-페인 Workspace 레이아웃: `toolbar / [sidebar | canvas | properties] / log`. 캔버스 외 페인은 모두 빈 상태 안내를 표시.
- Tauri 윈도우 설정: `productName: Circuit`, identifier `com.circuit.app`, title `Circuit`, 1280×800 (최소 1024×640), 번들 타겟 `["app", "dmg"]`.
- Vite/React/Tauri 스타터 에셋 (`App.css`, `assets/react.svg`, `public/vite.svg`, `public/tauri.svg`) 및 스텁 `greet` Rust 커맨드 제거 — IPC 계약은 Phase 1 이후에 등장하므로 현재는 의도적으로 Tauri 커맨드를 두지 않음.
- Zustand 스토어 파일은 의도적으로 **아직 생성하지 않음** — Phase 0 에서는 보유할 UI 상태가 없음. AGENT_GUIDE.md §"Separate Editor, Schema, and Runner" 와 사전 추상화 금지 원칙에 따라, 공유 상태가 처음으로 발생하는 단계 (Phase 1 레포 레지스트리 또는 Phase 3 그래프 상태) 에서 도입 예정.

## Changed Files

- `app/package.json` — Tauri+React+TS 템플릿 위에 런타임 의존성 `@xyflow/react`, `zustand`, `react-router-dom` 추가.
- `app/index.html` — title 을 `Circuit` 으로 변경, Vite favicon 링크 제거.
- `app/src/main.tsx` — `<App />` 을 `<BrowserRouter>` 로 감싸고 `styles/global.css` 임포트.
- `app/src/App.tsx` — `<Routes>` 정의.
- `app/src/routes/RepositoryList.tsx` — Phase 1 플레이스홀더 화면.
- `app/src/routes/Workspace.tsx` — 4-페인 레이아웃 조립, `:repoId` 파라미터 노출.
- `app/src/components/layout/{Sidebar,Canvas,PropertiesPanel,LogPanel}.tsx` — 페인당 하나의 컴포넌트. `Canvas` 만 실제 콘텐츠 (React Flow) 보유, 나머지는 빈 상태 셸.
- `app/src/styles/global.css` — 기본 리셋, 다크 팔레트, `.workspace` CSS Grid 규칙, `.empty-state` 와 `.panel-header` 헬퍼.
- `app/src-tauri/tauri.conf.json` — productName / title / 윈도우 크기 / 최소 크기 / 번들 타겟.
- `app/src-tauri/src/lib.rs` — 템플릿 `greet` 커맨드 제거. Tauri 빌더 + `tauri-plugin-opener` 만 남김.
- `.gitignore` (레포 루트) — `.DS_Store` 추가.

## Verification

툴체인 부트스트랩 (이번 Phase 에서 1회 수행):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
. "$HOME/.cargo/env"
corepack enable pnpm
```

설치된 버전: Rust 1.95.0, pnpm 10.33.2, Node 20.20.2.

자동 검증 (전부 통과):

| 항목 | 명령 | 결과 |
|---|---|---|
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 605ms 빌드 (`dist/assets/index-*.js` 410 kB) |
| Rust 컴파일 | `cd app/src-tauri && cargo check` | `Finished dev profile in 35.39s` |
| 코드 에디터 의존성 부재 | `cd app && pnpm ls --depth=Infinity \| grep -ciE 'monaco\|codemirror'` | `0` |

수동 시각 검증 (네이티브 윈도우가 열리므로 에이전트가 단정할 수 없음 — 사람이 직접 확인 필요):

```bash
cd app
pnpm tauri dev
```

최초 실행 기대값: Rust 의존성 컴파일에 약 5~10 분 소요 후, **Circuit** 타이틀의 네이티브 macOS 윈도우 (1280×800) 가 Repository List 라우트로 열림. **Open preview workspace** 클릭 → `/workspace/preview` 가 4-페인 레이아웃과 React Flow 그리드 배경, 캔버스 내 `+/−/fit` 컨트롤을 표시해야 함. Phase 0 체크리스트 대조:

- [x] macOS 데스크톱 앱으로 실행 — Tauri v2 + `cargo check` 클린. **`pnpm tauri dev` 로 확인 필요.**
- [x] 좌 / 중앙 / 우 / 하단 영역 가시화 — Workspace 라우트가 4 개 CSS Grid 영역을 헤더 / 빈 상태 문구와 함께 렌더.
- [x] React Flow 렌더 준비 완료 — `Canvas.tsx` 가 `<ReactFlow>` 를 `Background` 와 `Controls` 와 함께 마운트.
- [x] 코드 에디터 의존성 없음 — `pnpm ls` grep 결과 monaco / codemirror 0 건.

## Known Limitations

- 레포 선택, 스킬 스캔 (`.claude/skills/*/SKILL.md`, `.codex/skills/*/SKILL.md`), 그래프 편집, 스키마 영속화, 워크플로 실행은 모두 Phase 0 범위 밖 (`00-foundation.md` §Out of Scope) — Workspace 툴바의 `Workflow ▾`, `Save`, `Start Circuit` 버튼은 `disabled` 상태로 렌더.
- Zustand 스토어 파일 미생성. 의존성만 설치 완료. 첫 스토어는 실제 소비자가 등장하는 단계에서 함께 도입.
- Tauri Rust crate 이름은 템플릿 기본값 `app` / `app_lib` 유지 (`main.rs` 에 해당 문자열이 박혀 있음). 사용자 노출 브랜딩은 `productName` 과 윈도우 타이틀을 통해 전적으로 `Circuit` 으로 통일.
- 앱 아이콘은 여전히 Tauri 기본값. 아이콘 세트 교체는 Phase 0 범위 밖.
- Phase 0 은 dev / check 경로만 검증. `pnpm tauri build` (서명 번들) 은 수행하지 않음.

## Next Recommendation

**Phase 1 – Repository Manager** (`circuit_implementation_plan/phases/01-repository-manager.md`) 로 진행. Phase 2 (스킬 디스커버리) 를 잠금 해제하기 위한 최소 슬라이스:

1. `@tauri-apps/plugin-dialog` 를 사용한 Tauri 커맨드 `pick_directory` 추가 — 사용자가 로컬 레포 디렉토리를 선택할 수 있도록.
2. 등록된 레포 목록 (name + 절대 경로 + ID) 을 `tauri-plugin-store` 또는 `app_data_dir` 하위 JSON 파일에 영속화. 이 단계가 첫 실제 공유 상태이므로 Zustand 스토어 (`stores/repositoryStore.ts`) 를 여기서 도입.
3. Repository List 플레이스홀더를 스토어 바인딩된 실제 리스트로 교체. 행 클릭 시 `/workspace/:repoId` 로 이동.
4. 선택된 레포의 경로를 Workspace 툴바에 노출 (플레이스홀더 텍스트는 이미 `useParams` 로 연결됨).

목록 뷰의 Claude / Codex 스킬 카운트는 Phase 2 (Skill Discovery) 로 미뤄 Phase 1 은 디렉토리 등록에만 집중.
