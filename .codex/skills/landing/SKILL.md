---
name: "landing"
description: "사후 정리 — PR 머지 확인 후 워크트리 제거와 develop 동기화"
---

# landing

Use this skill when the user asks to run the `landing` workflow.

## Command Template

사후 정리 단계. PR 이 머지된 뒤 워크트리를 제거하고 로컬 develop 을 최신화한다. takeoff 의 자동 체이닝 대상이 아니며 항상 수동 호출한다 (PR 머지 시점은 사용자만 알기 때문).

`$ARGUMENTS` 형식: `[ISSUE-ID 또는 branch]`. 생략하면 커맨드를 호출한 위치의 현재 브랜치를 대상으로 한다. 예: `/landing`, `/landing CIR-15`, `/landing kai/cir-15-fix-...`.

## 자기 단계 실행 절차

1. **현재 브랜치 캡처**: 메인 레포로 이동하기 전에 `CURRENT_BRANCH = $(git branch --show-current)` 로 호출 위치의 브랜치를 저장한다. `$ARGUMENTS` 가 비어있고 `CURRENT_BRANCH` 도 비어있으면 사용자에게 직접 입력받는다.
2. **메인 레포로 이동**: `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)` → `cd $MAIN_REPO_ROOT`.
3. **브랜치명 결정**:
   - `$ARGUMENTS` 가 비어있으면 `CURRENT_BRANCH` 를 브랜치명으로 사용한다.
   - 인자가 `CIR-`/`PROJ-` 같은 이슈 키 패턴이면 Linear MCP `get_issue` 로 `gitBranchName` 을 조회.
   - 인자에 `/` 가 포함되어 있으면 그대로 브랜치명으로 사용.
   - 둘 다 실패하면 사용자에게 직접 입력받는다.
4. **PR 머지 확인**: `gh pr view <branch> --json state,number,url` 실행.
   - `state` 가 `MERGED` 가 아니면 사용자에게 “PR 미머지 상태입니다 (state=<state>). 그래도 워크트리를 제거할까요?” 확인 후 진행 여부 결정.
   - PR 자체가 없으면 (`gh` 가 not found 반환) 사용자에게 알리고 워크트리만 정리할지 확인.
5. **워크트리 제거**:
   - `git worktree list` 로 `<branch>` 의 워크트리 경로 찾기.
   - 워크트리가 이미 없는 경우 (직전에 `/rejoin` 으로 정리된 케이스) → `worktree not present, skipping` 한 줄만 출력하고 다음 단계로.
   - 워크트리 안에 미커밋 변경이 남아있으면 사용자에게 알리고 중단.
   - 현재 위치가 그 워크트리면 메인 레포로 cd 한 뒤 제거.
   - `git worktree remove .codex/worktrees/<branch>`. 파일 잠김 등으로 실패하면 사용자 확인 후 `--force`.
6. **로컬 develop 동기화**: 메인 레포에서 `git checkout develop && git pull origin develop`.
7. **로컬 브랜치 정리**: `git branch -d <branch>` 시도. 실패하면(아직 머지 인식 못 함) 사용자 확인 후 `git branch -D <branch>`.
8. **상태 파일 정리(잔재 시)**: takeoff 가 정상 종료했으면 `.codex/state/<ISSUE>.*` 는 이미 사라져 있다. 잔재가 있다면 함께 삭제. (이슈 키를 인자로 받지 않은 경우는 이 단계 생략.)
9. **티켓 상태 동기화**: PR 이 `MERGED` 이고 이슈 키를 확인할 수 있으면 Linear 상태를 `Done` 으로 직접 변경한다. PR 미머지 상태에서 사용자가 워크트리 제거를 승인한 경우에는 `Done` 으로 바꾸지 않는다.
10. **요약 출력**: 머지된 PR URL(있으면)·삭제된 워크트리 경로·develop 의 최신 커밋 해시를 한두 문장으로 안내.

## 주의사항

- PR 미머지 상태에서의 워크트리 제거는 사용자 명시 승인 후에만 진행.
- 로컬 브랜치 강제 삭제(`-D`)는 사용자 명시 승인 후에만.
- `develop` / `main` 에 직접 커밋·푸시하지 않는다.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다.
- 상태 파일이 없는 케이스(takeoff 후 정상 정리)도 정상 동작이다 — 이슈 키 → 브랜치명 변환만 가능하면 된다.
- PR 미머지 상태에서 워크트리만 정리하고 브랜치를 보존하려면 `/landing` 대신 `/rejoin` 을 사용한다. `/rejoin` 후 PR 이 머지되면 그대로 `/landing` 을 호출하면 된다 (워크트리 부재 케이스는 5단계에서 스킵 처리).

## Codex Invocation

Use this as a Codex project skill. Invoke `landing` with the optional issue id or branch as described above; when no target is provided, use the current branch captured before moving to the main repo.
