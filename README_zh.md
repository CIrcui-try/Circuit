ㅋ<p align="center">
  <img src="docs/assets/readme/circuit-graphic-logo.png" alt="Circuit" width="520">
</p>

# Circuit

[English README](README.md) | [한국어 README](README_kr.md)

## 为你的 SDD（Skill-Driven Development）而生

Circuit 是一个工作空间，用来把可复用的智能体 Skill 转化为可见、可重复、可控制的开发工作流。

Circuit 源于 AI-native 项目中反复出现的一个痛点。随着越来越多的工作被交给智能体完成，例如规划、实现和评审，生产力会提升，但真正的开发流程也会被隐藏在冗长的 prompt、命令链和 TUI 会话这个黑盒里。项目越大，这个问题就越明显：为了确认哪个任务已经结束、哪个任务正在运行、问题出现在哪里，常常需要花很长时间回翻终端输出。

帮助处理这种流程的，正是模块化的 Skill。当智能体工作在规划、实现、评审、提交、合并和部署等环节中形成重复例程时，Skill 就不再只是一次性的 prompt 或辅助脚本，而会成为构成开发流程的可重复工作单元。

但这种 Skill-Driven Development 仍然常常依赖文本化的流程，因此工作流不容易编辑和理解。Skill 之间的关系和依赖无法一眼看清，所以即使只是调整顺序或增加分支，也需要重新梳理整个流程。

Circuit 的目标，是把这种 Skill-Driven Development 转化为可见、可重复，最重要的是人能理解的 _可视化工作流_。

## Circuit 能做什么？

### 构建 Skill-Driven Development 工作流

https://github.com/user-attachments/assets/b04314bb-49fd-40ec-a89e-c64aea4e17ef

Circuit 的核心不是运行单个 Skill，而是帮助你用已经在使用的 Skill 构建 SDD 工作流。你可以像使用积木一样引入需要的 Skill，调整顺序，连接依赖关系，并在流程中插入新的步骤。

例如，你可以创建这样的流程：

```text
planning → implementation → review → commit
```

当你的 SDD 例程发生变化时，工作流也可以随之调整：

```text
planning → implementation → commit → review
```

如果需要中间检查步骤，可以把新的 Skill 插入流程：

```text
planning → check-token → implementation → review → wrap-up
```

当上下文变长时，可以加入 `compact` Skill。任务结束后如果需要整理，可以加入 `wrap-up` Skill。如果想检查 token 使用量，也可以创建类似 `check-token` 的 Skill，并把它放在较大的步骤之间。

这些流程当然也可以写成命令列表，但 Circuit 会把它们当作可见的图来处理。当 Skill 的顺序或依赖关系发生变化时，你不需要从记忆里重新拼出整个 SDD 过程，只需要修改节点和边即可。

### 同时使用 Claude 和 Codex

https://github.com/user-attachments/assets/f37c94f1-7af4-4984-8cec-41bac0d59ffd

许多项目中已经混合存在不止一种智能体自动化。有些 SDD 例程可能写成 Claude Skill，另一些可能由 Codex Skill 管理。即使在同一个智能体中，也可能需要根据任务性质选择不同的模型。

Circuit 会从本地仓库读取 `.claude/skills/*/SKILL.md` 和 `.codex/skills/*/SKILL.md`，并允许你把两类 Skill 放在同一个画布上。它不会把 Claude 和 Codex 当作彼此竞争的工具，而是把它们视为属于本地项目的不同执行能力和模型选择。

实际的 Skill 文件仍然保留在仓库中。Circuit 不会把它们移动到其他地方，也不会强制转换成单独的格式。它只是从仓库读取 Skill，在画布上展示它们，并提供一个用于定义顺序和依赖关系的可视层。

### 在 Circuit 中创建本地 Skill

当所选仓库还没有自定义 Skill 时，Skills 侧边栏会显示 New Skill 操作。侧边栏标题处也可以使用同样的操作。创建 Skill 会把普通的 `SKILL.md` 文件写回所选仓库，然后 Circuit 会重新扫描仓库，并把新的 Skill 添加到画布上。

根据应该运行该 Skill 的智能体选择 provider：

- Claude Skill 会创建在 `.claude/skills/<slug>/SKILL.md`。
- Codex Skill 会创建在 `.codex/skills/<slug>/SKILL.md`。

slug 会成为目录名，只能包含字母、数字、连字符或下划线。provider 不会改变文件格式；它决定工作流执行该 Skill 时使用哪个 runtime adapter。

### 跟踪执行状态

https://github.com/user-attachments/assets/08b5fb7f-6da0-4a0b-a7a6-59307791680f

工作流运行时，你可以通过画布和 Run Log 看到当前哪个 Skill 正在运行、哪些步骤已经完成，以及失败发生在哪里。正在运行的工作流可以在需要时取消；失败的运行也更容易检查，因为停止的位置仍然可见。

### 处理循环和重复流程

https://github.com/user-attachments/assets/4436fe4f-ec41-4ebb-a8a5-5e99944e1604

并不是所有工作流都会沿着一条直线结束。有些例程需要重复。例如，你可能想再次检查失败的任务，或者重复某个检查步骤，直到满足特定条件。

Circuit 可以帮助你更安全地管理这些重复流程。由于带有环的图可能无限运行，Circuit 会在执行前显示警告，并在确认该循环是有意设计之后才允许运行。

因为循环会直接显示在画布上，你可以看到哪个 Skill 会被再次调用，并在需要时调整例程。

## Local-First 运行模型

Circuit 是一个 local-first 应用。Skill 和工作流都基于用户的本地仓库运行。

- Skill discovery 会读取所选仓库中的文件。
- Claude 和 Codex Skill 定义会继续使用现有的仓库结构。
- 工作流执行由 Tauri backend bridge 处理。
- Claude 和 Codex 执行通过 provider adapter interface 连接。
- 执行输出会流式写入应用内的日志面板。
- 对安全敏感的 runtime 行为会保留在本地环境中，而不是交给远程服务处理。

Circuit 目前以显式的手动执行为中心。它不会把文件变更作为自动触发器，不会 push 到 git remote，不会执行部署，也不会运行任意 shell-command 节点。

## 里程碑

Circuit 正在积极开发中。当前限制包括：

- 暂时还没有协作或共享的远程工作空间。
- 暂不提供自动部署或 git push 行为。
- 暂不支持用户可配置的全局 Skill 目录 discovery。
- 暂时没有任意 shell command 节点类型。
- runtime 表面仍会随着应用演进持续增强。
