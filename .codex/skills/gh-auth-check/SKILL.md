---
name: "gh-auth-check"
description: "GitHub CLI 인증 계정을 kai-leeee로 확인하고, 다르면 전환 후 재확인"
---

# gh-auth-check

Use this skill when a workflow needs to run `gh`, push to GitHub, create or inspect PRs, or verify that GitHub CLI is authenticated as the required account.

## 목적

GitHub CLI 의 active account 가 프로젝트 필수 계정인 `kai-leeee` 인지 확인한다. 다르면 `gh auth switch -h github.com -u kai-leeee` 로 전환을 먼저 시도하고, 전환 후에도 맞지 않으면 중단한다.

## 절차

1. **인증 상태 확인**: `gh auth status -h github.com` 를 실행한다.
   - Codex 샌드박스에서 keyring 접근 실패로 토큰 invalid 처럼 보일 수 있으므로, 실패 시 로컬 권한으로 한 번 재확인한 뒤 판단한다.
   - 토큰 invalid, 만료, 권한 부족, 로그인 없음이면 `gh auth login -h github.com` 이 필요하다고 안내하고 중단한다.
2. **현재 계정 확인**: `gh api user --jq .login` 으로 active account 를 읽는다.
3. **필수 계정 전환**: 현재 계정이 `kai-leeee` 가 아니면 `gh auth switch -h github.com -u kai-leeee` 를 실행한다.
   - `kai-leeee` 로 로그인된 계정이 없어서 전환할 수 없으면 `gh auth login -h github.com -u kai-leeee` 이 필요하다고 안내하고 중단한다.
   - 다른 계정으로 전환하거나 `gh auth logout` 을 실행하지 않는다.
4. **재확인**: 다시 `gh api user --jq .login` 을 실행한다.
   - 결과가 `kai-leeee` 이면 성공.
   - 여전히 다르면 실제 계정명을 사용자에게 알리고 중단한다.

## 출력

- 성공: `GitHub CLI active account: kai-leeee`
- 실패: 실패한 명령과 필요한 사용자 조치(`gh auth login -h github.com -u kai-leeee` 등)를 짧게 안내한다.

## Codex Invocation

Use this as a Codex project skill. Invoke `gh-auth-check` before any workflow step that depends on `gh` or GitHub push/PR permissions.
