# Phase 1 Briefing

## Implemented

- macOS 폴더 선택 다이얼로그(`@tauri-apps/plugin-dialog`)와 로컬 영속 스토어(`@tauri-apps/plugin-store`)를 도입하여, 사용자가 로컬 저장소를 등록/조회/전환할 수 있게 했다. 두 플러그인은 Rust 측 `Cargo.toml`/`lib.rs`에 등록하고 capabilities에 `dialog:allow-open`, `store:default`만 최소 권한으로 추가했다.
- 첫 번째 Zustand 스토어인 `app/src/stores/repositoryStore.ts` 를 추가했다. `repositories`, `selectedId`, `hydrated` 상태와 `hydrate()`, `addRepository(path)`, `selectRepository(id)` 액션을 제공한다. 모듈 스코프에서 `LazyStore('repositories.json')` 핸들을 캐싱하고, 추가 시 경로 끝의 슬래시만 정규화한 뒤 동일 경로 중복을 조용히 제거(silent dedupe)한다. ID는 `crypto.randomUUID()`, 이름은 경로의 basename을 사용한다.
- `App.tsx` 마운트 시 `useRepositoryStore.getState().hydrate()`를 한 번 호출하여, 앱 시작 직후 영속 데이터를 비차단(fire-and-forget) 방식으로 로드한다.
- 기존 placeholder였던 Repository List 화면을 실제 UI로 교체했다. **Add Repository** 버튼이 활성화되어 네이티브 macOS 폴더 피커를 띄우고, 선택된 폴더가 즉시 목록에 추가된다. 각 행은 `/workspace/:repoId` 로 네비게이션하는 카드 형태(이름 + 회색 경로) 이다. preview workspace 링크는 제거했다.
- Workspace 툴바가 더 이상 raw `repoId`를 표시하지 않는다. 스토어에서 ID로 저장소를 조회하여 `Repository: {name}` 을 보여주고, 라우트 마운트 시 `selectRepository(repoId)`를 호출해 메모리 상 선택 상태를 동기화한다. hydrate 완료 후에도 일치하는 저장소가 없으면 "Repository not found" 화면 + 목록으로 돌아가는 버튼을 노출한다.
- 영속 파일은 macOS에서 `~/Library/Application Support/com.circuit.app/repositories.json` 한 곳에 저장된다 (`tauri.conf.json` `identifier` 기반이라 dev/packaged 모두 동일 경로). 파일 스키마는 `circuit_implementation_plan/SCHEMA.md`의 Repository 객체와 1:1로 일치한다 — `id`, `name`, `path`, `createdAt`, `updatedAt`. 래퍼 객체나 version 필드는 의도적으로 두지 않았다 (마이그레이션이 실제로 필요해질 때 추가).

## Changed Files

- `app/src-tauri/Cargo.toml` — `tauri-plugin-dialog = "2"`, `tauri-plugin-store = "2"` 의존성 추가.
- `app/src-tauri/src/lib.rs` — `tauri_plugin_dialog::init()` 와 `tauri_plugin_store::Builder::default().build()` 두 플러그인을 빌더 체인에 등록.
- `app/src-tauri/capabilities/default.json` — 권한에 `dialog:allow-open`, `store:default` 두 개만 추가 (save/message 등은 의도적으로 부여하지 않음).
- `app/package.json` — `@tauri-apps/plugin-dialog ^2`, `@tauri-apps/plugin-store ^2` 추가.
- `app/src/stores/repositoryStore.ts` — **신규**. Zustand 스토어 + 영속 핸들 + dedupe + UUID + basename 로직. 첫 번째 공유 상태 모듈.
- `app/src/App.tsx` — 마운트 시 `hydrate()` 호출하는 `useEffect` 추가.
- `app/src/routes/RepositoryList.tsx` — placeholder 교체. 폴더 피커 호출 + 저장소 목록 + 비어있을 때 안내 문구. preview workspace 링크 제거.
- `app/src/routes/Workspace.tsx` — `repoId`로 스토어 조회 → 이름 표시, `selectRepository` 동기화, 미등록 ID 처리 분기.
- `app/src/styles/global.css` — `.repository-list__items`, `.repository-list__item`, `.repository-list__item-name`, `.repository-list__item-path` 스타일 추가.

## Verification

자동 정적 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 594ms 빌드 (`dist/assets/index-*.js` 415.94 kB / gzip 133.94 kB) |
| Rust 컴파일 | `cd app/src-tauri && cargo check` | `Finished dev profile in 24.70s` (`tauri-plugin-dialog`, `tauri-plugin-store` 포함) |
| 코드 에디터 의존성 부재 | `cd app && pnpm ls --depth=Infinity \| grep -ciE 'monaco\|codemirror'` | `0` |

수동 검증 (사용자가 `pnpm tauri dev` 로 직접 확인 필요 — 네이티브 윈도우 동작이라 에이전트가 단정 불가):

- [ ] 로컬 폴더 1개 추가 → **Add Repository** 클릭 → macOS 네이티브 폴더 피커 → 폴더 선택 시 목록에 즉시 행이 나타남 (이름은 basename, 경로는 절대 경로).
- [ ] 폴더 3개 연속 추가 → 모두 목록에 표시. 동일 폴더를 다시 추가해도 길이는 그대로 (silent dedupe).
- [ ] 저장소 행 클릭 → URL이 `/workspace/<uuid>` 로 변경 → 툴바에 `Repository: <name>` 표시. `←` 버튼으로 목록으로 복귀해도 모든 행이 유지.
- [ ] 앱을 Cmd+Q 로 종료 후 `pnpm tauri dev` 재실행 → 같은 행들이 그대로 표시. 원본 파일은 `cat ~/Library/Application\ Support/com.circuit.app/repositories.json` 으로 확인 가능 (key `repositories` + SCHEMA.md 형태의 배열).
- [ ] 코드 에디터 기능 부재 — Workspace에 에디터 패널이나 파일 트리가 없으며, `grep -ri "monaco\|codemirror" app/src` 는 0 hit.

영속 상태를 초기화해서 다시 테스트하려면:

```bash
rm ~/Library/Application\ Support/com.circuit.app/repositories.json
```

## Known Limitations

- **스킬 카운트 미표시**: `PRODUCT_SPEC.md` 의 Repository List 요구사항 중 "Detected Claude skills count / Codex skills count" 는 Phase 2 (Skill Discovery) 로 의도적으로 연기. Phase 1 은 디렉터리 등록만 책임짐.
- **선택 상태 비영속**: `selectedId` 는 메모리에만 존재하며 재시작 시 복원되지 않음. Phase 1 검증 체크리스트는 *목록*만 영속을 요구.
- **저장소 이름 편집/삭제 UI 없음**: 등록 후 이름 변경, 행 제거, 재정렬은 의도적으로 제외. 향후 phase 에서 필요 시 추가.
- **하이드레이트 시 디스크 검증 없음**: 영속된 경로의 폴더가 이후 삭제되거나 이동되어도 그대로 목록에 남는다. 폴더 존재 여부는 Phase 2 의 SKILL 스캔 단계에서 자연스럽게 드러나므로 별도 사전 검증을 두지 않음.
- **schema version 필드 미도입**: 영속 JSON 에 version 키가 없다. 첫 마이그레이션이 실제로 필요한 시점에 도입.
- **토스트/알림 시스템 없음**: 중복 폴더 추가 시 기존 행이 이미 화면에 보이는 것 자체가 피드백이며, 토스트는 한 케이스를 위해 도입하기에는 과한 추상화 (YAGNI).
- **커스텀 Rust 명령 없음**: 다이얼로그·스토어 모두 JS 바인딩으로 충분하므로 `#[tauri::command]` 가 추가되지 않았다. IPC 표면이 0이다.
- **폴더 경로 정규화 최소**: 끝 슬래시 1개만 제거. 심볼릭 링크 해석/대소문자 정규화는 하지 않음 (APFS 는 dialog 가 반환한 표기를 보존하므로 문자열 동등 비교로 충분).

## Next Recommendation

다음은 **Phase 2 – Skill Discovery** (`circuit_implementation_plan/phases/02-skill-discovery.md`). 우선 작업 슬라이스 제안:

1. Rust 측에서 저장소 경로를 받아 `<repo>/.claude/skills/*/SKILL.md` 와 `<repo>/.codex/skills/*/SKILL.md` 만 스캔하는 `scan_skills` Tauri 명령 추가 (재귀 스캔 금지). `tauri-plugin-fs` 가 아닌 직접 `std::fs::read_dir` 를 사용해 capabilities 표면을 늘리지 않는다.
2. SKILL.md 의 frontmatter (name, description) 를 파싱하여 `SCHEMA.md` 의 Skill 객체 형태로 반환.
3. `repositoryStore` 와 같은 패턴으로 `skillStore` (또는 `repository -> skills` 맵) 신설. Workspace 진입 시 활성 저장소의 스킬을 한 번 로드.
4. Repository List 의 각 행에 Claude/Codex 스킬 카운트 뱃지 표시 (Phase 1 에서 연기한 항목 회수).
5. Workspace 좌측 Sidebar 에 발견된 스킬 목록 렌더링 (드래그/노드 변환은 Phase 3 의 영역).

이 단계부터 워크플로 그래프 편집기 (Phase 3) 로 넘어갈 데이터 기반이 갖춰진다.
