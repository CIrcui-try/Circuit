# Circuit - 基于 Skill 的 AI Agent Harness 编辑器

<p align="center">
  <img src="docs/assets/readme/circuit-graphic-logo.png" alt="Circuit" width="520">
</p>

<p align="center">
  <a href="https://github.com/CIrcui-try/Circuit/actions/workflows/ci.yml?branch=develop"><img src="https://img.shields.io/github/actions/workflow/status/CIrcui-try/Circuit/ci.yml?branch=develop&label=CI&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/CIrcui-try/Circuit/releases"><img src="https://img.shields.io/github/v/release/CIrcui-try/Circuit?include_prereleases&label=Release&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CIrcui-try/Circuit?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-111827?style=for-the-badge" alt="Platform: macOS and Windows">
  <img src="https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white&style=for-the-badge" alt="Tauri 2.x">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827&style=for-the-badge" alt="React 19">
</p>

[English README](README.md) | [한국어 README](README_kr.md)

<p align="center">
  <img src="docs/assets/readme/circuit-harness-editor.png" alt="Circuit Harness 编辑器截图" width="920">
</p>

Circuit 是一个基于 Skill 的 AI Agent Harness 编辑器，用来把 Agent 工作转化为可见、可重复、可控制的开发工作流。

Circuit 源于 AI-native 项目中反复出现的一个痛点。随着越来越多的工作被交给 Agent 完成，例如规划、实现和评审，生产力会提升，但真正的开发流程也会被隐藏在冗长的 prompt、命令链，以及难以理解的长输出里。项目越大，这个问题就越明显：为了确认哪个任务已经结束、哪个任务正在运行、问题出现在哪里，常常需要花很长时间回翻终端输出。

帮助处理这种流程的，正是模块化的 Skill。当 Agent 工作形成重复例程时，Skill 就不再只是一次性的 prompt 或辅助脚本，而会成为构成开发流程的可重复工作单元。但这种 Skill-Driven Development 仍然常常依赖文本化的流程，因此工作流不容易编辑和理解。Skill 之间的关系和依赖无法一眼看清，所以即使只是调整顺序或增加分支，也需要重新梳理整个流程。

Circuit 的目标，是把这种 Skill-Driven Development 转化为可见、可重复，最重要的是人能理解的 _可视化工作流_。

## TL;DR
### Quickstart

最简单的开始方式，是从 GitHub Releases 下载最新版本的 macOS 应用。

也可以 clone 这个仓库后从源码运行。

```bash
git clone https://github.com/CIrcui-try/Circuit
cd Circuit/app
pnpm install
pnpm tauri dev
```

如果需要本地构建，可以使用下面的命令。

```bash
cd app
pnpm tauri build
```

启动 Circuit 后，选择要工作的仓库，然后把仓库中 `.claude/skills` 或 `.codex/skills` 里的 Skill 放到画布上，就可以创建工作流。

## Circuit 可以做什么？

### 构建 Skill 可视化工作流

https://github.com/user-attachments/assets/b04314bb-49fd-40ec-a89e-c64aea4e17ef

Circuit 的核心是把多个 Skill 连接成一个工作流。你可以像使用积木一样引入需要的 Skill，调整顺序，连接依赖关系，并在流程中插入新的步骤。

例如，你可以创建这样的流程：

```text
planning → implementation → review → commit
```

当例程发生变化时，工作流也可以随之调整。

```text
planning → implementation → commit → review
```

如果需要中间检查步骤，可以把新的 Skill 插入流程。

```text
planning → check-token → implementation → review → wrap-up
```

当上下文变长时，可以加入 `compact` Skill。如果想在过程中检查 token 使用量，也可以创建类似 `check-token` 的 Skill，并把它放在较大的步骤之间。

使用 Circuit 时，当 Skill 的顺序或依赖关系发生变化，你不需要重新在脑中整理 Skill 之间的流程，只需要修改节点和边即可。

### 跟踪执行状态

https://github.com/user-attachments/assets/08b5fb7f-6da0-4a0b-a7a6-59307791680f

工作流运行时，你可以通过画布和 Run Log 看到当前哪个 Skill 正在运行、哪些步骤已经完成，以及失败发生在哪里。

正在运行的工作流可以在需要时取消；失败的运行也更容易检查，因为停止的位置仍然可见。

### 处理循环

https://github.com/user-attachments/assets/4436fe4f-ec41-4ebb-a8a5-5e99944e1604

并不是所有工作流都会沿着一条直线结束。有些例程需要重复。例如，你可能想再次检查失败的任务，或者重复某个检查步骤，直到满足特定条件。

Circuit 可以帮助你更安全地管理这些重复流程。由于带有环的图可能无限运行，Circuit 会在执行前显示警告，并在确认该循环是有意设计之后才允许运行。

因为循环会直接显示在画布上，你可以看到哪个 Skill 会被再次调用，并在需要时调整例程。

### 同时使用 Claude 和 Codex

https://github.com/user-attachments/assets/f37c94f1-7af4-4984-8cec-41bac0d59ffd

许多项目中已经混合存在不止一种 Agent 自动化。有些例程可能写成 Claude Skill，另一些可能由 Codex Skill 管理。即使在同一个 Agent 中，也可能需要根据任务性质选择不同的模型。

Circuit 会从本地仓库读取 `.claude/skills/*/SKILL.md` 和 `.codex/skills/*/SKILL.md`，并允许你把两类 Skill 放在同一个画布上。它不会把 Claude 和 Codex 当作彼此竞争的工具，而是把它们视为属于本地项目的不同执行能力和模型选择。

实际的 Skill 文件仍然保留在仓库中。Circuit 不会把它们移动到其他地方，也不会强制转换成单独的格式。它只是从仓库读取 Skill，在画布上展示它们，并提供一个用于定义顺序和依赖关系的可视层。

## 欢迎贡献！

Circuit 仍在积极开发中。欢迎提交 bug report、可用性反馈、文档改进、示例工作流、runtime 稳定性改进和 UI 改进。

从小的贡献开始也很好。实际使用时如果有让你困惑的地方，可以开 issue；如果 README 的说明可以更清楚，可以直接改进；如果你有常用的 `.claude/skills` 或 `.codex/skills` 工作流示例，也很欢迎分享。

本地开发可以按下面的流程开始。

```bash
git clone https://github.com/CIrcui-try/Circuit
cd Circuit/app
pnpm install
pnpm tauri dev
```

发送 PR 之前，请尽量确认下面的命令。

```bash
cd app
pnpm test:run
pnpm build
cd src-tauri
cargo test
```

如果要修改较大的功能方向或 runtime 行为，请先开 issue 说明意图。Circuit 处理的是本地仓库和 Agent 执行流程，所以除了便利性，也很重视用户是否能理解并控制正在发生的事情。

请使用英文编写 commit message、PR 标题和 PR 正文。
