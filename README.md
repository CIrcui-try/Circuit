<p align="center">
  <img src="docs/assets/readme/circuit-graphic-logo.png" alt="Circuit" width="520">
</p>

# Circuit

[한국어 README](README_kr.md)

#### Circuit is a workflow visualization tool that makes agent behavior more predictable.

Circuit started from a recurring pain point in AI-native projects. As more work gets delegated to agents, such as planning, implementation, and review, productivity improves, but it becomes harder to understand and control what the agent is doing when you are not watching it directly. As projects grow, it becomes increasingly common to dig through large amounts of terminal output and prompts just to find which step finished and where human input is needed.

This becomes especially noticeable when agents handle repeated tasks such as planning, implementation, review, commit, merge, and deploy. Automation itself is powerful, but once the flow starts running inside long prompts, command chains, or TUI sessions, it becomes difficult to recover where the agent is, what has finished, and where it failed.

Circuit was built to make that problem visible. It automatically reads Claude and Codex skills from your local repositories, lets you place the skills on a canvas as blocks, connect their order and dependencies, and run them as a single routine. You can also see which step the agent is currently in, which steps have completed, and where a run failed through the canvas and execution log.

When using multiple agents and models together, Circuit also lets you flexibly configure the arguments and options each step needs, so you can tune and optimize the workflow more precisely.

Circuit is not only for advanced users who are already comfortable with agent automation. Its goal is to help people who are just starting to create skills and routines, or who repeat similar work often but are not yet comfortable with command-based automation, build and run their own workflows.

## Why Circuit?

Circuit turns the order, dependencies, and execution state that appear when delegating repeated work to agents into a visible flow.

When using agents, routines like this often repeat:

```text
plan → implement → review → commit → merge → deploy
```

Real workflows, however, are rarely this clean. Some tasks need to go back to implementation after review. Some should stop after commit and leave merge for later. Larger changes may need a token check between steps, and long contexts may need a compact step inserted into the flow.

The problem is that these orders and dependencies keep changing. With plain command chains or terminal history, it is hard to see which skill runs in which order, where a new step should be inserted, and where a person needs to intervene.

### Turn Repeated Skill Routines Into Workflows

Circuit is not about running a single skill. Its core idea is to combine multiple skills into one routine. You can bring in the skills you need as blocks, reorder them, connect their dependencies, and insert new steps into the flow.

For example, you can create a flow like this:

```text
planning → implementation → review → commit
```

When the way you work changes, the routine can change with it:

```text
planning → implementation → commit → review
```

If you need an intermediate check, add a new skill into the flow:

```text
planning → check-token → implementation → review → wrap-up
```

When the context gets long, you can add a `compact` skill. If cleanup is needed after the task, you can add a `wrap-up` skill. If you want to check token usage, you can create a skill such as `check-token` and place it between larger steps.

These flows can be written as command lists, but Circuit treats them as visible graphs. When skill order or dependencies change, you do not need to reconstruct the whole process from memory. You can update the nodes and edges instead.

### Use Claude And Codex Together

Many projects already contain more than one kind of agent automation. Some routines may be written as Claude skills, while others may be managed as Codex skills. Within the same agent, you may also want to choose different models depending on the task.

Circuit reads `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md` from your local repository and lets you place both kinds of skills on the same canvas. It does not treat Claude and Codex as competing tools. It treats them as different execution capabilities and model choices that belong to the local project.

The actual skill files remain in the repository. Circuit does not move them elsewhere or force them into a separate format. Instead, it reads the skills from the repository, shows them on the canvas, and provides a visual layer for defining their order and dependencies.

### Track Execution State

When a workflow runs, you can see which skill is currently running, which steps have completed, and where a failure happened through the canvas and Run Log. Active workflows can be cancelled when needed, and failed runs are easier to inspect because the stopping point remains visible.

### Handle Loops And Repeated Flows

Not every workflow ends in a straight line. Some routines need repetition. For example, you may want to review a failed task again or repeat a check until a condition is satisfied.

Circuit does not block loops outright. Since a cyclic graph can run indefinitely, Circuit shows a warning before execution, but it still allows the run if the loop is intentional.

The important point is that loops are not hidden. The repeated flow appears directly on the canvas, making it easier to see which skill will be called again and adjust the routine when needed.

## Local-First Runtime Model

Circuit is a local-first app. Skills and workflows operate against the user's local repositories.

- Skill discovery reads files from the selected repository.
- Claude and Codex skill definitions keep using the existing repository structure.
- Workflow execution is handled through a Tauri backend bridge.
- Claude and Codex execution is connected through provider adapter interfaces.
- Execution output streams into the in-app log panel.
- Safety-sensitive runtime behavior stays in the local environment instead of being delegated to a remote service.

Circuit currently centers on explicit manual execution. It does not use file changes as automatic triggers, push to git remotes, perform deployments, or run arbitrary shell-command nodes.

## Milestones

Circuit is in active development. Current limitations include:

- There is no collaboration or shared remote workspace yet.
- Automatic deployment and git push behavior are not provided.
- User-configurable global skill directory discovery is not available yet.
- There is no arbitrary shell command node type.
- The runtime surface is still being strengthened as the app evolves.
