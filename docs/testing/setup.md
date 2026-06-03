# Setup 测试计划

## 场景 1 - 空仓库

创建临时空仓库并运行：

```bash
autoresearch init --agent codex
autoresearch inspect
autoresearch prompt --goal "improve validation loss"
autoresearch doctor
autoresearch record --id setup-001 --status complete --metric val_loss=1.23 --note "blank repo setup smoke"
autoresearch report
```

预期：

- harness 文件存在
- adapter 默认为 `generic`
- prompt 被输出
- doctor 打印本地环境
- record 追加到 `runs.jsonl`
- report 显示一个 run

## 场景 2 - 最小 ML Fixture

创建包含 `train.py`、`pyproject.toml` 和 log 文件夹的仓库，然后运行 `autoresearch inspect`。

预期：

- 检测到 `pytorch` adapter
- 列出 train 文件
- 检测到 config 文件

## 场景 3 - 真实本地 LLM 仓库

对 `/Users/vukrosic/my-life/research-repos/llm-research-kit` 运行相同流程。

预期：

- 检测到 `generic`、`pytorch`、`huggingface` 和 `llm-research-kit` adapter
- `doctor` 在这台 Mac 上确认 MPS
- 当需要真实产品 proof 时，可以运行一个很小的 synthetic training loop

## 为什么重要

startup 软件的第一个失败模式不是模型质量，而是 setup 摩擦。setup 测试应该保持足够快、足够简单，方便经常运行。
