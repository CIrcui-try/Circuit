# Phase 06 – Run Visualization

## Goal

Make the state of a running workflow clearly visible on the graph.

## Scope

- Highlight the currently running node
- Style for completed / failed / queued states
- Indicate edge progress direction
- Run log panel
- Basic stop-on-failure and retry UI

## Tasks

1. Define styles per node state.
2. Nodes in the `running` state should glow or pulse.
3. Clearly distinguish `success`, `failed`, `queued`, and `idle` states.
4. Record node start/complete/fail events in the run log panel.
5. Surface failed nodes to the user when present.

## Out of Scope

- Real error recovery
- Agent output parsing
- Multi-agent review loop

## Verification Checklist

- [ ] The currently running node is immediately noticeable.
- [ ] Completed / failed / queued states are distinguishable.
- [ ] The run log is shown in chronological order.
- [ ] Failure state is reflected in both the graph and the log.

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
