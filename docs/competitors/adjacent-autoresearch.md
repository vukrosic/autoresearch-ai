# 相邻 AutoResearch 项目

这些项目有参考价值，因为它们展示了打包同一底层想法的多种方式：给 agent 一个目标、一个指标、一个循环和一个记忆文件。

## 值得关注的项目

- `pi-autoresearch` - 带工具、widget 和 JSONL ledger 的自主实验循环。
- `autoresearch-skill` - skill-first 循环，其中 `research.md` 就是程序。
- `autoresearch-agents` - eval-driven 自主 agent 优化 setup。
- `autoresearch-claude-code` - 适配 Claude Code 风格的循环移植版。
- `autoresearch-mlx` - 面向 Mac 用户的 Apple Silicon / MLX 适配。

## 要学习什么

- 循环应能跨重启和上下文 reset 存活。
- 普通文件是 agent 的强接口。
- skill 或 prompt 应能快速创建 ready-to-run 的 setup。
- AutoResearch 循环可以面向很多领域，不只 ML 训练。

## AutoResearch-AI 应保留什么

- `AGENTS.md`
- `goal.md`
- `plan.md`
- `THREAD.md`
- `runs.jsonl`
- idea notes 和 experiment records

## AutoResearch-AI 应增加什么

- 更顺滑的 npm 安装路径
- 明确的 setup 测试
- 面向博士生和实验室的更强 onboarding
