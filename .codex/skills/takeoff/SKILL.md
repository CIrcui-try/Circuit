---
name: "takeoff"
description: "4단계 — develop 리베이스, push, PR 생성"
---

# takeoff

Use this skill when the user asks to run the `takeoff` workflow.

## Command Template

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

0. `STATE_FILE` 이 없으면 다른 `.codex/state/*.json` 을 후보나 캐시로 사용하지 않는다. 사용자가 입력한 `<ISSUE>` 를 정답으로 보고 `/boarding <ISSUE> [--force]` 를 먼저 실행한 뒤 `STATE_FILE` 을 다시 읽는다. 그래도 없으면 boarding 실패로 보고 중단한다.
1. `boarding.done_at == null` 이거나 `--force` → `/boarding <ISSUE> [--force]`. 채워져 있으면 스킵 메시지 한 줄.
2. `door_closing.done_at == null` 이거나 `--force` → `/door-closing <ISSUE> [--force]`. 채워져 있으면 스킵.
3. `taxiing.done_at == null` 이거나 `--force` → `/taxiing <ISSUE> [--force]`. 채워져 있으면 스킵.
4. 본 단계 진행.

자동 체이닝은 본 단계까지만 — landing 은 자동으로 호출하지 않는다.

## 자기 단계 실행 절차

1. **스킵 판정**: `takeoff.done_at` 이 채워져 있고 `--force` 가 없으면 종료. (다만 takeoff 성공 후 상태 파일은 삭제되므로 보통 이 케이스는 발생하지 않음.)
2. **워크트리 진입**: `worktree_path` 로 cd. 경로가 없으면 사용자에게 안내 후 중단.
3. **상태 점검**: `git status` 가 깨끗한지 확인. 미커밋 변경이 있으면 사용자에게 알리고 중단.
4. **티켓 상태 동기화**: Linear 이슈가 `Done`/`Canceled` 가 아니면 상태를 `In Progress` 로 직접 변경한다.
5. **GitHub 인증 확인**: `gh-auth-check` 스킬로 GitHub CLI active account 가 `kai-leeee` 인지 확인하고, 다르면 전환 후 재확인한다.
6. **develop 리베이스**: `git fetch origin develop && git rebase origin/develop`. 충돌 시 자동 해결 시도하지 말고 사용자에게 위임 후 중단.
7. **푸시**:
   - 첫 push: `git push -u origin <branch>`.
   - 리베이스로 히스토리가 바뀌었고 리모트에 이미 같은 브랜치가 있으면 사용자 승인 후 `git push --force-with-lease origin <branch>`.
   - `develop`/`main` 으로의 직접 푸시는 금지.
8. **PR 생성**: `gh pr create --base develop --head <branch>`.
   - 제목: `<ISSUE> <type>: <English summary>` 예) `CIR-15 fix: prevent white screen when adding waitlist entries`.
   - 제목과 본문은 반드시 영어로 작성한다. 한국어를 쓰지 않는다.
   - 본문: HEREDOC 으로 다음 형식. 모든 placeholder 내용도 영어로 쓴다.

     ```markdown
     ## Summary
     - <goal from plan.md / commit summary in 1-3 lines>

     ## Changes
     - <items based on commit log / changed files from plan.md>

     ## Test plan
     - [ ] <test strategy item from plan.md>

     ## Manual verification
     - <screen, behavior, or state change the user can verify manually>

     Closes <ISSUE>
     ```

9. **직접 확인 포인트 정리**: `plan.md`, Linear 이슈 내용, 커밋 요약을 보고 사용자가 직접 확인할 수 있는 가시적인 피처를 1~5개로 정리한다.
   - 화면, 버튼, 리스트, 상태 표시, 알림, 에러 메시지, 사용자 플로우처럼 눈으로 확인 가능한 단위로 쓴다.
   - 코드 정리, 테스트, 인프라 변경처럼 직접 확인할 UI/동작이 없으면 "직접 확인할 가시 피처 없음" 이라고 명시한다.
   - 애매하면 구현 변경 파일과 이슈 목표를 근거로 추정하되, 추정이라고 표시한다.
10. **PR URL 출력**: 사용자에게 PR URL 과 직접 확인 포인트를 함께 안내한다.
   - CI 통과 후 merge commit 방식으로 자동 머지하고 로컬 정리까지 이어가려면 `/autoland <ISSUE 또는 branch 또는 PR URL>` 를 사용한다.
11. **상태 파일 갱신 후 정리**:
   - 먼저 `takeoff.done_at = <UTC ISO8601>` 로 저장 (혹시 정리 단계에서 실패해도 다음 호출이 takeoff 를 다시 돌리지 않도록).
   - 이어서 임시 파일 삭제: `rm -f $STATE_FILE $ISSUE_FILE $PLAN_FILE`.
   - 삭제 실패는 경고만 출력하고 PR URL 안내는 유지.

## 주의사항

- 이 커맨드 외 단계에서 `git push` / `gh pr create` 가 실행되어선 안 된다.
- 권한/네트워크 차단은 즉시 실패로 확정하지 말고, Codex 승인 요청 또는 샌드박스 escalation 흐름으로 재시도한다. 단, sandbox 전체 비활성화는 금지한다.
- 리베이스 충돌은 사용자에게 위임. 자동 해결 시도 금지.
- force push 는 반드시 사용자 확인 후 `--force-with-lease` 만 사용. `--force` 단독 금지.
- `develop` / `main` 직접 push 금지.
- PR 제목, PR 본문, 커밋 메시지는 반드시 영어로 작성한다. 한국어를 쓰지 않는다.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다. PR 생성 시 `In Review` 같은 중간 상태로 바꾸지 않는다.
- PR 머지 후 워크트리 정리는 `/landing <ISSUE>` 로 별도 진행.

## Codex Invocation

Use this as a Codex project skill. Invoke `takeoff` with the issue id and flags as described above; treat the user text after the skill name as ``.
