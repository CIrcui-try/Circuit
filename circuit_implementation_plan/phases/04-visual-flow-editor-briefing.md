# Phase 4 Briefing

## Implemented

- **workflowStore (zustand)** 신설 — `app/src/stores/workflowStore.ts`. React Flow 컨트롤드 모드의 단일 진실 소스로, `nodes` / `edges` / `selectedNodeId` / `selectedEdgeId` 와 React Flow 핸들러 (`onNodesChange` / `onEdgesChange` / `onConnect`) + 앱 레벨 커맨드 (`addSkillNode`, `selectNode`, `selectEdge`, `deleteSelected`, `resetWorkflow`) 를 노출한다. AGENTS.md §1 "Editor / Schema / Runner 분리" 에 맞춰 schema 변환은 일절 수행하지 않는다 — 이 store 는 캔버스 상태만 들고 있고 Phase 5 의 schema 직렬화는 별도 레이어에서 담당한다.
- **SkillNode 커스텀 노드** — `app/src/components/canvas/SkillNode.tsx`. Sidebar 의 시각 언어 (이름 + provider chip) 를 그대로 재사용해 캔버스가 사이드바의 공간적 짝처럼 보이게 만들었다. `data-testid="workflow-node"`, `data-node-id`, `data-skill-provider` 부여. `nodeTypes = { skill: SkillNode }` 도 같은 모듈에서 export.
- **Canvas 가 store 와 결합** — `app/src/components/layout/Canvas.tsx` 가 더 이상 `<ReactFlow nodes={[]} edges={[]} />` 가 아니다. `<ReactFlowProvider>` 로 감싼 `<CanvasInner>` 가 `useShallow` 로 store 에서 nodes / edges / handlers 를 구독하고, `onDrop` / `onDragOver` 에서 `application/x-circuit-skill` payload (sidebar drag 가 보내는 JSON) 를 받아 `screenToFlowPosition()` 으로 캔버스 좌표를 계산해 `addSkillNode()` 를 호출한다. `deleteKeyCode={["Backspace", "Delete"]}` 로 키보드 삭제 활성. 외부 `<section>` 의 `data-testid="workflow-canvas"` 는 그대로 유지.
- **Sidebar 가 drag source + click-to-add** 둘 다 — `app/src/components/layout/Sidebar.tsx`. 각 `<li>` 에 `data-testid="skill-list__item"`, `draggable`, `onDragStart` 가 붙고, 우측에 `+` 버튼 (`data-testid="skill-list__add"`, `aria-label="Add {name} to canvas"`) 이 추가됐다. 드래그는 자연스러운 UX 용, 버튼은 E2E 테스트가 React Flow 의 좌표 계산에 의존하지 않도록 하기 위함이다 (CI 머신마다 fragile 한 핸들 드래그 회피). 두 경로 모두 store 의 `addSkillNode` 한 함수만 호출한다.
- **PropertiesPanel 활성화** — `app/src/components/layout/PropertiesPanel.tsx`. `useWorkflowStore` 에서 selected node 를 구독하고, 선택이 있으면 `<dl class="properties">` 로 Label / Provider / Skill File 을 노출. 빈 상태 메시지는 그대로 유지. 컨테이너에 `data-testid="node-properties-panel"` 부여 (TESTING_STRATEGY.md §Test ID Policy 매칭). Edge 편집은 Phase 4 스펙 범위 밖이라 일부러 빼고 skipped.
- **Workspace 가 repo 전환 시 캔버스 클리어** — `app/src/routes/Workspace.tsx`. `useEffect` 추가로 `repoId` 가 바뀔 때마다 `useWorkflowStore.getState().resetWorkflow()` 호출. Phase 5 의 disk-load 가 들어오면 이 자리에 load-from-disk 가 들어올 자리. 현재로선 다른 repo 의 노드가 새 repo 캔버스로 새는 것을 막는 회귀 가드 역할.
- **window.\_\_WORKFLOW\_STORE\_\_ 노출** — Playwright 가 React Flow handle-to-handle pointer drag 의 timing 의존성 없이 `onConnect` 를 직접 호출하기 위함. 이 store 가 단일 진실 소스라 store 를 통한 호출이 곧 production path. 디버깅 용도로도 유용. 운영 코드도 같은 함수를 거치므로 mocking 이 아니라 단지 입력 경로를 안정적으로 만든 것뿐.
- **CSS** — `app/src/styles/global.css`. `.skill-list__add` (사이드바 + 버튼), `.skill-node` / `.skill-node--claude/--codex` / `.skill-node.is-selected` (캔버스 노드 카드 — 선택 시 #6aa9ff outline), `.properties` (PropertiesPanel 의 grid `dt`/`dd` 레이아웃) 추가.

## Changed Files

신규:

- `app/src/stores/workflowStore.ts` — Phase 4 의 핵심 상태.
- `app/src/stores/workflowStore.test.ts` — store 단위 테스트 10 개 (WS1–WS10).
- `app/src/components/canvas/SkillNode.tsx` — 커스텀 React Flow 노드 + `nodeTypes` export.
- `app/src/components/layout/PropertiesPanel.test.tsx` — 패널 RTL 테스트 3 개 (PP1–PP3).
- `app/e2e/flow-editor.spec.ts` — Phase 4 E2E 4 개 (F1–F4).
- `circuit_implementation_plan/phases/04-visual-flow-editor-briefing.md` — 본 브리핑.

수정:

- `app/src/components/layout/Canvas.tsx` — 컨트롤드 ReactFlow + ReactFlowProvider + onDrop / onDragOver. `SKILL_DRAG_MIME` 상수 export.
- `app/src/components/layout/Sidebar.tsx` — drag source / `+` 버튼 / `skill-list__item` testid.
- `app/src/components/layout/PropertiesPanel.tsx` — 빈 상태 → store 구독 기반 동적 렌더.
- `app/src/routes/Workspace.tsx` — `resetWorkflow` effect 추가.
- `app/src/styles/global.css` — `.skill-node*`, `.properties`, `.skill-list__add` 스타일.
- `app/src/components/layout/Sidebar.test.tsx` — `+` 버튼 테스트 (SB6) 추가, `skill-list__item` testid 단언.
- `app/src/components/layout/layout.test.tsx` — host bridge mock 추가 (Sidebar 가 이제 workflow store 를 import 하므로 안전망), `nodeTypes.skill` 등록 단언 추가.
- `app/src/routes/Workspace.test.tsx` — Workspace 마운트 시 워크플로우가 비워지는지 확인하는 W7 추가.

## Verification

자동 검증 (전부 green):

| 검사 | 명령 | 결과 |
|---|---|---|
| Vitest (UI + 단위) | `cd app && pnpm test:run` | 10 files / **70 tests passed** (≈ 1.4 s) |
| Playwright (E2E) | `cd app && pnpm test:e2e` | **9 tests passed** (smoke 5 + flow-editor 4, 9 workers, ≈ 2.6 s) |
| 통합 진입점 | `cd app && pnpm test:all` | Vitest 직후 Playwright, 양쪽 모두 통과 |
| Rust 단위 테스트 (회귀 가드) | `~/.cargo/bin/cargo test --lib skill_scan` (cwd: `app/src-tauri`) | **2 tests passed** |
| TypeScript + Vite 프로덕션 빌드 | `cd app && pnpm build` | tsc 통과, Vite 596 ms 빌드 (`dist/assets/index-*.js` 425.17 kB / gzip 136.85 kB) |

스펙 체크리스트 매핑 (`circuit_implementation_plan/phases/04-visual-flow-editor.md` §Verification Checklist):

- [x] A discovered skill can be added to the canvas — sidebar `+` 버튼 (E2E F1), HTML5 drag (manual). 두 경로 모두 store 의 `addSkillNode` 한 함수를 거친다.
- [x] The node references the original `SKILL.md` — `data.skillRef = { provider, skillFile }` 가 SCHEMA.md §Skill Node 와 동일한 형태 (E2E F2 가 `.claude/skills/implement-feature/SKILL.md` 노출 검증).
- [x] A node can be moved — React Flow 기본 `onNodesChange` 가 position change 를 store 에 반영. WS2 단위 테스트가 회귀 가드.
- [x] A node can be selected — React Flow 의 select change 가 `onNodesChange` 를 통해 `selectedNodeId` 로 미러링. WS10 단위 테스트.
- [x] The right panel shows provider and skill path — PP2 RTL 테스트 + F2 E2E.
- [x] Two nodes can be connected — `onConnect` 가 self-loop / duplicate 를 거른 뒤 `addEdge`. WS3 / WS4 / WS5 + F3 E2E.
- [x] Nodes and edges can be deleted — `deleteKeyCode` 키 + `deleteSelected` 커맨드. 노드 삭제 시 incident edge 도 함께 정리. WS6 / WS7 + F4 E2E.
- [x] E2E tests cover the main graph editing flow — flow-editor.spec.ts 가 F1–F4 (add / select / connect / delete) 를 커버.

## Tests

추가 / 변경:

- **Vitest — workflowStore (10개, 모두 신규)** : WS1 addSkillNode 가 SkillRef 보존 / WS2 position change 적용 / WS3 distinct connect / WS4 self-loop 거부 / WS5 duplicate edge 거부 / WS6 노드 삭제 시 incident edge 함께 제거 / WS7 edge 단독 삭제 / WS8 resetWorkflow / WS9 selectNode 가 노드별 selected flag 미러링 / WS10 onNodesChange select 이벤트가 selectedNodeId 로 미러링.
- **Vitest — PropertiesPanel (3개, 신규 파일)** : PP1 empty state / PP2 선택된 노드의 label / provider / skillFile 노출 / PP3 deselect 후 empty 복귀.
- **Vitest — Sidebar (1개 추가)** : SB6 `+` 버튼 클릭 시 store 에 노드 추가.
- **Vitest — Workspace (1개 추가)** : W7 마운트 시 기존 workflow 노드가 모두 클리어되는지 확인.
- **Vitest — layout (1개 추가)** : `nodeTypes.skill` 이 등록되어 있는지 라이트 스모크.
- **Playwright (4개, 신규 파일 `flow-editor.spec.ts`)** : F1 `+` 버튼 클릭 → `workflow-node` 한 개 등장 / F2 노드 클릭 → `node-properties-panel` 이 provider + skillFile 노출 / F3 두 노드 연결 → `.react-flow__edge` 1 개 / F4 노드 선택 후 Backspace → 노드 + incident edge 삭제, 패널 빈 상태 복귀.

실행 명령 / 결과:

```
cd app && pnpm test:all                                    # vitest 70/70 + playwright 9/9
~/.cargo/bin/cargo test --lib skill_scan (cwd: src-tauri)  # 2/2 (Phase 03 회귀 가드)
cd app && pnpm build                                       # tsc + vite 596 ms
```

## Known Limitations

- Edge 의 PropertiesPanel 단일 노출은 의도적으로 빠졌다. Phase 4 스펙은 "selected node properties" 만 요구하고 (CLAUDE.md §1 YAGNI), Phase 06 의 실행 상태 (running/success/failed) 가 들어오면 그때 edge inspection 도 의미가 생기므로 그쪽에서 같이 다루는 게 자연스럽다.
- Playwright F3 가 React Flow 핸들 드래그 대신 `window.__WORKFLOW_STORE__` 를 통해 `onConnect` 를 직접 호출한다. 운영 코드와 같은 함수를 거치지만, "사용자가 핸들을 드래그해 연결한다" 라는 인터랙션 자체의 회귀는 단위 테스트 + 매뉴얼 QA 에 의존한다. 헤드리스 Chromium 에서 핸들 좌표가 fragile 해 (timing) 의도적 트레이드오프.
- Workflow / Save / Start Circuit 툴바 버튼은 여전히 disabled. 캔버스에 노드를 올려도 어디에도 저장되지 않으므로 새로고침 / repo 전환 시 캔버스가 비워진다 — Phase 5 가 처리할 영역이며 의도된 동작.
- Node id 는 모듈 스코프 카운터 (`node_${n}`) 라 모듈 핫리로드 시 카운터가 계속 증가한다. 단일 세션 내 ID 충돌은 없지만 Phase 5 에서 schema 영속화가 들어오면 결정론적 ID (UUID 또는 `${skillId}#${ordinal}`) 로 갈아끼우는 게 안전하다.
- 노드 카드의 위치 cascading (`x: 80 + 32n`) 은 단순 누적치라 N 이 커지면 화면 밖으로 흐른다. Phase 4 MVP 범위에선 의도적 단순화.
- 한 번 추가한 skill 을 두 번 추가하면 동일 `skillRef` 를 가진 노드가 두 개 생긴다. 이게 의도인지 아닌지는 Phase 5 의 schema 정의 시점에 결정 (현재는 SCHEMA.md §Skill Node 가 unique 제약을 두지 않으므로 허용).

## Next Recommendation

다음은 **Phase 5 — Workflow Schema** (`circuit_implementation_plan/phases/05-workflow-schema.md`). 이번 phase 에서 캔버스 상태가 `nodes`/`edges` 인-메모리 트리로 잡혀 있으므로:

1. `workflowStore` ↔ `Workflow` schema 양방향 변환 모듈 (`app/src/workflow/serialize.ts`) 신설. SCHEMA.md §Workflow / §Skill Node / §Edge 와 1:1 매핑. **schema 는 store 와 다른 모듈에 두고**, store 가 schema 타입에 직접 의존하지 않게 한다 (AGENTS.md §1).
2. Workflow JSON 을 디스크에 영속화. 위치 후보: 활성 repo 의 `.circuit/workflows/{slug}.workflow.json` (스펙이 명시하지 않으면 이걸 기본으로 제안). Tauri command 경유 — 새 host bridge 메서드 `saveWorkflow` / `loadWorkflow` 를 추가하고, 기존 mock bridge 도 in-memory 로 같은 시그니처를 구현.
3. Workspace toolbar 의 Save 버튼 활성화. 저장 직후 toast 또는 toolbar 상태 텍스트로 피드백.
4. Workflow 진입 시 자동 load — `Workspace` 가 `repoId` 변경 시 `resetWorkflow()` 대신 `loadWorkflow()` 를 호출하도록 교체.
5. 결정론적 node ID (UUID v4 또는 schema-stable hash) 로 마이그레이션. 저장→로드 round-trip 테스트가 ID 충돌을 잡도록.
6. 새로 늘릴 testid: `save-workflow-button`, `workflow-name-input`. E2E F5 (저장 후 새로고침 → 노드/엣지/위치 모두 복원) + Vitest serialize round-trip.
7. condition / loop / approval 같은 노드 타입은 schema 가 정의된 후 Phase 5 후반 또는 별도 phase 로 미루는 것을 권장 (CLAUDE.md §1, scope creep 방지).
