# Phase 03 – Visual Flow Editor

## Goal

Allow discovered skills to be added to the canvas as nodes, and let users edit the connections between nodes.

## Scope

- Add nodes from the skill list to the canvas
- Move nodes
- Select nodes
- Delete nodes
- Connect edges
- Delete edges
- Show basic info for the selected node

## Tasks

1. Build a React Flow-based canvas.
2. Add a node by clicking or drag-and-dropping a skill item.
3. Each added node carries a skillRef.
4. Allow edges to be connected between nodes.
5. Implement node and edge deletion.
6. In the right panel, show the provider, skill path, and label of the selected node.

## Out of Scope

- Code editing
- Modifying SKILL.md
- Actual execution
- Conditional branching
- Auto layout

## Verification Checklist

- [ ] Skills can be added as nodes.
- [ ] Each node references the original `SKILL.md` path.
- [ ] Nodes can be moved.
- [ ] Edges can be connected between nodes.
- [ ] Nodes and edges can be deleted.
- [ ] The app behaves as a visual flow editor.

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
