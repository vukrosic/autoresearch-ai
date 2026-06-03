# AutoResearch-AI Agent Ops

这是使用多个 agent 构建 AutoResearch-AI 本身的操作模型。

目标不是扁平 swarm。
目标是一个保持清晰的小层级：

- human 拥有发布方向
- orchestrator 拥有拆解
- workers 拥有功能
- reviewer 拥有 merge 安全
- GitHub 拥有 branch 和 pull request 历史

## 为什么采用这个形态

当任务接触共享文件时，扁平 swarm 很快会变吵。

小层级让并行仍然有用：

- workers 保持窄范围
- branches 保持可 review
- merge 风险保持可见
- human 仍然控制 release

## 默认角色

### Human

- 决定 release target
- 选择发布什么
- 批准 merge
- 只有在有证据时才改变方向

### Orchestrator

- 把 release goal 拆成 lanes
- 每个 worker 分配一条 lane
- 保持 board 最新
- 尽可能避免文件重叠

### Worker

- 拥有一个 branch 或 worktree
- 只改分配的文件
- 记录 commands、results 和 failures
- 交回容易 review 的 diff

### Reviewer

- 检查 scope、tests 和 overlap
- 拒绝模糊或未验证的声明
- 决定 branch 是否 merge-ready

## AutoResearch-AI 建议 lanes

开发包本身时使用这些 lanes：

1. CLI and runtime
2. Dashboard and state API
3. Prompt packs and skills
4. Docs and onboarding
5. Tests and CI
6. Release and publishing
7. Competitor and user research
8. Public site and launch copy
9. Repo detection and adapters
10. Integration and merge safety
11. Examples and fixtures
12. Research logs and evidence

## 如何运行

1. 设置 goal。
2. 生成 team board。
3. 为每个 worker 创建一个 branch 或 worktree。
4. 让 orchestrator 分配 lanes。
5. merge 前 review 每个 diff。
6. 只 merge 有证据支持的 branches。

生成的 team pack 还包含 `setup.sh` helper，其中每条 lane 都有一个 `git worktree add -b ...` 命令。

## Branching rule

每个 worker 使用一个 branch，并让 branch name 绑定 lane。

示例：

```bash
codex/autoresearch-cli-runtime
codex/autoresearch-dashboard
codex/autoresearch-tests-ci
```

## Merge rule

不要同时把两个 agent merge 到同一个文件中，除非 reviewer 明确接管 integration step。

## 我们的实用规则

如果想要 10 个 agent 并行，不需要 10 个同等声音。

我们需要：

- 1 human
- 1 orchestrator
- 8 到 10 workers
- 1 reviewer

这足以快速推进，同时不丢失主线。
