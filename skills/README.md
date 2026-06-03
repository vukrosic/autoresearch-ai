# AutoResearch-AI Skills

这个文件夹发布可下载的 agent skills，用于自主 AI 研究。

包把核心产品放在 CLI、dashboard、prompts 和 run ledger 中。
这些 skills 是 agent-side memory layer，让研究循环更稳地执行。

## 这里有什么

- `researchloop-autoresearch/` - 主 research skill pack
- `researchloop-autoresearch/references/` - 面向常见实验族的聚焦 playbooks
- `researchloop-autoresearch/*/SKILL.md` - 面向 search、ablation、training、research 和 ops 的聚焦 skills
- `researchloop-autoresearch/local-install/SKILL.md` - 给另一个 agent 的本地 npm tarball handoff 字符串和可选 smoke-test 命令
- `researchloop-training-ladder/` - 用于 pruning 和 promotion 的分阶段 small-to-long training 模式

## 用户如何使用

用户把合适文件复制到自己 agent 期望的 skill 文件夹。

典型映射：

- Codex：把 `researchloop-autoresearch/codex/SKILL.md` 复制到本地 Codex skills 目录
- Claude Code：把 `researchloop-autoresearch/claude-code/CLAUDE.md` 复制到 Claude Code instructions 或使用的 skill 位置
- Hermes：把 `researchloop-autoresearch/hermes/HERMES.md` 复制到 Hermes instructions 或使用的 skill 位置
- Cursor：把 `researchloop-autoresearch/cursor/researchloop.mdc` 复制到 `.cursor/rules/` 或使用的 Cursor rules 位置

## 分发方式

AutoResearch-AI 把核心循环保留在 npm 包中，skill pack 作为 portable agent-side copy 留在这里。

这意味着：

- 包不需要单独 skills repo 也能安装和运行
- 用户可以立即把文件复制到自己的 agent setup
- 如果 skill set 大到值得独立发布节奏，之后可以再做单独 skills registry 或 repo

目前，打包的 skills 是轻量路径。只有当你想要一个由社区维护、带独立 install/update 流程的 skill catalog 时，才把它拆出去。

## 聚焦 skill 家族

仓库现在包含面向以下方向的聚焦 skills：

- core loop setup
- repo inspection and adapters
- goal and metric definition
- time-budget planning
- run logging、compare 和 reporting
- hyperparameter and learning-rate search
- optimizer、schedule、batch-size、weight-decay 和 warmup search
- architecture、attention、depth-width、normalization 和 loss ablations
- data quality、data ablation、augmentation、evaluation、metric 和 generalization checks
- sweep management、pruning、reproducibility、checkpointing 和 failure analysis
- paper review、idea ranking、mechanism hypotheses、ablation planning 和 claim audits
- orchestration、review、handoff、release proof 和 onboarding/demo work
- local install、linked checkout testing 和 packed-tarball smoke checks

## Skill pack 做什么

- 保持 goal 可见
- 强制 baseline-first 行为
- 一次只请求一个小实验
- 记录 run 和 comparison
- 剪掉弱 idea，而不是失控扩散

CLI 会打印 prompts 并创建 `.researchloop/` state。
skills 让 agent 在执行工作时记住应该如何表现。
