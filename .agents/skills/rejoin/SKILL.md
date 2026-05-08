---
name: "rejoin"
description: "중단 정리 — 워크트리 제거 후 브랜치를 메인 레포 로컬 브랜치로 보존"
---

# rejoin

Use this skill when the user asks to run the `rejoin` workflow.

## Command Template

PR 머지 여부와 무관하게, 워크트리에서 빠져나와 진행 중인 브랜치를 **메인 레포에 develop 위로 리베이스된 로컬 브랜치로 보존**한다. 워크트리는 별도 디렉토리라 의존성 설치·빌드 캐시·IDE 인덱싱을 다시 해야 하므로, 메인 레포(이미 갖춰진 환경)로 항로를 다시 잡고 그쪽에서 작업을 이어가거나 다른 브랜치로 컨텍스트 스위칭하기 위함이다.

`$ARGUMENTS` 형식: `<ISSUE-ID 또는 branch>`. 예: `/rejoin CIR-15`, `/rejoin kai/cir-15-fix-...`.

## 자기 단계 실행 절차

1. **인자 확인**: `$ARGUMENTS` 비어있으면 사용법 안내 후 중단.
2. **메인 레포로 이동**: `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)` → `cd $MAIN_REPO_ROOT`.
3. **브랜치명 결정**:
   - 인자가 `CIR-`/`PROJ-` 같은 이슈 키 패턴이면 Linear MCP `get_issue` 로 `gitBranchName` 을 조회.
   - 인자에 `/` 가 포함되어 있으면 그대로 브랜치명으로 사용.
   - 둘 다 실패하면 사용자에게 직접 입력받는다.
4. **방어**: `<branch>` 가 `develop` / `main` 이면 거부하고 중단.
5. **워크트리 탐색**: `git worktree list --porcelain` 으로 `<branch>` 가 체크아웃된 워크트리 경로 확인.
   - 워크트리가 없고 로컬 브랜치만 존재 → 사용자에게 "워크트리가 없는데 develop 위로 리베이스만 진행할까요?" 확인 후 진행.
   - 워크트리도 로컬 브랜치도 없으면 중단.
6. **워크트리 미커밋 변경 체크**: 해당 워크트리 안에서 `git status --porcelain` 결과가 비어있지 않으면 "미커밋 변경이 있습니다 — 커밋/스태시 후 다시 실행해주세요" 안내 후 중단. 자동 stash 금지.
7. **develop 최신화 (메인 레포)**: `git fetch origin develop` → `git checkout develop` → `git pull --ff-only origin develop`.
   - fast-forward 실패 시 사용자 위임 후 중단.
8. **워크트리 제거**: `git worktree remove .codex/worktrees/<branch>`.
   - 잠김/실패 시 사용자 확인 후 `--force`.
9. **브랜치 리베이스 (메인 레포)**:
   - `git checkout <branch>`.
   - `git rebase origin/develop`.
   - 충돌 발생 시: 자동 해결 시도하지 말고 "리베이스 충돌 상태 — 해결 후 `git rebase --continue` 또는 `git rebase --abort`" 안내 후 중단. 메인 레포의 HEAD 는 리베이스 진행 중 상태로 둔다.
10. **상태 파일 정리(있으면)**: 인자가 이슈 키였고 `.codex/state/<ISSUE>.*` 잔재가 있으면 함께 삭제. (보통 takeoff 후 호출되므로 잔재 없음.)
11. **요약 출력**: `<branch>` 가 develop 보다 N 커밋 앞섬 (`git rev-list --count origin/develop..<branch>`), HEAD 해시, 삭제된 워크트리 경로, "원격에는 영향 없음 (push 미수행)" 한두 문장으로 안내.

## 주의사항

- 원격 push / force-push / `gh pr` 호출 금지. 본 커맨드는 로컬 전용.
- 자동 stash 금지. 미커밋 변경은 사용자에게 처리 위임.
- 리베이스 충돌은 사용자 위임. 자동 해결 시도 금지.
- `develop` / `main` 을 대상 브랜치로 받지 않는다.
- Linear 이슈 상태 변경 금지 — 자동화에 위임.
- PR 머지 후 사후 정리는 `/rejoin` 이 아닌 `/landing` 으로 진행.

## Codex Invocation

Use this as a Codex project skill. Invoke `rejoin` with the issue id and flags as described above; treat the user text after the skill name as ``.
