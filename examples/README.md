# 示例

这里放的是面向真实仓库使用 AutoResearch-AI 的可复制示例。每个示例展示一个完整循环：

1. 安装
2. 初始化 harness
3. 检查目标仓库
4. 生成 agent prompt
5. 运行或记录一个实验
6. 报告结果

## 可用示例

| Example | Repo shape | 展示内容 |
|---|---|---|
| [llm-research-kit.md](llm-research-kit.md) | PyTorch + Hugging Face | 在 tiny LLM training repo 上的端到端循环：检测 adapter、运行 baseline、记录实验、对比。 |

## Fixtures

[fixtures/](fixtures/) 目录包含 `scripts/test-setup.sh` 和其他测试使用的最小合成仓库。它们不是面向用户的示例，而是用于让 CLI 在不依赖机器特定状态的情况下，针对空仓库、部分成型仓库和完整形态仓库做测试。

## 贡献新示例

示例是最有价值的贡献之一。它们同时会成为 reviewer 的参考、AI agent 的训练上下文，以及用户的 quickstart。

好的示例：

- 面向真实、公开可用的仓库（请链接）
- 展示从安装到第一次记录对比的完整循环
- 可复现：fresh clone 的用户应该得到同样形态的输出
- 不依赖特定 GPU 或付费 API
- 包含实际 `cat .researchloop/scratchpad/runs.jsonl` 输出，让读者看到记录内容

把你的示例作为新的 `.md` 文件加入本目录，并在上表增加一行。按照 [CONTRIBUTING.md](../CONTRIBUTING.md) 打开 PR。
