# Phase 03 – UI / E2E Test Infrastructure

## Goal

Introduce UI/E2E testing before graph editing becomes complex.

This phase does not add major product features. Its purpose is to make the existing foundation, repository manager, and skill discovery flows testable and protected.

## Scope

- Add Playwright
- Add Vitest if not already present
- Add test scripts
- Add fixture repositories
- Add mockable host/Tauri bridge
- Add stable `data-testid` attributes to key UI elements
- Add initial smoke tests for existing features

## Tasks

1. Install and configure Playwright.
2. Install and configure Vitest if core tests do not already exist.
3. Create a `fixtures/repos/sample-repo` test repository.
4. In the fixture repo, include:
   - `.claude/skills/implement-feature/SKILL.md`
   - `.codex/skills/review-code/SKILL.md`
   - `docs/ignored-skill/SKILL.md`
5. Ensure the ignored `docs/ignored-skill/SKILL.md` is not discovered.
6. Introduce a host bridge abstraction for native capabilities.
7. Mock repository selection and file system/skill discovery in UI tests.
8. Add stable `data-testid` attributes to:
   - repository list
   - add repository button
   - skill list
   - workspace root
   - workflow canvas placeholder
9. Add Playwright smoke tests:
   - app loads
   - repository list is visible
   - mock repository can be added
   - discovered Claude and Codex skills appear
   - arbitrary `docs/ignored-skill/SKILL.md` does not appear
10. Add a CI-friendly command to run tests locally.

## Out of Scope for This Phase

The following are part of the product, but must not be implemented in this phase:

- Graph editing
- Workflow schema persistence
- Manual runner
- Real Claude/Codex execution
- Native macOS file dialog automation

## Verification Checklist

- [ ] `npm run test` or equivalent runs core tests.
- [ ] `npm run test:e2e` or equivalent runs Playwright tests.
- [ ] Playwright can load the app.
- [ ] Native folder picker is not directly automated.
- [ ] Tauri/host bridge is mockable in tests.
- [ ] Fixture repository includes both Claude and Codex skills.
- [ ] E2E verifies only `.claude/skills` and `.codex/skills` are discovered.
- [ ] E2E verifies arbitrary `SKILL.md` outside those folders is ignored.
- [ ] Key UI elements have stable `data-testid` attributes.


## Required End-of-Phase Briefing

코딩 에이전트는 Phase를 완료한 뒤 반드시 아래 형식으로 브리핑을 작성해야 한다.

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
