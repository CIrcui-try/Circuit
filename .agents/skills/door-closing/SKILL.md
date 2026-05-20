---
name: "door-closing"
description: 항공기 이륙 2단계 — develop fetch + 워크트리 생성 + 구현 계획(plan.md) 작성
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, AskUserQuestion, TodoWrite, mcp__linear-server__get_issue, mcp__linear-server__update_issue
argument-hint: <Linear 이슈 ID> [--force]
---

이륙 시퀀스의 **2단계 (Door-closing)**. develop을 fetch하고 워크트리를 만든 뒤 구현 계획(`plan.md`)을 디스크에 작성한다. **코드 변경·푸시는 하지 않는다.**

`$ARGUMENTS` 형식: `<ISSUE-ID> [--force]`. 예: `/door-closing CIR-15`.

## 인자 파싱

1. `$ARGUMENTS` 에서 `--force` 분리. 첫 번째 토큰을 `<ISSUE>` 로 사용.
2. `<ISSUE>` 가 없으면 사용법 안내 후 중단.

## 상태 파일 경로

- `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)`
- `STATE_FILE = $MAIN_REPO_ROOT/.Codex/state/<ISSUE>.json`
- `PLAN_FILE = $MAIN_REPO_ROOT/.Codex/state/<ISSUE>.plan.md`

## 자동 체이닝

호출 시 `<ISSUE>` 의 상태 파일을 읽어 다음 순서로 실행:

1. `stages.boarding.done_at` 이 `null` 이거나 `--force` 가 주어졌으면 `/boarding <ISSUE> [--force]` 를 먼저 실행. 채워져 있으면 `boarding skipped (done at <시각>)` 한 줄만 출력.
2. 그 다음 본 단계 진행.

## 자기 단계 실행 절차

1. **스킵 판정**: `stages.door_closing.done_at` 이 채워져 있고 `--force` 가 없으면 한 줄 요약 출력 후 종료.
2. **메인 레포로 이동**: 워크트리 안이라면 `cd $MAIN_REPO_ROOT`.
3. **현재 작업 상태 확인**: `git status` 로 미커밋 변경사항이 있으면 사용자에게 알리고 계속할지 확인.
4. **develop 최신화**: `git checkout develop && git pull origin develop`. 충돌 시 사용자 위임 후 중단.
5. **브랜치명 결정**: 상태 파일의 `branch` 필드(boarding 단계가 채움) 사용. 비어있으면 Linear MCP `get_issue` 의 `gitBranchName` 으로 다시 채움.
6. **티켓 상태 동기화**: Linear 이슈가 `Done`/`Canceled` 가 아니면 상태를 `In Progress` 로 직접 변경한다.
7. **워크트리 생성**:
   - 워크트리 경로: `.Codex/worktrees/<branch>` (메인 레포 기준 상대경로).
   - `git worktree add .Codex/worktrees/<branch> -b <branch> develop`.
   - 동일 브랜치/경로가 이미 있으면:
     - `--force` 면 사용자에게 “기존 워크트리 삭제 후 재생성?” 확인 받고 `git worktree remove --force .Codex/worktrees/<branch>` 후 재생성.
     - `--force` 가 없으면 기존 워크트리 재사용 (`git worktree add .Codex/worktrees/<branch> <branch>`).
8. **구현 계획 작성**: 워크트리 안에서 코드 탐색 후 `PLAN_FILE` 작성:

   ```markdown
   # <ISSUE> 구현 계획

   ## 목표
   - <한 줄 요약>

   ## 변경 파일
   - `<path>` — <변경 사유 한 줄>
   - ...

   ## 구현 단계
   1. ...
   2. ...

   ## 테스트 전략
   - <pytest / Vitest / Playwright / npm run build 항목별로>

   ## 수락 기준 매핑
   - <issue.md 의 수락 기준 → 어떤 변경/테스트로 충족하는지>

   ## 리스크 / 미해결 질문
   - ...
   ```

   탐색 폭이 넓으면 Explore 서브에이전트 1개에 위임.
9. **상태 파일 갱신**: `worktree_path`, `plan_path` 채우고 `stages.door_closing.done_at = <UTC ISO8601>`.
10. **요약 출력**: 워크트리 경로, 변경 파일 수, 구현 단계 수를 한두 문장으로 안내.

## 주의사항

- 워크트리 안에서 `git push`, `gh pr create` 등 원격 부수효과 금지.
- 코드 변경·커밋도 금지. 다음 단계 `/taxiing` 에서만 수행.
- `develop` / `main` 브랜치에 직접 커밋·푸시 금지.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다.
- `--force` 시 `PLAN_FILE` 을 덮어쓴다.
