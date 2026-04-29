# Phase 04 – Workflow Schema

## Goal

Convert the graph into a savable workflow schema and restore it back into the editor.

## Scope

- Define the workflow JSON schema
- Serialize graph nodes and edges into the schema
- Deserialize the schema back into a graph
- Save workflows in a repository-local location
- Display the list of saved workflows

## Tasks

1. Define TypeScript types based on `SCHEMA.md`.
2. Build a function that converts the graph state into a Workflow object.
3. Build a function that restores a Workflow object into React Flow nodes/edges.
4. Save workflows in the repository's `.circuit/workflows` directory.
5. Allow saved workflows to be selected from the workspace.

## Out of Scope

- Actual coding agent execution
- Finalized condition/loop schema
- Collaboration sync

## Verification Checklist

- [ ] A workflow can be saved as JSON.
- [ ] The saved file contains repositoryId, nodes, and edges.
- [ ] Each node contains a skillRef.
- [ ] A workflow can be reopened after restarting the app.
- [ ] The restored graph is identical to the saved one.

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
