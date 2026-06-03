# Heat Lens

Heat Lens 是一个很小的本地 macOS app，用来回答一个简单问题：现在是什么在让我的 Mac 发热？

它展示：

- 当前 macOS thermal state
- CPU 消耗最高的进程
- 每行一个小提示，帮助你快速定位可能 culprit

重要限制：

- macOS 不公开可靠的 raw package temperature API。
- 这个 app 使用公开 thermal state 加 CPU 和 memory usage 作为最实用 proxy。

## Build

```bash
cd /Users/vukrosic/my-life/autoresearch-ai/researchloop-dev/mac-heat-lens
./build.sh
```

## Run

```bash
open .build/HeatLens.app
```

## 看什么

- `Nominal` 表示机器状态舒适。
- `Warm` 表示负载开始积累。
- `Hot` 表示某些东西可能在 CPU 上持续运行。
- `Critical` 表示 macOS 正强力尝试降温。

如果 thermal state 上升时看到 browser helper、chat helper 或 Codex/Claude worker 靠前，那个进程通常就是 Mac 发热的主要原因。
