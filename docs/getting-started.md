# AutoResearch-AI 入门指南

AutoResearch-AI 是一个开源 npm 包，帮助 AI agent 在机器学习仓库里运行有纪律的研究循环，在 npm 上以 `autoresearch-ai` 发布。

最短的理解方式：

- 安装 CLI
- 把它指向目标仓库或研究目录
- 它创建持久的 `.researchloop/` 工作区
- 你的 AI agent 使用这个工作区来规划、运行、对比和记录实验

如果目标仓库不明显，使用这条规则：

1. 如果当前文件夹是真实仓库，就使用它。
2. 如果当前文件夹为空或不是仓库，询问：“使用这个文件夹、让我指向一个 GitHub 仓库，还是启动一个 demo research repo？”
3. 如果用户有 GitHub URL，建议 clone 后在那里运行。
4. 如果用户有本地路径，就使用该路径。
5. 如果用户两者都没有，提供一次性 demo repo 或本地 `llm-research-kit` repo 作为低摩擦 fallback。

当仓库已有历史时，先读取 `.researchloop/scratchpad/runs.jsonl` 和 `.researchloop/scratchpad/THREAD.md`，再基于这些证据提出下一个实验，而不是默认直接做 sweep。
如果 `.researchloop/plan.md` 里还没有时间预算，先问一个问题：“你通常希望一次典型实验运行多久？”把答案保存到 `Time Budget`，并用它影响后续建议。

## 1. 给你的 Agent 使用的提示词

把下面内容复制到 Codex、Claude Code、Hermes、Cursor 或其他代码 agent 中：

```text
如果需要，安装 `autoresearch-ai` npm 包。你现在是一个自动化 AI 研究员，并遵循 AutoResearch-AI 的 first-contact 和 topic-intake 提示词。
阅读 AutoResearch-AI 文档和 `.researchloop/` 文件，然后帮我启动 AI 研究：检查本地系统的 GPU/加速器，检查工作区中可能的 AI 研究仓库，用简单语言解释我拥有什么，并检查 baseline 是否存在以及记录在哪里。
当我给出研究主题时，如果已有 baseline 就使用它；如果没有，先建议记录 `.researchloop/baseline.md`。然后提供 propose、novel 或 autonomous 模式。
除非我明确要求，不要总结包内部实现、tarball 内容、prompt 文件或 skill 文件。
在我批准计划之前，不要运行 init、training、baselines、sweeps 或 experiments。
使用包命令管理 goals、ideas、prompts、runs、comparisons 和 reports。
```

## 2. 安装

在你自己的机器上：

```bash
npm install -g autoresearch-ai
```

包名是 `autoresearch-ai`；主要 CLI 命令是 `autoresearch`，`researchloop` 保留为旧别名。

从本仓库做本地开发：

```bash
cd /Users/vukrosic/my-life/autoresearch-ai
npm link
autoresearch --help
```

如果你想把这件事交给 AI agent，最简单的指令是：

```text
安装 AutoResearch-AI，遵循 `templates/prompts/first-contact.md`，只读检查系统和项目，用简单语言解释我拥有什么，先检查 baseline 状态，然后提出计划。在任何 init、training、baseline、sweep 或 experiment 命令前等待我批准。
```

## 3. 初始化仓库

在空文件夹、已有 ML 仓库或目标研究目录中运行：

```bash
autoresearch init --agent codex
```

这会创建：

```text
.researchloop/
  AGENTS.md
  baseline.md
  goal.md
  plan.md
  repo-profile.json
  scratchpad/
    THREAD.md
    runs.jsonl
    memory.md
    ideas/
    papers/
    variants/
    sweeps/
```

如果需要另一个工具的 agent 专用文件，使用：

```bash
autoresearch init --agent claude-code
autoresearch init --agent hermes
autoresearch init --agent cursor
```

## 3b. 给出研究主题

当你说类似 “research query/key architectures” 的内容时，agent 应把它当作 topic intake。

它首先检查是否已有可用 baseline。如果 `.researchloop/baseline.md` 缺失或不完整，第一步建议应该是从现有 artifact 创建或更新这个 markdown 说明。在 baseline 明确前，不应该推荐 architecture、optimizer、sweep 或 training 改动。

baseline 明确后，从这些模式中选择一个：

```text
propose     agent 建议 2-4 个有依据的选项，并等待你选择
novel       agent 推理真正不同的假设及其失败模式
autonomous  agent 在明确批准和时间预算内运行循环
```

论文搜索是可选的。当主题较宽泛、仓库没有相关论文笔记，或某个提案需要文献依据时使用它。

## 4. 设置研究目标

告诉 AutoResearch-AI agent 应该优化什么：

```bash
autoresearch goal "lower validation loss"
```

也可以添加结构化信息：

```bash
autoresearch goal "lower validation loss" --metric val_loss --direction lower
```

这会把目标保存到 `.researchloop/goal.md`，供 agent 和 prompt 命令稍后读取。

## 5. 生成实验想法

```bash
autoresearch idea --write
```

它会打印一个聊天优先的 idea prompt：读取仓库历史，必要时询问典型实验时长，然后让 LLM 提出几个真实研究想法。对于 `llm-research-kit`，这通常意味着 baseline 检查、基于历史的后续实验，以及当仓库历史证明更长运行合理时使用分阶段训练阶梯。对于通用仓库，它会先找到 baseline 和真正要测试的机制。

## 6. 检查仓库

```bash
autoresearch inspect
```

这会把 repo profile 写入 `.researchloop/repo-profile.json`，帮助 agent 理解：

- 可能的训练文件
- 可能的 eval 文件
- 配置文件
- 日志文件夹
- 可能的 adapter

## 7. 生成 agent 提示词

```bash
autoresearch prompt --agent codex
```

把输出粘贴到你的 AI agent 中。

也可以附加一个聚焦 playbook：

```bash
autoresearch prompt --agent codex --focus hyperparameters
autoresearch prompt --agent codex --focus architecture
autoresearch prompt --agent codex --focus attention
autoresearch prompt --agent codex --focus training-ladder
```

这个提示词会要求 agent 先用简单语言解释检测到的系统上下文和仓库上下文，再请求批准运行任何内容。批准后，它要求 agent：

- 读取 `.researchloop/` 文件
- 建立 baseline
- 提出小实验
- 记录 run
- 对比结果
- 保持循环推进

## 7b. 使用 skill pack

npm 包还发布了可下载的 `skills/` 文件夹。

它以 agent-local skill 的形式包含同一套研究循环：

- `skills/researchloop-autoresearch/codex/SKILL.md`
- `skills/researchloop-autoresearch/claude-code/CLAUDE.md`
- `skills/researchloop-autoresearch/hermes/HERMES.md`
- `skills/researchloop-autoresearch/cursor/researchloop.mdc`
- `skills/researchloop-autoresearch/references/*.md`
- `skills/researchloop-training-ladder/SKILL.md`

当你希望 agent 自身携带研究规则，而不只是当前 prompt 时，使用这些文件。

典型流程：

1. 把 Codex 或 Claude Code 文件复制到你的 agent 使用的 skill 位置。
2. 把 `references/` 文件留在附近，作为可选 playbook。
3. 将 skill 与 `.researchloop/goal.md` 和 `autoresearch prompt` 输出配合使用。

仍然可以用 `--goal` 做一次性覆盖，但正常流程是保存一次 goal，并让 prompt 命令读取它。

如果希望 prompt 聚焦某一类实验，使用内置 focus playbook：

- `hyperparameters`
- `architecture`
- `attention`
- `training-ladder`

## 8. 记录和对比 run

run 结束后：

```bash
autoresearch record --id first-run --status complete --metric val_loss=2.31 --note "first logged experiment"
```

对比 run：

```bash
autoresearch compare --metric val_loss --direction lower
```

如果实验需要 NVIDIA GPU，命令行可加 `--device cuda`；需要固定卡号时再加 `--cuda-visible-devices 0`。dashboard 中对应的是 `CUDA / Python` 运行方式和 `CUDA 设备编号` 字段。

对于越高越好的指标：

```bash
autoresearch compare --metric accuracy --direction higher
```

然后汇总当前状态：

```bash
autoresearch report
```

生成可分享的实验记录 artifact：

```bash
autoresearch report --format markdown --out report.md --include-plots
```

这会从 run ledger 写出 `report.md` 和 `report-assets/` SVG 图表。在有 baseline 和几个候选 run 后，可以用它向导师、队友或未来会话发送紧凑更新。

分享报告前，审计数字声明：

```bash
autoresearch audit report.md
```

audit 会根据 `runs.jsonl` 检查 loss、accuracy、perplexity、F1 和命名指标声明。

## 9. 打开 dashboard

为当前仓库启动本地 dashboard：

```bash
autoresearch dashboard
```

然后打开它打印出的 localhost URL。dashboard 会读取仓库的 `.researchloop/` 文件并展示：

- 已保存的 goal
- run ledger
- 当前最佳 run
- 最新 run
- 主指标的小趋势图

它不需要账号或认证，因为只运行在你的机器上。

## 10. 为并行工作生成团队看板

如果你要开发 AutoResearch-AI 本身，或把任何仓库拆成并行工作线，生成本地团队看板：

```bash
autoresearch team --workers 8
```

这会写入 `.researchloop/team/`，其中包含：

- orchestrator brief
- reviewer brief
- 每条工作线一个 worker 文件
- 映射分支、文件和完成标准的 board

预期流程是：

1. Human 设置发布目标。
2. Orchestrator 分配工作线。
3. Workers 每人处理一个分支或 worktree。
4. Reviewer 在 merge 前检查 diff。
5. Human 合并有证据支持的分支。

## 11. 信任前先测试 setup

从本仓库运行本地检查：

```bash
npm test
```

这会聚合完整快速测试套件：`smoke`、`smoke:e2e`、`test:setup`、`test:compare`、`test:run`、`test:scan-papers`、`test:goal`、`test:idea`、`test:team`、`test:dashboard`、`test:prompts`、`test:focus-prompts`、`test:site` 和 `test:adapters`。

发布前，也运行 packed-tarball 安装检查：

```bash
npm run test:release
```

它会运行 `npm test` 加 `test:packed`：打包 npm tarball，安装到隔离 prefix，并端到端运行 harness。它能发现本地 link 测试会静默掩盖的 `files:` whitelist 回归。

## 12. 在真实 ML 仓库中使用

基础功能可用后，进入真实项目：

```bash
cd /path/to/your/ml-repo
autoresearch init --agent codex
autoresearch inspect
autoresearch prompt --agent codex --goal "improve validation loss"
```

然后把提示词交给你的 AI agent，让它运行循环。

AutoResearch-AI 不是试图替你神奇地解决模型问题。它给 agent 提供研究操作系统：目标、baseline、日志、对比和延续。

## 12. 发布到 npm

这个包发布到公共 npm registry：[npmjs.com](https://www.npmjs.com/)。

发布前：

```bash
npm login
npm whoami
npm pack --dry-run
```

确认包名可用且内容正确。

本仓库中，包名在 `package.json` 中是 `autoresearch-ai`。发布命令：

```bash
npm publish
```

如果之后切换到类似 `@yourname/autoresearch` 的 scoped package，发布命令是：

```bash
npm publish --access public
```

常见发布流程：

```bash
npm version patch
git push --follow-tags
npm publish
```

典型发布检查清单：

1. 运行本地测试
2. 检查 `npm pack --dry-run`
3. bump 版本
4. 发布到 npm
5. 如果用法变化，更新网站和 README

## 12. 用户从哪里安装

用户通过 npm registry 安装：

```bash
npm install -g autoresearch-ai
```

如果他们更喜欢在单个仓库内本地使用：

```bash
npm install autoresearch-ai
```

然后从该环境运行 CLI。

## 13. 给 AI agent 的一句话交接

如果你想给 Codex、Claude Code、Hermes、Cursor 或类似 agent 最短指令，使用这句：

```text
使用 AutoResearch-AI：安装或使用这个包，作为自动化 AI 研究员，并遵循 `templates/prompts/first-contact.md`。检查系统的 GPU/加速器，检查工作区中可能的 AI 研究仓库，用简单语言解释我拥有什么，并检查 baseline 是否存在以及记录在哪里。不要总结包内部实现或 prompt 文件。在我批准计划前，不要运行 init、baselines、training、sweeps 或 experiments。
```
