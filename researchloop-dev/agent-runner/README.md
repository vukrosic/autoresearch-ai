# agent-runner - autoresearch-ai contributors 的 orchestrator

选择一个带 `claim-next` label 的 issue，在 fresh git worktree 中启动 implementer agent（Codex 或 Claude Code），打开 draft PR，然后启动 reviewer agent（另一个工具）发布 verdict comment。Human 合并通过 review 的内容。

> Standalone extraction 正在进行中：独立的 `gitswarm` 项目现在位于 `/Users/vukrosic/my-life/gitswarm`，它是拆分 GitHub-issues dashboard 的路径。迁移期间这个本地副本保留在这里。

## 文件

- [`orchestrate.sh`](orchestrate.sh) - 唯一入口。Bash，约 200 行。
- [`prompts/implement.md`](prompts/implement.md) - implementer 的 system prompt。
- [`prompts/review.md`](prompts/review.md) - reviewer 的 system prompt（独立，不能带 implementer context）。
- `state/` - 每次运行的 logs、rendered prompts、reviewer verdicts。已 gitignored。

## 如何选择工作

```bash
gh issue list --label claim-next                  # the ready queue
  --jq '.[] | select(in-progress not in labels)'   # not already being worked
  | sort by issue number | head -1                 # lowest-numbered first
```

Maintainer 通过添加/移除 `claim-next` label 控制队列。`needs-validation` 是硬性跳过，speculative proposals 不进入队列。

## 运行模式

```bash
# Pick lowest claim-next, full loop (implement → push → draft PR → review):
./orchestrate.sh

# Specific issue:
./orchestrate.sh 65

# Re-run reviewer on an existing PR:
./orchestrate.sh --review 68

# Dry run (prints what it would do; spawns no agent):
DRY_RUN=1 ./orchestrate.sh 65
```

## Agent 选择

默认：**Codex implement，Claude review。** 不同模型，不同盲点。

用环境变量交换：

```bash
IMPLEMENTER=claude REVIEWER=codex ./orchestrate.sh 65
```

CLI binaries 必须已安装并认证。用下面命令验证：

```bash
codex --version    # adjust CODEX_BIN if installed elsewhere
claude --version   # adjust CLAUDE_BIN
```

> **Flags 注意事项：** `codex exec "<prompt>"` 和 `claude -p "<prompt>"` 是这里使用的非交互入口。第一次真实运行前，请根据你安装的版本验证准确语法，这些 flags 可能在 CLI release 之间变化。

## Orchestrator 捕获的 failure modes

1. **Implementer escalation：** agent 写入 `BLOCKED.md` 或 `OBJECTION.md` → orchestrator 发布带 worktree path 的 issue comment 并停止。Human 接管。
2. **Uncommitted changes：** orchestrator 用 “safety net” message commit，而不是丢弃。
3. **No commits：** 如果 agent 完成但没有产生 commits，不打开 PR。
4. **Worktree collision：** orchestrator 拒绝覆盖已有 worktree。

## Reviewer 捕获的 failure modes

1. **Acceptance theater** - 勾选了 checkbox，但 diff 不满足它们。
2. **Demo theater** - PR demo 是 synthetic 1-line ledger，而不是真实 workflow。
3. **Scope creep** - 修改了 issue 的 “Files” 列表之外的文件。
4. **Anti-feature violations** - agent 悄悄扩展到 issue 允许范围之外。
5. **>500 LOC** - 无论正确与否，自动标记给 human review。

Reviewer 的 verdict 会作为结构化 PR comment 发回。Human 只需要读约三分之一 PR（approve 的那些），不用读所有 PR。

## State / observability

每次运行都会在 `state/` 下留下文件：

- `prompt-<issue>.md` - rendered implementer prompt（用于 replay / debugging）
- `implementer-<issue>.log` - 完整 implementer stdout/stderr
- `review-prompt-<pr>.md` - rendered reviewer prompt
- `review-<pr>.md` - reviewer 最终 comment（也发布到 GitHub）

`state/` 已 gitignored，仅本地使用。

## 成本和安全

- 每个 loop 运行**一个** implementer + **一个** reviewer。根据 agent / model / iteration count，估算每个 issue 约 $1-5。
- 硬超时：每次 spawn `AGENT_TIMEOUT=1800`（30 分钟）。谨慎首次运行时可设更低。
- Worktrees 位于 repo root 下的 `.agent-worktrees/`，已 gitignored，易于清理。
- orchestrator 不会自动 merge PR。每个 change 都需要 human merge。

## 这不是什么

- 不是 multi-issue parallel runner（还不是，先把 single-issue 做对）。
- 不是 cron daemon（还不是，prompts 调好前保持 human-triggered）。
- 不是 model gateway。它直接与本地 Codex / Claude CLIs 通信。
- 不是 keystone goals（G04 等）上的 human review 替代品。

## Roadmap

当 single-issue loop 在 3+ 个真实 PR 上可信后：

1. 添加 parallel mode（一次处理 N 个 claim-next issues）。
2. 添加 “improve” loop：如果 reviewer request-changes，用 review comment 作为额外上下文重新启动 implementer。
3. 在用 cron 自动化前，添加 budget cap（max-spawns-per-day、max-cost-per-day）。
4. 把 agent execution 从 laptop 迁到小 VPS 或 GitHub Actions。
