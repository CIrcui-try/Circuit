---
description: 1단계 — Linear 이슈 요구사항과 코드 영향 범위 정리
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion, Agent, TodoWrite, mcp__linear-server__get_issue, mcp__linear-server__update_issue, mcp__linear-server__list_comments
argument-hint: <Linear 이슈 ID> [--force]
---

작업 준비 1단계. Linear 이슈를 읽어 요구사항을 정리하고 코드 영향 범위를 메모해 디스크에 캐싱한다. Linear 티켓 상태 동기화 외 원격 부수효과 없음.

`$ARGUMENTS` 형식: `<ISSUE-ID> [--force]`. 예: `/boarding CIR-15`, `/boarding CIR-15 --force`.

## 인자 파싱

1. `$ARGUMENTS` 에서 `--force` 토큰 분리. 남은 토큰의 첫 번째를 `<ISSUE>` 로 취급.
2. `<ISSUE>` 가 비어있으면 사용법 안내 후 중단: `/boarding <Linear 이슈 ID> [--force]`.

## 상태 파일 경로

- `MAIN_REPO_ROOT = $(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)`
- `STATE_DIR = $MAIN_REPO_ROOT/.codex/state`
- `STATE_FILE = $STATE_DIR/<ISSUE>.json`
- `ISSUE_FILE = $STATE_DIR/<ISSUE>.issue.md`
- `STATE_DIR` 이 없으면 생성한다.

## 자기 단계 실행 절차

1. 상태 파일 로딩. 없으면 빈 상태(`stages.boarding.done_at = null`)로 초기화.
2. **스킵 판정**: `stages.boarding.done_at` 이 채워져 있고 `--force` 가 없으면 한 줄 요약(`boarding skipped (done at <시각>)`) 출력 후 종료.
3. **이슈 조회**: `mcp__linear-server__get_issue` 로 `<ISSUE>` 조회. 못 찾으면 사용자에게 알리고 중단. `Done`/`Canceled` 상태면 사용자에게 경고하고 계속 진행할지 확인.
4. **티켓 상태 동기화**: 이슈가 작업 전 상태(Backlog/Triage 등)이면 Linear 상태를 `Todo` 로 직접 변경한다. 이미 `In Progress`, `Done`, `Canceled` 이면 되돌리지 않는다.
5. **요구사항 정리**: 제목·상태·우선순위·라벨·설명을 분석해 다음 형식으로 `ISSUE_FILE` 작성:

   ```markdown
   # <ISSUE> — <제목>

   - 상태: <status>
   - 우선순위: <priority>
   - 라벨: <labels>
   - 브랜치: <gitBranchName>

   ## 요구사항
   1. ...
   2. ...

   ## 수락 기준
   - ...

   ## 코드 영향 범위
   - <Grep/Glob 으로 식별한 파일·디렉토리 목록과 한 줄 메모>
   ```

6. **코드 영향 범위 탐색**: Grep/Glob 으로 이슈 키워드와 매칭되는 파일·심볼을 찾아 `코드 영향 범위` 섹션 채우기. 탐색 범위가 넓으면 Explore 서브에이전트를 1개 띄워 위임.
7. **상태 파일 갱신**: 다음 필드를 채워 저장.

   ```json
   {
     "issue": "<ISSUE>",
     "branch": "<gitBranchName>",
     "stages": {
       "boarding":     { "done_at": "<UTC ISO8601>" },
       "door_closing": { "done_at": null },
       "taxiing":      { "done_at": null },
       "takeoff":      { "done_at": null }
     },
     "issue_cache": {
       "title": "...",
       "description_md": "...",
       "labels": [...],
       "priority": <number>,
       "status": "...",
       "fetched_at": "<UTC ISO8601>"
     },
     "issue_summary_path": "<ISSUE_FILE 상대경로>"
   }
   ```

8. **요약 출력**: 사용자에게 이슈 제목, 요구사항 개수, 영향 범위 후보 파일 수를 한두 문장으로 안내.

## 주의사항

- 이 단계는 코드 변경·git 부수효과 없음. 워크트리도 만들지 않는다.
- `--force` 시 `ISSUE_FILE` 과 `issue_cache` 를 덮어쓴다.
- Linear MCP 가 연결되어 있지 않으면 `claude mcp add --transport http linear-server https://mcp.linear.app/mcp` 안내 후 중단.
- Linear 티켓 상태는 자동화에 위임하지 않고 직접 `Todo` → `In Progress` → `Done` 으로만 처리한다.
