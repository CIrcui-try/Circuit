---
name: "review-and-fix"
description: "로컬 변경사항을 직접 리뷰하고 문제점 수정 후 커밋·푸시"
---

# review-and-fix

Use this skill when the user asks to run the `review-and-fix` workflow.

## Command Template

현재 브랜치의 로컬 변경사항을 직접 읽고 코드 리뷰를 수행한 뒤, 발견된 문제를 수정·커밋·푸시하는 커맨드.

`$ARGUMENTS`로 처리할 최소 심각도를 받는다. 예: `/review-and-fix minor`

- `critical` → 🔴 Critical만 처리
- `major` (기본값, 미지정 포함) → 🔴 Critical + 🟠 Major 처리
- `minor` → 🔴 Critical + 🟠 Major + 🟡 Minor 전체 처리

## 절차

### 1단계: 로컬 변경 범위 확인

1. **현재 브랜치 확인**: `git branch --show-current`로 브랜치 이름을 가져온다.
2. **`develop`/`main` 경고**: 현재 브랜치가 `develop` 또는 `main`이면 경고하고 중단한다.
3. **작업트리 상태 확인**: `git status --short`로 staged/unstaged/untracked 변경을 확인한다.
4. **비교 기준 확인**: `origin/develop`이 있으면 기본 기준으로 사용하고, 없으면 `develop`을 사용한다.
5. **공통 조상 확인**: `git merge-base HEAD <기준브랜치>`로 현재 브랜치의 로컬 변경 기준점을 찾는다.

### 2단계: diff 수집

1. **브랜치 diff 수집**: `git diff <merge-base>...HEAD`로 기준 브랜치 이후의 커밋 변경사항을 수집한다.
2. **작업트리 diff 수집**: staged 변경은 `git diff --cached`, unstaged 변경은 `git diff`로 수집한다.
3. **변경 파일 목록 파악**: `git diff --name-only <merge-base>...HEAD`, `git diff --cached --name-only`, `git diff --name-only`, `git status --short`의 `??` 파일을 합쳐 중복 없이 확인한다.
4. **untracked 파일 확인**: `??` 파일은 diff가 없더라도 파일 전체를 Read로 읽어 리뷰 대상에 포함한다.
5. **변경 없음 처리**: 수집된 diff와 변경 파일이 모두 없으면 사용자에게 알리고 종료한다.

### 3단계: 코드 리뷰

변경된 각 파일을 Read로 읽어 **diff뿐 아니라 파일 전체 컨텍스트**를 파악한 뒤 문제점을 찾는다.

#### 리뷰 관점

- **보안**: 인젝션, XSS, 인증/인가 누락, 민감 정보 노출
- **정합성**: 로직 오류, 엣지 케이스 미처리, 누락된 에러 처리
- **성능**: 불필요한 쿼리, N+1, 무한 루프 가능성
- **아키텍처**: CLAUDE.md에 명시된 레이어드 아키텍처 원칙 위반 여부
  - 백엔드: Router → Service → Repository 분리
  - 프런트엔드: Presentation → Domain → Data 분리
- **코드 품질**: 네이밍, 중복 코드, 불필요한 복잡도, console.log 잔존

#### 심각도 분류

- 🔴 **Critical**: 보안 취약점, 데이터 손실/훼손, 크래시/무한 루프 유발
- 🟠 **Major**: 로직 오류, 누락된 에러 처리, 성능 문제, 아키텍처 원칙 위반
- 🟡 **Minor**: 코드 스타일, 네이밍 개선, 불필요한 코드, 타입 미비

### 4단계: 리뷰 결과 정리 & 사용자 확인

`$ARGUMENTS` (미지정 시 `major`) 기준으로 필터링한 뒤 아래 형식으로 출력한다:

```
[1] 🔴 Critical — API/app/services/auth.py:194
    JWT 시크릿이 하드코딩되어 있음...

[2] 🟠 Major — Web/src/pages/login.tsx:28
    returnTo를 검증 없이 리디렉션에 사용...
```

- 발견된 항목이 없으면 사용자에게 알리고 종료한다.
- 출력 후 사용자에게 수정 진행 여부를 확인받는다.

### 5단계: 코드 수정

각 항목을 순서대로 처리한다:

1. **파일 읽기**: 해당 파일을 Read로 읽는다.
2. **현재 코드 확인**: 지적한 라인 주변 코드를 분석한다.
3. **수정**: Edit 도구로 수정한다. 수정 시 기존 코드 스타일과 패턴을 유지한다.
4. **수정 불가 판단**: 수정 범위가 불명확하거나 구조적 변경이 필요해 안전하게 자동 적용하기 어려운 경우, 스킵하고 사용자에게 이유를 알린다.

### 6단계: 품질 확인

수정된 파일의 종류에 따라 확인한다:
- **프런트엔드 파일(`Web/`) 포함 시**: `cd Web && npm run build`가 에러 없이 통과해야 한다.
- **백엔드 파일(`API/`) 포함 시**: `cd API && pytest`가 통과해야 한다.
- **`console.log` 확인**: 수정된 파일에 `console.log`가 남아있지 않은지 확인한다.

빌드 또는 테스트가 실패하면 해결될 때까지 다음 단계로 넘어가지 않는다.

### 7단계: 커밋 & 푸시

수정된 파일을 개별적으로 `git add`한 뒤 커밋하고 푸시한다.

- 커밋 메시지 형식: `fix: 코드 리뷰 반영 (<significance> 이상)`
  - 예: `fix: 코드 리뷰 반영 (major 이상)`
- 리모트 트래킹 브랜치가 있으면 `git push`, 없으면 `git push -u origin <브랜치이름>`.

## 주의사항

- `.env`, `credentials.json` 등 민감한 파일은 절대 수정하지 않는다.
- `develop`이나 `main` 브랜치에서 실행 시 즉시 중단한다.
- 수정 항목이 0개인 경우(모두 스킵) 사용자에게 알리고 커밋 없이 종료한다.
- 리뷰는 로컬 diff 범위 내 코드만 대상으로 한다. diff에 포함되지 않은 기존 코드의 문제는 지적하지 않는다.
- 테스트 파일의 코드 품질(Minor)은 리뷰 대상에서 제외한다.

## Codex Invocation

Use this as a Codex project skill. Invoke `review-and-fix` with the issue id and flags as described above; treat the user text after the skill name as ``.
