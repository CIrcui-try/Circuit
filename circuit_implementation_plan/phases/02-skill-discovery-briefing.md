# Phase 2 Briefing

## Implemented

- Rust 측에 `scan_skills(repoPath)` Tauri 커맨드 (`app/src-tauri/src/skill_scan.rs`) 를 신설했다. `tauri-plugin-fs` 를 도입하지 않고 `std::fs::read_dir` 만으로 `<repo>/.claude/skills/*/SKILL.md` 와 `<repo>/.codex/skills/*/SKILL.md` 두 경로만 정확히 한 단계만 스캔한다. 재귀 스캔, 글로벌 스킬 디렉터리, 임의 위치의 `SKILL.md` 는 모두 의도적으로 보지 않는다. `.claude` 또는 `.codex` 자체가 없으면 에러가 아닌 zero skill 로 처리하고, repo 경로 자체가 없으면 `Err("repository path does not exist")` 를 반환한다.
- 공식 파일명은 `SKILL.md` 이며 동일 디렉터리에 `SKILL.md` 가 있으면 그것을, 없을 때만 소문자 `skill.md` 를 호환 모드로 받는다 (Phase 02 doc §Scope). IPC 페이로드를 키우지 않으려고 파일 본문은 16 KiB 까지만 char-boundary 안전하게 잘라서 반환하고, 결과는 `(provider, dirName)` 으로 정렬해 React 키가 흔들리지 않도록 했다. `lib.rs` 에 `mod skill_scan` 와 `invoke_handler(generate_handler![scan_skills])` 만 추가 — 새 capability permission 은 추가하지 않았다 (custom command 는 `core:default` 로 충분).
- TypeScript 메타데이터 파서 `app/src/skills/parseSkillMeta.ts` 를 추가했다. 외부 YAML 의존성 없이 (1) 파일이 `---` 로 시작하면 단순 `key: value` 라인만 파싱해 `name`/`description` 추출, (2) 없으면 첫 H1 (`# ...`) 을 이름으로 사용, (3) 그래도 없으면 디렉터리명을 폴백, (4) `description` 은 없을 때 빈 문자열. 따옴표(`"`/`'`) 로 감싸진 값은 자동으로 벗겨내고, 닫는 `---` 가 없는 깨진 frontmatter 도 H1 폴백으로 우아하게 빠져나간다. 순수 함수라 vitest 만으로 검증한다.
- 두 번째 Zustand 스토어 `app/src/stores/skillStore.ts` 를 도입했다. `byRepo: Record<repoId, Skill[]>`, `loading`, `errors` 만 들고 `scanRepository(repoId, repoPath)` 한 액션으로 IPC → 파서 → Skill 객체 변환을 묶었다. Skill ID 는 `${provider}:${rootDir}` 로 결정론적이라 재스캔 시 React 키가 churn 되지 않으며, Phase 3 에서 노드의 `skillRef` 로 그대로 쓸 수 있는 형태다. 동일 `repoId` 로 동시에 들어오는 호출은 `loading[repoId]` 플래그로 1회만 실제 호출되도록 dedupe 한다. 영속화는 의도적으로 생략 — 파일 시스템이 ground truth 이므로 세션마다 다시 스캔한다.
- Workspace 진입 시 활성 저장소에 대해 자동으로 `scanRepository(repo.id, repo.path)` 를 호출한다 (`app/src/routes/Workspace.tsx`). Sidebar (`app/src/components/layout/Sidebar.tsx`) 는 더 이상 placeholder 가 아니라 스토어에서 활성 repo 의 스킬 배열을 구독해 `이름 + provider 칩 + 한 줄 description` 형태로 렌더한다. provider 별 칩 색상은 분리했고, 빈 상태 / 스캔 중 / 에러 footer 도 분기한다.
- Repository List 에 Phase 1 에서 미뤄둔 Claude/Codex 스킬 카운트 뱃지를 도입했다 (`app/src/routes/RepositoryList.tsx`). hydrate 직후 **모든 hydrated repo 에 대해 마운트마다 `scanRepository` 를 fire-and-forget 으로 흘린다** (Repository List 진입 자체를 manual trigger 로 취급 — Workspace 진입과 동일 정책). 캐시가 이미 있어도 다시 스캔하므로, 디스크에서 SKILL.md 가 추가/삭제되면 사용자가 페이지로 돌아오는 순간 카운트가 갱신된다. 동일 `repoId` 의 in-flight 호출은 `skillStore.loading` 가드로 dedupe 된다. 각 행은 `Claude · N` / `Codex · M` 두 뱃지를 갖고, 결과 도착 전엔 `Claude · …` 로 표시한다. 뱃지에는 `data-testid="badge-claude"` / `badge-codex` 를 부여해 UI 테스트가 의존하지 않을 텍스트 fragmentation 에 흔들리지 않도록 했다.
- 각 repo 행 **우상단에 작은 `×` 아이콘 버튼** 을 추가했다 (평소엔 opacity 0, 행 hover / 키보드 focus 시 노출). 클릭 시 `window.confirm` 으로 한 번 확인한 뒤 `repositoryStore.removeRepository(id)` 를 호출 — 등록만 해제하고 디스크의 폴더는 건드리지 않는다. `selectedId` 가 제거 대상이면 `null` 로 리셋하고, `LazyStore.set` + `save` 로 영속화한다. `aria-label="Remove {name}"` 로 스크린리더 / 테스트 접근성을 유지하며, `skillStore.byRepo[id]` 의 dangling 캐시는 의도적으로 남겨둔다 (다음 등록 시 새 UUID 라 충돌 없음).
- `app/src/styles/global.css` 에 `.repository-list__badge(s)`, `.skill-list*` 룰을 추가했다 (Claude 는 푸른 톤, Codex 는 보라 톤으로 시각 구분).

## Changed Files

신규:
- `app/src-tauri/src/skill_scan.rs` — `scan_skills` 커맨드 + `RawSkill` 직렬화 + 16 KiB 본문 트렁케이트.
- `app/src/skills/parseSkillMeta.ts` — frontmatter / H1 / dirname 폴백 순으로 `(name, description)` 결정하는 순수 파서.
- `app/src/skills/parseSkillMeta.test.ts` — P1~P8 (frontmatter 정상, 따옴표, name 누락 시 H1, frontmatter 부재 시 H1, 둘 다 부재 시 dirname, 닫는 `---` 누락, 미사용 키 무시, 빈 컨텐츠).
- `app/src/stores/skillStore.ts` — Zustand 스토어. `scanRepository` 한 액션.
- `app/src/stores/skillStore.test.ts` — S1~S4 (RawSkill→Skill 매핑 + 결정론 ID, 에러 메시지 surface, 동시 호출 dedupe, non-Error rejection 문자열화).
- `app/src/components/layout/Sidebar.test.tsx` — SB1~SB5 (no repo / scanning / 빈 결과 / 정상 렌더 / 에러 footer).
- `circuit_implementation_plan/phases/02-skill-discovery-briefing.md` — 본 브리핑.

수정:
- `app/src-tauri/src/lib.rs` — `mod skill_scan;` 와 `invoke_handler(generate_handler![skill_scan::scan_skills])` 추가.
- `app/src/components/layout/Sidebar.tsx` — placeholder 제거, 실제 스킬 리스트 / 빈 / 로딩 / 에러 분기 렌더.
- `app/src/routes/Workspace.tsx` — Workspace 마운트 시 `scanRepository(repo.id, repo.path)` 트리거, `Sidebar repoId={repo?.id}` 전달.
- `app/src/routes/RepositoryList.tsx` — 뱃지 + 자동 백그라운드 스캔 (마운트마다 항상 재스캔) + 신규 추가 시 즉시 스캔 + 행 우측 Remove 버튼.
- `app/src/routes/RepositoryList.test.tsx` — `@tauri-apps/api/core` 모킹 + R6 (카운트 뱃지) / R7 (스캔 중 ellipsis) / R8 (hydrate 후 자동 스캔 트리거) / R9 (캐시 있어도 마운트 재스캔) / R10 (Remove 버튼 + confirm).
- `app/src/stores/repositoryStore.ts` — `removeRepository(id)` 액션 추가 (LazyStore set/save 로 영속화, selectedId 가 대상이면 null 로 리셋).
- `app/src/stores/repositoryStore.test.ts` — Rm1 (제거 + 미존재 id no-op), Rm2 (selectedId 리셋 / 비대상은 보존).
- `app/src/routes/Workspace.test.tsx` — `@tauri-apps/api/core` 모킹 + W5b (scan_skills 가 활성 repo 경로로 호출).
- `app/src/components/layout/layout.test.tsx` — Sidebar 빈 상태 문구 변경 ("Skills will appear here…" → "No repository selected.") 에 맞춰 어서션 갱신.
- `app/src/styles/global.css` — `.repository-list__badges`, `.repository-list__badge--{claude,codex}`, `.skill-list`, `.skill-list__{item,row,name,chip,desc,error}` 룰 추가.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 유닛) | `cd app && pnpm test:run` | 8 files / **51 tests passed** (Duration 1.44 s) |
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 588 ms 빌드 (`dist/assets/index-*.js` 419.77 kB / gzip 135.21 kB) |
| Rust 컴파일 | `cd app/src-tauri && cargo check` | `Finished dev profile in 1.25 s` (skill_scan 포함, 신규 의존성 0 개) |
| 코드 에디터 의존성 부재 | `cd app && pnpm ls --depth=Infinity \| grep -ciE 'monaco\|codemirror'` | `0` (Phase 0/1 회귀 가드) |

새로 추가된 테스트 케이스 매핑:

- 파서 — P1 frontmatter 정상, P2 따옴표 strip, P3 name 누락 시 H1, P4 frontmatter 없음 + H1, P5 frontmatter/H1 둘 다 없음 → dirname, P6 닫는 `---` 누락 → H1, P7 미사용 키 무시, P8 빈 컨텐츠.
- 스토어 — S1 IPC payload → Skill 매핑 + 결정론 ID, S2 IPC reject 시 error surface + byRepo 미설정, S3 동일 repoId 동시 호출 dedupe (invoke 1회), S4 비-Error 거부값 문자열화.
- Sidebar — SB1 repo 미선택, SB2 로딩, SB3 빈, SB4 정상 렌더 (이름 + 칩 + description), SB5 에러 footer.
- RepositoryList — R6 카운트 뱃지 (Claude · 2 / Codex · 1), R7 ellipsis 플레이스홀더, R8 hydrate 후 자동 스캔, R9 캐시가 있어도 마운트마다 재스캔 (cache-bust 회귀 가드), R10 Remove 버튼 + confirm 다이얼로그 (cancel 시 변화 없음, OK 시 행 제거 + 영속화).
- repositoryStore — Rm1 `removeRepository(id)` 가 매칭 repo 만 제거하고 store.set/save 호출, 미존재 id 는 no-op, Rm2 selectedId 가 제거 대상이면 null 리셋, 비대상이면 그대로 유지.
- Workspace — W5b 마운트 시 `scan_skills` 가 활성 repo 의 경로로 호출.

수동 검증 (사용자가 `pnpm tauri dev` 로 직접 확인 — 네이티브 윈도우 동작은 에이전트가 단정 불가):

- [x] `<repo>/.claude/skills/foo/SKILL.md` 와 `<repo>/.codex/skills/bar/SKILL.md` 를 가진 폴더를 추가 → Repository List 행에 `Claude · 1 / Codex · 1` 뱃지가 잠깐 `…` 후 정확한 카운트로 갱신.
- [x] 빈 repo 등록 → Workspace 다녀온 뒤 디스크에 `.claude/skills/foo/SKILL.md` 추가 → Repository List 로 다시 들어가면 카운트가 `…` 거쳐 `Claude · 1` 로 갱신 (마운트 재스캔 회귀 가드).
- [x] 행 위에 마우스를 올리면 우상단에 `×` 아이콘이 나타남 → 클릭 → 확인 다이얼로그에서 OK → 행 제거, 앱 재시작 후에도 제거 상태 유지. Cancel 시 변화 없음. 디스크 폴더는 그대로.
- [x] 그 repo 를 클릭해 Workspace 에 진입 → 좌측 Sidebar 에 두 스킬이 이름/description/provider 칩과 함께 표시.
- [ ] `<repo>/SKILL.md` 또는 `<repo>/some/nested/path/SKILL.md` 를 추가로 두어도 목록에 나타나지 않음 (재귀 스캔 금지 회귀 가드).
- [ ] `<repo>/.claude/skills/foo/skill.md` (소문자) 만 있는 폴더 → 호환 모드로 발견됨 + Sidebar 에 동일하게 표시.
- [ ] `.claude` 와 `.codex` 어느 쪽도 없는 폴더 → `Claude · 0 / Codex · 0`, Sidebar 는 "No skills found in `.claude/skills` or `.codex/skills`." 빈 상태.
- [ ] 앱 재시작 → 저장소는 그대로 유지되고, 진입 즉시 자동 재스캔되어 카운트가 다시 채워짐.

## Known Limitations

- **세션 간 캐시 없음**: Skill 목록은 영속화하지 않는다. 매 세션마다 다시 스캔한다 — 파일 시스템이 ground truth 이므로 의도된 동작이며, Phase 02 verification 도 캐시를 요구하지 않는다.
- **FS watch 없음**: 앱 실행 중에 외부에서 SKILL.md 가 추가/삭제돼도 자동으로 반영되지 않는다. Workspace 재진입 또는 앱 재시작이 트리거다 (`AGENTS.md` §"Manual Trigger Only" 와 일관).
- **Description 1줄 트렁케이트**: Sidebar 의 description 은 `text-overflow: ellipsis` 로 한 줄만 보인다. 멀티라인 표시 / 호버 툴팁은 도입하지 않았다.
- **frontmatter 파서는 의도적으로 단순**: 다중 라인 값, 리스트, 중첩 구조, escape 문자열, JSON-style 값은 처리하지 않는다. 실제 SKILL.md 는 shallow `key: value` 만 사용하며, 외부 YAML 의존성 (js-yaml 등) 추가는 YAGNI.
- **본문 16 KiB 트렁케이트**: 매우 긴 SKILL.md 도 IPC payload 를 폭발시키지 않으려고 16 KiB 에서 자른다. 파서가 보는 frontmatter / H1 은 항상 파일 앞쪽이라 잘림 영향이 없다.
- **에러 UI 단순**: 에러는 Sidebar 좌측 하단 footer 에만 빨간 줄로 표시되고, Repository List 뱃지는 에러일 때 `Claude · —` 폴백을 보여준다. 별도 토스트나 재시도 버튼은 도입하지 않았다.
- **드래그 / 노드화 미지원**: 사이드바의 스킬을 캔버스로 드래그해 노드로 만드는 동작은 Phase 3 의 영역이라 의도적으로 빠져 있다.
- **provider 화이트리스트 고정**: `claude` / `codex` 두 종만 스캔한다. 새 provider 추가는 `PROVIDERS` 상수만 늘리면 되지만 현재는 SCHEMA.md 와 1:1.
- **Repository List 뱃지 클릭 동작 없음**: 뱃지는 단순 라벨이며 별도 토글 / 필터 동작을 하지 않는다.
- **권한 표면 무변화**: capabilities 는 Phase 1 시점에서 아무것도 추가되지 않았다 (custom Tauri command 는 기본 허용).

## Next Recommendation

다음은 **Phase 3 – Visual Flow Editor** (`circuit_implementation_plan/phases/03-visual-flow-editor.md`). 우선 작업 슬라이스 제안:

1. Sidebar 의 각 스킬 항목을 HTML5 drag source 로 만들고, `Canvas` (React Flow) 쪽에서 drop 을 받아 새 노드로 추가. SCHEMA.md 의 Skill Node 형태 (`skillRef.provider` + `skillRef.skillFile`) 를 그대로 사용하면 Phase 4 의 schema 영속화 단계에서 별도 매핑이 불필요하다 — Skill ID 가 결정론적인 것도 같은 이유다.
2. React Flow 의 `nodes` / `edges` 상태를 다룰 새 `workflowStore` 도입 (스킬과 분리). Editor / Schema / Runner 분리 원칙 (`AGENTS.md` §1) 을 지키기 위해 Editor 단계에서는 Schema 변환을 미리 하지 않는다.
3. 기본 노드 컴포넌트에 provider 칩과 이름을 표시 (Sidebar 와 동일 시각 언어). 선택된 노드를 우측 PropertiesPanel 에 노출 (편집은 Phase 4 에서).
4. 노드/엣지 삭제, 노드 이동, 엣지 연결의 4 가지 기본 인터랙션만 구현. 토폴로지 검증, loop / condition / approval 같은 미래 노드 타입은 Schema 단계에서 다룬다.
5. UI + 유닛 테스트는 (a) workflowStore 의 add/remove/connect, (b) Sidebar→Canvas drop 시 노드 생성, (c) Properties 패널의 선택 동기화 정도가 적절한 슬라이스다.
