# Phase 05 – Manual Runner

## Goal

Build a mock runner that runs a workflow manually when the user presses the Start Circuit button.

## Scope

- Start Circuit button
- Workflow traversal
- Node state management
- Mock skill execution
- Sequential execution
- Failure-state representation

## Tasks

1. Define a `WorkflowRunner` interface.
2. Implement a mock runner that traverses the workflow graph sequentially.
3. As each node executes, change its state to `queued`, `running`, `success`, or `failed`.
4. Ensure execution starts only when the user clicks the button.
5. Prevent duplicate runs while one is already in progress.

## Out of Scope

- Actual Claude/Codex execution
- Auto-trigger
- Conditional branching
- Parallel execution

## Verification Checklist

- [ ] Execution only starts when the Start Circuit button is pressed.
- [ ] Nodes run in the connected order.
- [ ] Currently running nodes display state `running`.
- [ ] Completed nodes become `success`.
- [ ] Pressing Start while a run is in progress does not trigger a duplicate run.

## Required End-of-Phase Briefing

After completing a Phase, the coding agent must write a briefing in the following format.

```md
# Phase N Briefing

## Implemented
- Summarize what was implemented.

## Changed Files
- List the main files that were changed and their roles.

## Verification
- Document the checklist that was confirmed and how to run it.

## Known Limitations
- Document what has not yet been implemented and what was intentionally excluded.

## Next Recommendation
- Suggest what to do in the next Phase.
```
