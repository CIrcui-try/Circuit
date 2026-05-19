---
description: CI 통과 후 PR 자동 머지·landing 정리
allowed-tools: Bash, Read, AskUserQuestion, mcp__linear-server__get_issue, mcp__linear-server__update_issue
argument-hint: [Linear 이슈 ID | 브랜치명 | PR URL] [--interval <seconds>] [--timeout <minutes>]
---

takeoff 이후 사후 자동화 단계. PR 의 CI checks 를 기다렸다가 모두 통과하면 merge commit 방식으로 머지하고, 이어서 landing 과 동일하게 로컬 워크트리를 제거하고 develop 을 최신화한다.

`$ARGUMENTS` 형식: `[ISSUE-ID | branch | PR URL] [--interval <seconds>] [--timeout <minutes>]`.
타깃을 생략하면 커맨드를 호출한 위치의 현재 브랜치를 대상으로 한다.
예: `/autoland`, `/autoland CIR-15`, `/autoland kai/cir-15-fix-...`, `/autoland https://github.com/OWNER/REPO/pull/123`.

## 인자 파싱

1. 첫 토큰이 플래그가 아니면 `<TARGET>` 으로 둔다. 없으면 메인 레포로 이동하기 전에 `CURRENT_BRANCH = $(git branch --show-current)` 로 호출 위치의 브랜치를 저장해 `<TARGET>` 기본값으로 사용한다. `<TARGET>` 도 `CURRENT_BRANCH` 도 없으면 사용자에게 직접 입력받는다.
2. `--interval <seconds>` 를 파싱한다. 기본값은 `30`, 1 미만이거나 숫자가 아니면 중단.
3. `--timeout <minutes>` 를 파싱한다. 기본값은 `60`, 1 미만이거나 숫자가 아니면 중단.

## 자기 단계 실행 절차

1. **메인 레포로 이동**: 인자 파싱 중 캡처한 `CURRENT_BRANCH` 를 보존한 채 `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)` → `cd $MAIN_REPO_ROOT`.
2. **GitHub 인증 확인**: `gh-auth-check` 스킬로 GitHub CLI active account 가 `kai-leeee` 인지 확인하고, 다르면 전환 후 재확인한다.
3. **대상 결정**:
   - `<TARGET>` 이 `CIR-`/`PROJ-` 같은 이슈 키 패턴이면 Linear MCP `get_issue` 로 `gitBranchName` 을 조회해 branch 로 사용한다.
   - `<TARGET>` 이 `https://github.com/.../pull/...` 형태면 PR URL 로 사용한다.
   - 그 외에는 branch 로 사용한다.
4. **PR 상태 확인**: `gh pr view <PR URL 또는 branch> --json number,url,state,isDraft,baseRefName,headRefName,headRefOid,mergeable` 실행.
   - PR 을 찾지 못하면 중단.
   - `state` 가 `MERGED` 면 머지는 스킵하고 landing 정리만 진행.
   - `state` 가 `OPEN` 이 아니면 중단.
   - `isDraft == true` 면 중단.
   - `baseRefName != "develop"` 이면 중단.
   - 이후 단계에서는 PR URL, PR number, head branch, head SHA 를 고정해 사용한다.
5. **CI checks 초기 확인**: `gh pr checks <PR> --json bucket,state,name,workflow,link` 실행.
   - 반환된 check 가 0개면 자동 머지하지 않고 중단.
   - `bucket` 이 `fail` 또는 `cancel` 인 check 가 있으면 중단.
6. **CI 대기**:
   - `gh pr checks <PR> --watch --fail-fast --interval <interval>` 로 checks 종료를 기다린다.
   - 대기 시간이 `<timeout>` 분을 넘으면 프로세스를 중단하고 자동 머지하지 않는다.
   - watch 가 실패, 취소, timeout 으로 끝나면 원인 check 이름과 링크를 요약하고 중단.
7. **최종 CI 재확인**: `gh pr checks <PR> --json bucket,state,name,workflow,link` 를 다시 실행한다.
   - check 가 0개면 중단.
   - 모든 `bucket` 이 `pass` 가 아니면 중단. `skipping`, `pending`, `fail`, `cancel` 은 자동 머지 대상이 아니다.
8. **머지 직전 PR 재확인**: `gh pr view <PR> --json state,isDraft,baseRefName,headRefOid,mergeable` 실행.
   - PR 이 더 이상 `OPEN` 이 아니거나 draft 가 되었거나 base 가 `develop` 이 아니면 중단.
   - `headRefOid` 가 4단계에서 확인한 SHA 와 다르면 checks 를 다시 기다려야 하므로 중단.
9. **PR 머지**: `gh pr merge <PR> --merge --delete-branch --match-head-commit <head SHA>` 실행.
   - `--admin`, `--auto`, `--squash`, `--rebase` 는 사용하지 않는다.
   - branch protection, required review, merge conflict, 권한 오류는 우회하지 않고 중단.
10. **로컬 정리**: 기존 `/landing <ISSUE 또는 branch>` 절차와 동일하게 진행한다.
    - 이슈 키로 호출된 경우 원래 `<TARGET>` 을 `/landing` 입력으로 사용한다.
    - PR URL 로 호출된 경우 4단계의 `headRefName` 을 branch 입력으로 사용한다.
    - 워크트리가 없으면 landing 처럼 스킵 메시지만 출력하고 계속한다.
11. **티켓 상태 동기화**: PR 머지와 landing 정리가 끝났고 이슈 키를 확인할 수 있으면 Linear 상태를 `Done` 으로 직접 변경한다.
12. **직접 확인 포인트 정리**: PR 본문의 `직접 확인 포인트` 섹션을 우선 사용하고, 없으면 PR diff/커밋/Linear 이슈 내용을 보고 사용자가 직접 확인할 수 있는 가시적인 피처를 1~5개로 정리한다.
    - 화면, 버튼, 리스트, 상태 표시, 알림, 에러 메시지, 사용자 플로우처럼 눈으로 확인 가능한 단위로 쓴다.
    - 코드 정리, 테스트, 인프라 변경처럼 직접 확인할 UI/동작이 없으면 "직접 확인할 가시 피처 없음" 이라고 명시한다.
    - 애매하면 근거를 짧게 붙여 추정이라고 표시한다.
13. **요약 출력**: PR URL, checks 통과 여부, merge commit 방식으로 머지했는지, landing 정리 결과, 직접 확인 포인트를 함께 안내한다.

## 주의사항

- failed, cancelled, timed-out checks 는 자동 머지하지 않는다.
- checks 가 하나도 없으면 자동 머지하지 않는다.
- draft PR, closed PR, base 가 `develop` 이 아닌 PR 은 중단한다.
- branch protection, review requirement, merge conflict 는 우회하지 않는다.
- `--admin`, `--auto`, force push, `develop` 직접 push 는 사용하지 않는다.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다.
- 웹훅 서버 방식은 v1 범위가 아니다. 이 커맨드는 로컬 GitHub CLI 폴링 기반으로 동작한다.
