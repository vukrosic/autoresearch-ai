# Weights & Biases

来源：

- [W&B runs docs](https://docs.wandb.ai/guides/runs/)
- [W&B experiments docs](https://docs.wandb.ai/guides/track/)

## 它们做什么

W&B 把一次 run 作为计算单元，并给团队提供记录 metrics、configs、artifacts、sweeps 和 reports 的地方。

## 要学习什么

- 单个 run object 是清晰的心智模型。
- Metrics 加 artifacts 是正确的默认数据形态。
- 当 baseline 循环存在后，sweeps 和 reports 很重要。
- 本地循环工作后，团队可见性会变重要。

## AutoResearch-AI 有何不同

- AutoResearch-AI 应该更像 harness，而不是 dashboard。
- 它应产生日志，之后可以导出到 W&B 或类似工具。
- 第一个产品应该不需要托管 backend 就能工作。
