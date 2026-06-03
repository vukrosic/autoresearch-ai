# Prompt 模板测试计划

目的：

确保生成的 prompt 保持干净，并且 focus overlay 仍然可用。

## 命令

```bash
npm run test:prompts
```

## 检查项

- `autoresearch` prompt 包含 goal 和持久工作记忆指令。
- prompt 包含 repo-memory 和 experiment-history 指令。
- prompt 包含现实的 time-band 指导。
- 当缺少时间预算时，prompt 恰好包含一个前置 time-budget 问题。
- prompt 包含 target-selection fallback 文案。
- focus overlay 仍然能干净追加。
- training-ladder 模式可作为 focus overlay 使用。
- 没有 prompt 包含原始 `{{GOAL}}` placeholder。

## 为什么重要

Prompt drift 是一种会悄悄破坏产品、但不一定破坏 CLI 的 bug。这个测试让打包保持诚实。
