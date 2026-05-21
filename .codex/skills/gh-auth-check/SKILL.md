---
name: "gh-auth-check"
description: "gh 명령 직전 GitHub CLI 로그인 상태와 active account 를 확인"
---

# gh-auth-check

Use this skill immediately before a workflow runs an actual `gh` command, such as creating, inspecting, or merging PRs with GitHub CLI.

## 목적

GitHub CLI 가 GitHub.com 에 로그인되어 있고 현재 active account 를 읽을 수 있는지 확인한다. 공개 저장소 워크플로에서는 특정 개인 계정을 강제하지 않는다. 프로젝트나 로컬 환경에서 별도의 필수 계정이 필요한 경우, 그 요구사항은 ignored 로컬 설정에 두고 공개 추적 파일에는 기록하지 않는다.

## 절차

1. **인증 상태 확인**: `gh auth status -h github.com` 를 실행한다.
   - Codex 샌드박스에서 keyring 접근 실패로 토큰 invalid 처럼 보일 수 있으므로, 실패 시 로컬 권한으로 한 번 재확인한 뒤 판단한다.
   - 토큰 invalid, 만료, 권한 부족, 로그인 없음이면 `gh auth login -h github.com` 이 필요하다고 안내하고 중단한다.
2. **현재 계정 확인**: `gh api user --jq .login` 으로 active account 를 읽는다.
   - 계정명을 읽을 수 있으면 성공 처리한다.
   - 최종 출력은 성공 문장만 남기고, `필요`, `중단`, `실패`, `오류` 같은 실패 판정용 단어를 쓰지 않는다.
3. **로컬 필수 계정 처리**: ignored 로컬 설정에서 필수 계정이 명시된 경우에만 전환 여부를 사용자와 확인한다.
   - 공개 추적 파일에 특정 개인 계정을 새로 기록하지 않는다.
   - 다른 계정으로 전환하거나 `gh auth logout` 을 실행하지 않는다.

## 출력

- 성공: `GitHub CLI active account: <login>`
- 성공 요약: `GitHub CLI 인증 확인 완료: active account <login>.`
- 실패: 실패한 명령과 필요한 사용자 조치(`gh auth login -h github.com` 등)를 짧게 안내한다.

## Codex Invocation

Use this as a Codex project skill. Invoke `gh-auth-check` immediately before a workflow step that runs an actual `gh` command. Do not invoke it for app startup, repository inspection, local implementation, tests, commit-only work, or plain `git push` steps that do not call `gh`.
