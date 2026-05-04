---
description: 변경사항 커밋 후 리모트 푸시
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
argument-hint: <커밋 메시지 힌트 (선택)>
---

현재 브랜치의 변경사항을 커밋하고 리모트에 푸시하는 커맨드.

`$ARGUMENTS`로 커밋 메시지 힌트를 받을 수 있다. 예: `/cmp 키패드 버그 수정`

## 절차

1. **상태 확인**: `git status`로 변경사항을 확인한다. 변경사항이 없으면 사용자에게 알리고 중단한다.
2. **diff 확인**: `git diff`와 `git diff --staged`로 변경 내용을 파악한다.
3. **커밋 로그 확인**: `git log --oneline -5`로 최근 커밋 스타일을 확인한다.
4. **커밋 메시지 작성**: 변경 내용을 분석하여 한국어 Conventional Commits 스타일로 커밋 메시지를 작성한다. `$ARGUMENTS`가 있으면 힌트로 활용한다.
5. **스테이징**: 변경된 파일을 개별적으로 `git add`한다. `.env`, 자격 증명 파일 등 민감한 파일은 제외한다.
6. **커밋 및 푸시**: 확인 없이 바로 커밋하고 푸시한다. author는 `enebin`으로 설정한다. Co-Authored-By 트레일러는 추가하지 않는다.
7. **푸시**: 리모트 트래킹 브랜치가 있으면 `git push`, 없으면 `git push -u origin <브랜치이름>`으로 푸시한다.

## 주의사항

- `develop`이나 `main` 브랜치에서 직접 커밋하려는 경우 사용자에게 경고하고 확인을 받는다.
- `.env`, `credentials.json` 등 민감한 파일이 변경사항에 포함되어 있으면 스테이징에서 제외하고 사용자에게 알린다.
- `console.log`가 포함된 변경사항이 있으면 사용자에게 알린다.
- 위 경고 상황을 제외하면 확인 없이 바로 진행한다.
- author와 comitted는 반드시 일치시킬 것(enebin)