# Phase 07 – Agent Handoff Contract

## Goal

Define the contract that lets a coding agent read the workflow schema and execute the actual skills in the future.

## Scope

- Finalize the agent-readable workflow schema
- Finalize the skillRef contract
- Design input/output placeholders
- Define the boundary between runner and adapter
- Draft the structure of the execution context

## Tasks

1. Update `SCHEMA.md` to clarify the fields the agent must read.
2. Document the rules for the `SKILL.md` path and provider that each node references.
3. Define how per-node input is stored.
4. Draft how output is passed to the next node.
5. Document the Agent adapter interface.

## Out of Scope

- A complete implementation of automatic Claude/Codex execution
- Complex conditional branching
- Parallel execution
- Multi-agent review loops

## Verification Checklist

- [ ] An agent can determine the execution order from workflow.json alone.
- [ ] It is clear which `SKILL.md` each node references.
- [ ] The direction in which input/output extends is documented.
- [ ] The adapter interface is decoupled from the UI.
- [ ] Implementation of the actual agent runner can begin afterward.

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
