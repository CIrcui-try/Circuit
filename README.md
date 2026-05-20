<p align="center">
  <img src="docs/assets/readme/circuit-graphic-logo.png" alt="Circuit" width="520">
</p>

# Circuit

[한국어 README](README_kr.md) | [中文 README](README_zh.md)

#### For your SDD (Skill-Driven Development).

Circuit is a workspace for turning reusable agent skills into visible, repeatable, and controllable development workflows.

Circuit started from a recurring pain point in AI-native projects. As more work gets delegated to agents, such as planning, implementation, and review, productivity improves, but the actual development flow often disappears into long prompts, command chains, and TUI sessions. As projects grow, this problem becomes more visible, and it becomes common to spend a long time digging through terminal output just to find which task finished, which one is running, and where a problem occurred.

This is where Skills become useful. As agent work repeats across planning, implementation, review, commit, merge, and deploy, skills move beyond one-off prompts or helper scripts and become repeatable units of development.

Circuit was built to turn this Skill-Driven Development into a visible, repeatable, and above all human-understandable _workflow_.

## What Can Circuit Do?

### Build Skill-Driven Development Workflows

https://github.com/user-attachments/assets/b04314bb-49fd-40ec-a89e-c64aea4e17ef

Circuit is not about running a single skill. Its core idea is to help you build SDD workflows from the skills you already use. You can bring in the skills you need as blocks, reorder them, connect their dependencies, and insert new steps into the flow.

For example, you can create a flow like this:

```text
planning → implementation → review → commit
```

When the way your SDD routine changes, the workflow can change with it:

```text
planning → implementation → commit → review
```

If you need an intermediate check, add a new skill into the flow:

```text
planning → check-token → implementation → review → wrap-up
```

When the context gets long, you can add a `compact` skill. If cleanup is needed after the task, you can add a `wrap-up` skill. If you want to check token usage, you can create a skill such as `check-token` and place it between larger steps.

These flows can be written as command lists, but Circuit treats them as visible graphs. When skill order or dependencies change, you do not need to reconstruct the whole SDD process from memory. You can update the nodes and edges instead.

### Use Claude And Codex Together

https://github.com/user-attachments/assets/f37c94f1-7af4-4984-8cec-41bac0d59ffd

Many projects already contain more than one kind of agent automation. Some SDD routines may be written as Claude skills, while others may be managed as Codex skills. Within the same agent, you may also want to choose different models depending on the task.

Circuit reads `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md` from your local repository and lets you place both kinds of skills on the same canvas. It does not treat Claude and Codex as competing tools. It treats them as different execution capabilities and model choices that belong to the local project.

The actual skill files remain in the repository. Circuit does not move them elsewhere or force them into a separate format. Instead, it reads the skills from the repository, shows them on the canvas, and provides a visual layer for defining their order and dependencies.

### Create A Local Skill In Circuit

When the selected repository has no custom skills yet, the Skills sidebar shows a New Skill action. The same action is also available from the sidebar header. Creating a skill writes a normal `SKILL.md` file back into the selected repository, then Circuit re-scans the repository and adds the new skill to the canvas.

Choose the provider based on the agent that should run the skill:

- Claude skills are created under `.claude/skills/<slug>/SKILL.md`.
- Codex skills are created under `.codex/skills/<slug>/SKILL.md`.

The slug becomes the directory name and may contain only letters, numbers, hyphens, or underscores. The provider does not change the file format; it controls which runtime adapter is used when the workflow executes the skill.

### Track Execution State

https://github.com/user-attachments/assets/08b5fb7f-6da0-4a0b-a7a6-59307791680f

When a workflow runs, you can see which skill is currently running, which steps have completed, and where a failure happened through the canvas and Run Log. Active workflows can be cancelled when needed, and failed runs are easier to inspect because the stopping point remains visible.

### Handle Loops And Repeated Flows

https://github.com/user-attachments/assets/4436fe4f-ec41-4ebb-a8a5-5e99944e1604

Not every workflow ends in a straight line. Some routines need repetition. For example, you may want to review a failed task again or repeat a check until a condition is satisfied.

Circuit helps you manage these repeated flows more safely. Since a cyclic graph can run indefinitely, Circuit shows a warning before execution and lets you run it only after confirming that the loop is intentional.

Because the loop remains visible on the canvas, you can see which skill will be called again and adjust the routine when needed.

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
