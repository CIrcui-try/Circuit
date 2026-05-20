---
name: "release"
description: "develop\uc744 main\uc73c\ub85c \ub9b4\ub9ac\uc988\ud558\ub294 release/x.y.z \ube0c\ub79c\uce58 + PR \uc0dd\uc131"
---

# release

Use this skill when the user asks to run the `release` workflow.

## Command Template

develop의 변경사항을 모아 `release/x.y.z` 브랜치를 만들고 main으로 향하는 릴리즈 PR을 자동 생성한다.

`$ARGUMENTS`로 버전을 **반드시** 명시해야 한다 (예: `/release 0.2.1`). 비어 있거나 `x.y.z` 형식이 아니면 즉시 중단한다.

기존 PR 본문 구조 ground truth: PR #50 (`gh pr view 50`). 실제 PR 제목과 본문은 영어로 작성한다.

## 절차

### 1단계: 사전 확인

1. **버전 인자 확인**: `$ARGUMENTS`가 비어 있거나 `x.y.z` 정규식 (`^\d+\.\d+\.\d+$`) 에 맞지 않으면 사용자에게 "버전을 `/release 0.2.1` 형식으로 명시해 주세요" 라고 알리고 즉시 중단.
2. **레포 루트 확인**: `git rev-parse --show-toplevel`이 `Reserviano` 루트인지 확인.
4. **변경사항 확인**: `git status --porcelain` 결과가 비어 있어야 한다. uncommitted 변경이 있으면 알리고 중단 (release 작업에 의도치 않게 묶일 위험).
5. **원격 최신화**: `git fetch origin main develop --tags`.
6. **릴리즈 대상 존재 확인**: `git rev-list --count origin/main..origin/develop`이 0이면 "릴리즈할 변경사항 없음"으로 종료.
7. **release 브랜치 충돌 확인**: `git branch -a | grep release/`로 진행 중인 release 브랜치가 있으면 사용자에게 알리고 진행 여부 확인.
8. **버전 중복 확인**: 동일 버전의 태그(`v<버전>`)나 release 브랜치(`release/<버전>`)가 이미 존재하면 알리고 중단.

### 2단계: 변경사항 수집

main..develop 범위의 머지된 PR 메타데이터를 수집한다. 본문 생성 소스로 쓰고, 커밋 메시지 prefix는 보조 신호다.

```bash
# 직전 release 시점 (main의 가장 최근 release PR merge 시각)
gh pr list --state merged --base main --search "release in:title" --limit 1 \
  --json mergedAt,title,number

# 그 시점 이후 develop으로 머지된 PR 목록
gh pr list --state merged --base develop --search "merged:>=<직전 release merge 시각>" \
  --json number,title,body,mergedAt
```

각 PR에서 추출:
- 제목의 conventional commit prefix (`feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `style`, `test`, `ci`, `build`)
- 본문 첫 단락의 영어 사용자 가치 설명 (`## Summary` 블록이 있으면 그 첫 줄). 원문이 한국어이면 영어로 번역해 사용한다.

카테고리 매핑:
- `feat:` → **New features**
- `fix:` → **Bug fixes**
- `refactor:`, `perf:` → 사용자 가시 변경이면 본인 판단으로 **New features** 또는 **Bug fixes** 중 더 적합한 곳에, 아니면 제외
- `docs:`, `chore:`, `style:`, `test:`, `ci:`, `build:` → 제외

### 3단계: 버전 확정

`$ARGUMENTS`로 받은 값을 그대로 사용한다.

### 4단계: PR 본문 자동 생성

PR #50 톤을 참고해 다음 템플릿으로 작성:

```markdown
## <version>

### New features

- <English user-value summary extracted from feat PRs>

### Bug fixes

- <English problem-oriented summary extracted from fix PRs>
```

작성 원칙:
- PR 제목과 본문은 반드시 영어로 작성한다. 한국어를 쓰지 않는다.
- Use user-facing release note phrasing such as "Added...", "You can now...", or "Fixed an issue where...".
- 구현 디테일·내부 모듈명·파일 경로·이슈 번호·PR 번호는 본문에서 제외
- 비어있는 카테고리는 섹션째 생략
- 한 PR 본문에서 여러 사용자 가치 항목이 발견되면 bullet으로 분리

### 4.5단계: 릴리즈 사전 체크 (정적)

신뢰도 높은 정적 분석만 수행한다. prod DB 시뮬레이션·부하 테스트는 시도하지 않는다 (접근권 없음, 로컬 SQLite ↔ Postgres 차이로 안전 신호로 못 씀). 테스트·빌드 통과는 이 스킬의 책임 밖.

#### 체크 1: DB 마이그레이션 파괴성

가장 중요. CLAUDE.md "expand-contract 방식" 규칙 위반을 잡는다.

```bash
# main..develop 사이 신규/변경된 마이그레이션 파일
git diff --name-only origin/main..origin/develop -- API/migrations/versions/
```

각 파일에서 다음 패턴을 grep:

- `op.drop_column(`
- `op.drop_table(`
- `op.drop_constraint(`
- `op.drop_index(`
- `op.alter_column(` 호출에서 `nullable=False` 가 들어가는데 같은 호출 내에 `server_default=` 가 없는 경우
- raw SQL `RENAME COLUMN` / `RENAME TO`
- `op.alter_column(... new_column_name=...)` (rename)
- `op.alter_column(... type_=...)` (타입 변경)

위험 신호 1개 이상이면 ⚠️와 함께 어느 파일·어느 패턴인지 표시.

#### 체크 2: APScheduler 변경 여부

```bash
git diff --name-only origin/main..origin/develop -- API/app/scheduler.py
```

변경이 있으면 ⚠️. Cloud Run 배포 중 구 revision 의 1분 스케줄러가 신규 스키마를 보고 깨질 위험.

#### 체크 3: cloudbuild env vars

```bash
git diff origin/main..origin/develop -- API/cloudbuild.yaml API/cloudbuild-preprod.yaml
```

변경 라인이 있으면 표시. CLAUDE.md 의 2026-04-22~04-27 인시던트 재발 방지 — env vars 가 누락되면 컨테이너가 ephemeral SQLite 로 폴백.

#### 결과 출력

```
릴리즈 사전 체크
  ✅ 마이그레이션 파괴성: 안전 (신규 파일 N개, 위험 패턴 0)
  ⚠️  스케줄러 변경: app/scheduler.py 수정됨 — 구 revision 동시 구동 위험 검토
  ✅ cloudbuild env vars: 변경 없음
```

⚠️ 가 1개라도 있으면 5단계 확인 게이트에서 "그래도 진행 / 중단" 을 명시적으로 선택받는다.

### 5단계: 사용자 확인 게이트

확정된 버전, 생성한 본문, 사전 체크 결과를 사용자에게 함께 보여주고 `AskUserQuestion`으로 확인. 옵션:

- "이대로 진행"
- "본문 수정" (사용자가 다시 작성)
- "중단"

버전을 바꾸려면 사용자가 명령을 다시 실행해야 한다 (스킬 내부에서 재추정하지 않는다).

### 6단계: 브랜치 생성 및 푸시

확인 통과 후:

```bash
git checkout -b release/<버전> origin/develop
git push -u origin release/<버전>
```

### 7단계: PR 생성

```bash
gh pr create \
  --base main \
  --head release/<버전> \
  --title "Release <version>" \
  --body "<5단계에서 확정된 본문>"
```

생성된 PR URL을 사용자에게 보여주고 종료.

## 주의사항

- `--no-verify`, force push, 기타 destructive git 명령 금지.
- develop에 uncommitted 변경이 있으면 절대 진행하지 않는다.
- PR 제목과 본문은 반드시 영어로 작성한다. 한국어를 쓰지 않는다.
- 본문에 이슈 번호·내부 모듈명·PR 번호가 새지 않게 검수.
- `gh` CLI 또는 git 명령 실패 시 root cause를 사용자에게 보고하고 멈춘다. 우회·재시도 금지.
- main 브랜치에 직접 push 시도 금지 (PR 머지로만).
- 사전 체크 ⚠️ 가 있을 때 사용자가 "그래도 진행" 을 명시 선택하지 않으면 진행하지 않는다.

## Codex Invocation

Use this as a Codex project skill. Invoke `release` with the issue id and flags as described above; treat the user text after the skill name as ``.
