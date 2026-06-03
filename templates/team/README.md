# AutoResearch-AI 开发团队

当你想把 AutoResearch-AI 工作拆给多个 agent，同时不丢失 merge 叙事时，使用这个包。

## 角色

- human：release direction 和最终 merge gate
- orchestrator：拆解和分配
- reviewer：merge safety 和 test gate
- workers：每人一条 lane

## 流程

1. human 设置 release goal。
2. orchestrator 读取 board 并分配不重叠 lanes。
3. 每个 worker 获得一个 branch 或 worktree。
4. reviewer 在 merge 前检查 diffs、tests 和 overlap。
5. human 合并被接受的 branches。

## 命令

```bash
autoresearch team --workers 8
autoresearch goal "ship the next AutoResearch-AI release"
autoresearch inspect
autoresearch prompt --agent codex
```

## Board

先打开 `board.md`。它是快速地图，说明谁负责什么。

如果想一次性创建 branches 和 worktrees，运行 `setup.sh`。
