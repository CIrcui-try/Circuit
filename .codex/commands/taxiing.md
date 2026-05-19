---
description: 3단계 — plan.md 따라 워크트리에서 구현·중간 커밋 (push/PR 없음)
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, AskUserQuestion, TodoWrite, mcp__linear-server__get_issue, mcp__linear-server__update_issue
argument-hint: <Linear 이슈 ID> [--force]
---

구현 3단계. door-closing 에서 작성한 `plan.md` 를 따라 워크트리 안에서 코드를 구현하고 중간 커밋한다. **`git push`, `gh pr create` 같은 원격 부수효과는 절대 수행하지 않는다.**

`$ARGUMENTS` 형식: `<ISSUE-ID> [--force]`. 예: `/taxiing CIR-15`.

## 인자 파싱

1. `--force` 분리. 첫 토큰을 `<ISSUE>` 로.
2. `<ISSUE>` 없으면 사용법 안내 후 중단.

## 상태 파일 경로

- `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)`
- `STATE_FILE = $MAIN_REPO_ROOT/.codex/state/<ISSUE>.json`
- `PLAN_FILE = $MAIN_REPO_ROOT/.codex/state/<ISSUE>.plan.md`

## 자동 체이닝

상태 파일을 읽어 다음 순서로 실행:

1. `boarding.done_at == null` 이거나 `--force` → `/boarding <ISSUE> [--force]` 실행. 채워져 있으면 스킵 메시지 한 줄.
2. `door_closing.done_at == null` 이거나 `--force` → `/door-closing <ISSUE> [--force]` 실행. 채워져 있으면 스킵 메시지 한 줄.
3. 본 단계 진행.

## 자기 단계 실행 절차

1. **스킵 판정**: `taxiing.done_at` 이 채워져 있고 `--force` 가 없으면 스킵 메시지 출력 후 종료.
2. **워크트리 진입**: 상태 파일의 `worktree_path` 를 사용해 워크트리 디렉토리로 cd. 경로가 없으면 `/door-closing <ISSUE> --force` 안내 후 중단.
3. **티켓 상태 동기화**: Linear 이슈가 `Done`/`Canceled` 가 아니면 상태를 `In Progress` 로 직접 변경한다.
4. **plan.md 로딩**: `PLAN_FILE` 을 읽어 구현 단계 / 변경 파일 / 테스트 전략 / 수락 기준을 파악.
5. **구현 진행**:
   - `구현 단계` 항목을 TodoWrite 로 펼쳐 진행 상황 추적.
   - 코드 작성 시 백엔드는 Router → Service → Repository, 프런트엔드는 Data/Domain/Presentation 레이어 컨벤션을 따른다.
   - 의미 있는 단위마다 한국어 Conventional Commits 스타일로 커밋. 형식: `<type>: <설명> (<ISSUE>)` 예 `feat: 숫자 키패드 컴포넌트 추가 (CIR-21)`.
6. **테스트 작성·실행**:
   - 백엔드 변경: `pytest` 통과 확인.
   - 프런트엔드 변경: Vitest(단위) 또는 Playwright(E2E), 그리고 `npm run build` 통과 확인.
   - 실패하면 다음 단계로 넘어가지 않고 해결한다.
7. **`console.log` 검사**: 변경된 프런트엔드 파일에 `console.log` 가 남아있으면 사용자에게 알린다.
8. **남은 변경 커밋**: `git status` 가 깨끗해질 때까지 커밋. 커밋되지 않은 변경이 남으면 종료하지 않는다.
9. **상태 파일 갱신**: `taxiing.done_at = <UTC ISO8601>` 저장.
10. **요약 출력**: 추가된 커밋 수와 통과된 테스트 종류를 한두 문장으로 안내.

## 주의사항

- **`git push`, `gh pr create`, `gh pr edit`, `git push --force*` 절대 금지.** 그건 takeoff 책임.
- `develop` / `main` 에 직접 커밋 금지.
- `.env`, `credentials.json` 등 민감한 파일은 스테이징에서 제외.
- 구현 중 불명확한 점은 임의 판단하지 말고 사용자에게 질문.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다.
- `--force` 사용 시 — taxiing 만 다시 돌리는 의미는 거의 없으므로(이미 커밋된 코드를 되돌릴 수 없음) 사용자에게 “기존 커밋을 그대로 두고 plan 잔여분만 이어서 진행할까, 아니면 사용자가 직접 reset 후 재호출할까” 한 번 확인 받는다.
