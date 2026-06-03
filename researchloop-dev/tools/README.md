# 本地开发工具

用于运行 AutoResearch-AI 开发实验的 local-only helper scripts。这些不是已发布 npm 包的一部分；它们位于 `researchloop-dev/`，只随 git repo 分发。

## `codex-swarm.sh`

在 macOS 上打开一组 `Terminal.app` 窗口，每个窗口运行 [Codex CLI](https://github.com/openai/codex)。用它并行展开多个 agent session，例如六个 contributor 分别处理 [GOALS.md](../../GOALS.md) 中不同的 `G##` 目标，或一个 orchestrator + 五个 workers。

### 要求

- macOS（使用 AppleScript + Terminal.app）
- `PATH` 中有 `codex` CLI（`npm install -g @openai/codex` 或等价方式）
- 第一次运行会请求一次**自动化权限**来控制 Terminal，请在 *System Settings -> Privacy & Security -> Automation* 中批准后重新运行。

### 用法

```bash
./researchloop-dev/tools/codex-swarm.sh                              # 3x2 grid (6 codex windows)
./researchloop-dev/tools/codex-swarm.sh --cols 2 --rows 2            # 2x2 grid (4 windows)
./researchloop-dev/tools/codex-swarm.sh --cmd "codex --resume"       # different command
./researchloop-dev/tools/codex-swarm.sh --cwd /path/to/repo          # start each window in a working dir
./researchloop-dev/tools/codex-swarm.sh --bottom-pad 120             # leave more room for the dock
```

### 选项

| Flag | Default | Purpose |
| --- | --- | --- |
| `--cols N` | `3` | grid 中的列数 |
| `--rows M` | `2` | grid 中的行数 |
| `--cmd "STR"` | `codex` | 每个窗口中运行的命令 |
| `--cwd /path` | (none) | 每个窗口的 working directory |
| `--bottom-pad N` | `80` | 底部为 dock 保留的像素 |
| `-h`, `--help` | - | 显示 inline help |

### 备注

- 如果 Terminal.app 之前没有运行，除了 grid 外，可能会出现一个额外空窗口。手动关闭它，或先打开一个 Terminal 窗口再运行脚本。
- Window bounds 只使用主显示器。尚未实现 multi-monitor support。
- 每个窗口都是独立 Terminal session，关闭一个不会影响其他窗口。

### 建议模式

**并行目标工作。** 打开 6 个窗口，每个在自己的 checkout 或 worktree 中：

```bash
for i in 1 2 3 4 5 6; do
  git worktree add ../autoresearch-ai-wt-$i HEAD
done
./researchloop-dev/tools/codex-swarm.sh --cwd "$(pwd)/../autoresearch-ai-wt-1"  # then tell each agent which goal
```

**Orchestrator + workers。** 一个窗口作为 orchestrator，其余作为 worker agents，从 `.researchloop/team/` 读取共享状态。

**Timed sprints。** 与 [timed research sprint module](../experiments/protocols/timed-research-sprint-module.md) 结合使用，每个窗口针对不同 `change_label` 运行自己的 5-minute / 5-second probe sprint。

### Roadmap

这些扩展尚未构建。如果你需要，请打开 issue：

- `--prompt-file path`，让每个窗口以不同 role prompt 启动（researcher / coder / planner）
- `--worktree-from /path`，自动创建目标 repo 的 N 个 disposable git worktrees
- Linux support（xterm / gnome-terminal / kitty）
- tmux-backed variant，让 parent agent 在启动后可以 `send-keys` 到指定窗口
