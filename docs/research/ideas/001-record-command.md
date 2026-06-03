# Idea 001 - 添加 `autoresearch record`

状态：已在本地仓库发布。

## 假设

如果工具能追加结构化 run result，而不要求手动编辑 JSONL，用户会更信任它。

## 命令

```bash
autoresearch record \
  --id mac-e2e-002 \
  --status complete \
  --metric val_loss=4.4157 \
  --metric tokens_seen=128 \
  --note "Tiny Mac smoke loop"
```

## 为什么重要

harness 当前会创建 run ledger，但 recording 仍是手动的。一等命令会让循环更像产品，而不是 folder template。

## Kill Criteria

暂时不要构建大型 experiment runner。如果 `record` 变成完整 orchestration framework，停止并缩小范围。
