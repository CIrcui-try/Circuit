## 슬래시 커맨드 공통 규칙

`.claude/commands/`, `.claude/skills/`, `.codex/commands/`, `.codex/skills/`, `.agents/skills/` 안의 모든 워크플로에 공통으로 적용한다. 개별 커맨드와 스킬은 이 규칙을 다시 명시하지 않는다.

### Claude / Codex 양립

- `.claude/commands/` 는 Claude 전용 슬래시 커맨드다. `.claude/state`, `mcp__linear-server__*`, `TodoWrite`, `AskUserQuestion`, `ExitPlanMode` 같은 Claude 전용 표현을 Codex 방식으로 바꾸지 않는다.
- `.claude/skills/` 는 Circuit 앱의 Claude 스킬 디스커버리용 미러다. Claude 커맨드와 같은 런타임 표현을 유지한다.
- `.codex/commands/` 는 Codex 슬래시 커맨드 전용이다. `.codex/state` 와 Codex에서 사용할 수 있는 도구명을 기준으로 유지한다.
- `.codex/skills/` 는 Circuit 앱의 Codex 스킬 디스커버리용 미러다. `.agents/skills/` 와 같은 Codex 런타임 표현을 유지한다.
- `.agents/skills/` 는 Codex 프로젝트 스킬용 원본이다. Claude 커맨드를 덮어쓰거나 대체하지 않고, Codex 앱에서 재사용할 워크플로 지침으로 관리한다.
- 같은 워크플로 이름을 공유하더라도 Claude와 Codex의 상태 디렉터리, MCP 서버명, 도구명은 런타임별로 분리한다.

### Plan mode 호환

Plan mode 가 활성화된 상태에서 워크플로가 호출되어도 **거부하지 말 것.** Plan mode 의 정의는 "계획만 세우고 승인 후 실행" 이므로 다음 순서로 처리한다:

1. 읽기 전용 도구로 커맨드가 실제로 수행할 작업 (워크트리 경로, 변경 파일, 커밋 단위 후보, 실행할 명령) 을 충분히 파악한다.
2. plan 파일에 그 내용을 구체적으로 정리한다. "plan mode 라서 못 한다" 같은 답변은 금지.
3. Claude 에서는 `ExitPlanMode`, Codex 에서는 Codex Plan mode 승인 흐름으로 승인 요청한다. 사용자가 plan mode 를 빠져나오면 정리한 계획대로 실제 절차를 그대로 이어 수행한다.

### 커밋 / GitHub 계정

- 커밋 author 와 committer 는 반드시 `kai-leeee`. 두 값이 일치해야 한다.
- 커밋 메시지에 `Co-Authored-By` 트레일러를 추가하지 않는다.
- GitHub CLI(`gh`) 를 실제로 호출하는 워크플로에서는 active account 도 `kai-leeee` 여야 한다. 첫 `gh` 명령 직전에만 `gh-auth-check` 스킬 절차로 확인·전환하고, 전환에 실패하거나 `kai-leeee` 로 로그인되어 있지 않으면 작업을 중단하고 사용자에게 알린다.
- 앱 시작, 저장소 읽기, 로컬 구현, 테스트, 커밋-only 작업처럼 `gh` 를 호출하지 않는 흐름에서는 `gh-auth-check` 를 선제 실행하지 않는다.

**모든 답변은 한국어로 합니다**
