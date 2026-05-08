---
description: 4단계 — develop 리베이스 → push → PR 생성 (원격 영향)
allowed-tools: Bash, Read, AskUserQuestion, TodoWrite, mcp__linear-server__get_issue
argument-hint: <Linear 이슈 ID> [--force]
---

PR 생성 4단계. develop 위에 리베이스하고 리모트에 push 한 뒤 PR 을 생성한다. **이 단계만 원격에 영향을 준다.** 성공하면 임시 상태 파일(`.codex/state/<ISSUE>.*`) 을 모두 삭제한다.

`$ARGUMENTS` 형식: `<ISSUE-ID> [--force]`. 예: `/takeoff CIR-15`.

## 인자 파싱

1. `--force` 분리. 첫 토큰을 `<ISSUE>` 로.
2. `<ISSUE>` 없으면 사용법 안내 후 중단.

## 상태 파일 경로

- `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)`
- `STATE_FILE = $MAIN_REPO_ROOT/.codex/state/<ISSUE>.json`
- `ISSUE_FILE = $MAIN_REPO_ROOT/.codex/state/<ISSUE>.issue.md`
- `PLAN_FILE  = $MAIN_REPO_ROOT/.codex/state/<ISSUE>.plan.md`

## 자동 체이닝

상태 파일을 읽어 다음 순서로 실행:

1. `boarding.done_at == null` 이거나 `--force` → `/boarding <ISSUE> [--force]`. 채워져 있으면 스킵 메시지 한 줄.
2. `door_closing.done_at == null` 이거나 `--force` → `/door-closing <ISSUE> [--force]`. 채워져 있으면 스킵.
3. `taxiing.done_at == null` 이거나 `--force` → `/taxiing <ISSUE> [--force]`. 채워져 있으면 스킵.
4. 본 단계 진행.

자동 체이닝은 본 단계까지만 — landing 은 자동으로 호출하지 않는다.

## 자기 단계 실행 절차

1. **스킵 판정**: `takeoff.done_at` 이 채워져 있고 `--force` 가 없으면 종료. (다만 takeoff 성공 후 상태 파일은 삭제되므로 보통 이 케이스는 발생하지 않음.)
2. **워크트리 진입**: `worktree_path` 로 cd. 경로가 없으면 사용자에게 안내 후 중단.
3. **상태 점검**: `git status` 가 깨끗한지 확인. 미커밋 변경이 있으면 사용자에게 알리고 중단.
4. **develop 리베이스**: `git fetch origin develop && git rebase origin/develop`. 충돌 시 자동 해결 시도하지 말고 사용자에게 위임 후 중단.
5. **푸시**:
   - 첫 push: `git push -u origin <branch>`.
   - 리베이스로 히스토리가 바뀌었고 리모트에 이미 같은 브랜치가 있으면 사용자 승인 후 `git push --force-with-lease origin <branch>`.
   - `develop`/`main` 으로의 직접 푸시는 금지.
6. **PR 생성**: `gh pr create --base develop --head <branch>`.
   - 제목: `<ISSUE> <type>: <요약>` 예) `CIR-15 fix: 대기자 추가 시 화이트아웃 수정`.
   - 본문: HEREDOC 으로 다음 형식.

     ```markdown
     ## Summary
     - <plan.md 의 목표 / 커밋 요약 1~3줄>

     ## Changes
     - <커밋 로그 / plan.md 의 변경 파일 기반 항목>

     ## Test plan
     - [ ] <plan.md 테스트 전략 항목>

     Closes <ISSUE>
     ```

7. **PR URL 출력**: 사용자에게 한 줄로 PR URL 안내.
8. **상태 파일 갱신 후 정리**:
   - 먼저 `takeoff.done_at = <UTC ISO8601>` 로 저장 (혹시 정리 단계에서 실패해도 다음 호출이 takeoff 를 다시 돌리지 않도록).
   - 이어서 임시 파일 삭제: `rm -f $STATE_FILE $ISSUE_FILE $PLAN_FILE`.
   - 삭제 실패는 경고만 출력하고 PR URL 안내는 유지.

## 주의사항

- 이 커맨드 외 단계에서 `git push` / `gh pr create` 가 실행되어선 안 된다.
- 리베이스 충돌은 사용자에게 위임. 자동 해결 시도 금지.
- force push 는 반드시 사용자 확인 후 `--force-with-lease` 만 사용. `--force` 단독 금지.
- `develop` / `main` 직접 push 금지.
- Linear 이슈 상태(In Progress, In Review 등)는 자동화에 위임 — 직접 변경하지 않는다.
- PR 머지 후 워크트리 정리는 `/landing <ISSUE>` 로 별도 진행.
