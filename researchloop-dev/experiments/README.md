# Experiment Protocols

这个文件夹保存 local-only ResearchLoop experiment protocols。

这些不是普通 install tests。它们描述我们希望 agent 安全执行的真实自主研究运行：bounded wall-clock sprints、可调 probe budgets、run ledgers、reset proofs 和 follow-up reports。

使用 `runs/` 存放每次执行产生的实际 ledger 和 markdown report。
每个 run 还应该写一个自包含 HTML report，带 loss 图。

当问题是下面这些时，使用这个文件夹：

- agent 能运行真实 research loop 吗？
- 它能保持 timestamps、metrics 和 decisions 清晰吗？
- 它能探索 code changes 而不污染目标 repo 吗？
- 它能在 run 后完整 reset workspace 吗？

Protocols：

- [LLM Research Kit optimizer sprint](./llm-research-kit-optimizer-sprint.md)

Modules：

- [Timed research sprint module](./protocols/timed-research-sprint-module.md)
- [Protocol index](./protocols/index.md)

Plans：

- [Repeatable research sprint plan](./repeatable-research-sprint-plan.md)
