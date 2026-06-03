# Prime Intellect

来源：

- [Autonomous AI research for nanogpt speedrun](https://www.primeintellect.ai/auto-nanogpt)
- [Prime Intellect home](https://www.primeintellect.ai/)

## 它们做什么

Prime Intellect 公开发布了围绕 nanoGPT 的自主 speedrun setup，并描述了他们使用的 harness 文件。公开经验是：持久工作记忆和 optimizer 或模型代码同样重要。

他们的博客描述了：

- `AGENTS.md`：规则和自主约束
- `goal.md`：任务上下文
- `plan.md`：可变尝试状态
- `scratchpad/THREAD.md`：持久任务日志
- run logs、idea notes、paper notes、variants 和 sweeps

## 要学习什么

- harness 才是产品，而不只是 benchmark。
- 基于文件的持久性很重要，因为 agent 会丢上下文。
- 公开 scratchpad 是强信任信号和学习信号。
- 循环应保存证据，而不只是结果。

## AutoResearch-AI 应如何不同

- 保持更小、更容易安装。
- 面向 repo onboarding，而不只是 benchmark run。
- 把 setup 测试做成一等命令路径。
- 让开源 npm 包容易 fork。
