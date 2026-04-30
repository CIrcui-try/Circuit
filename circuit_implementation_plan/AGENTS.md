# Coding Agent Guide

## Project Intent

Circuit is not an IDE and not a code editor. Circuit is a visual editor for wiring local agent skills together.

A skill is discovered only from:

```text
<repo>/.claude/skills/*/SKILL.md
<repo>/.codex/skills/*/SKILL.md
```

## Current Project State

Assume the following are already implemented:

- Phase 00: Tauri + React foundation
- Phase 01: repository manager
- Phase 02: skill discovery

Start with Phase 03 unless explicitly instructed otherwise.

## Architecture Principles

### 1. Keep UI, Schema, and Runner Separate

Do not mix these responsibilities:

```text
Visual Flow Editor
Workflow Schema
Manual Runner
Agent Adapter / Handoff
```

### 2. Use a Bridge for Host Capabilities

Frontend code must not directly depend on native host behavior. Use a bridge abstraction for:

- repository selection
- file system access
- skill discovery
- future command execution

This bridge must be mockable in Playwright/UI tests.

### 3. Do Not Automate Native File Dialogs in E2E

Native macOS folder pickers should not be directly automated in Playwright tests. Mock the bridge method instead.

### 4. Add Tests Phase by Phase

Starting from Phase 03, every phase must add or update at least one meaningful test.

Expected tooling:

```text
Vitest for core logic
Playwright for UI/E2E
```

### 5. Preserve Product Scope

Do not add a code editor. Do not add global skill discovery. Do not add built-in default skills unless explicitly requested.


## Required End-of-Phase Briefing

코딩 에이전트는 Phase를 완료한 뒤 반드시 아래 형식으로 브리핑을 작성해야 한다.

- 브리핑은 **한국어로 작성**한다 (섹션 헤딩은 템플릿 안정성을 위해 영어 그대로 두어도 된다).
- 브리핑은 채팅 응답이 아닌 **파일**로 남긴다. 경로는 `circuit_implementation_plan/phases/0N-{phase-slug}-briefing.md` 형식 (예: `02-skill-discovery-briefing.md`).
- 브리핑은 해당 Phase의 테스트가 모두 통과한 뒤에 작성한다.

```md
# Phase N Briefing

## Implemented
- 구현한 기능을 요약한다.

## Changed Files
- 변경한 주요 파일과 역할을 적는다.

## Verification
- 직접 확인한 체크리스트와 실행 방법을 적는다.

## Tests
- 추가하거나 수정한 테스트를 적는다.
- 테스트 실행 명령어와 결과를 적는다.

## Known Limitations
- 아직 구현하지 않은 것과 의도적으로 제외한 것을 적는다.

## Next Recommendation
- 다음 Phase에서 해야 할 일을 제안한다.
```

## Required Phase Commit

After the briefing is written, all changes for that Phase must be recorded as a **single commit**.

- The commit subject must reference the Phase number (e.g. `Phase 0: foundation`, `Phase 2: skill discovery`).
- The commit must only be made once the tests required by §"Add Tests Phase by Phase" are all green.
- Do not mix changes outside the Phase scope into the same commit.
