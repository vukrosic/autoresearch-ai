# Rename Critique

这是对我们从 ResearchLoop 迁移到 AutoResearch-AI 过程中做得不好的地方的直接批评。

## 我们没有做好什么

### 1. 我们先改了包名，却没有先改完整体验

npm 包变成了 `autoresearch-ai`，但其余表面太长时间都保留混合名称。

这造成了 split-brain 产品：

- 用户安装 `autoresearch-ai`
- 一些 docs 和 scripts 仍指向旧 repo home
- 生成的 prompts 和 helper names 仍混用 `ResearchLoop` 和 `AutoResearch-AI`
- skills 和一些本地 control-room 文件保留旧名
- state folder 仍是 `.researchloop/`

这会让新用户困惑。安装后的第一个命令应该感觉像刚刚安装的是同一个产品。

### 2. 我们把命名当作文案，而不是架构

名称出现在：

- npm package metadata
- CLI binary names
- generated help text
- docs
- prompt templates
- tests
- skill names
- generated state folders
- dashboard copy
- release docs

我们更新了一些可见文档，但没有更新底层命令表面。这让 rename 感觉只是表面修饰。

### 3. 我们让 first-run prompt 太久都过度关注包本身

早期 onboarding 让 agents 总结包和 prompts，而不是和用户谈他们的系统、repo、GPU 和 baseline。

当前 first-contact prompt 已经好很多，但命名不一致仍会把产品内部细节泄漏到用户体验里。

### 4. 我们没有早早定义兼容策略

如果突然改名，重命名 CLI 就是破坏性变更。

我们本该决定：

- 首选新命令
- legacy alias 持续多久
- `.researchloop/` 是稳定数据格式还是 legacy folder
- skills 保留旧名还是用 alias 改新名
- 哪些 docs 展示新命令，哪些提到兼容性

没有这个计划，每次 rename 都有破坏现有用户或测试的风险。

### 5. 我们在太多表面重复了 Agent 指令

同一行为同时存在于 prompts、生成的 `AGENTS.md`、skills、docs 和 tests 中。

这让每次行为变化都昂贵且容易遗漏。
规范 prompt 文件有帮助，但 skill 和 docs 表面仍需要更严格的 ownership。

### 6. 我们让内部名称泄漏到公开营销中

`ResearchLoop` 描述机制。
`AutoResearch-AI` 描述承诺。

公开体验应该以承诺开头：

- automated AI research
- baseline-first research
- paper-grounded hypotheses
- autonomous experiment loops

旧名可以保留在兼容说明、历史 changelog 条目或 `.researchloop/` 文件夹里，直到我们安全迁移。

## 建议

分层执行 rename。

### Layer 1：公开命令重命名

把 `autoresearch` 作为首选 CLI 命令发布。

保留这些 alias：

- `autoresearch-ai`
- `researchloop`

文档应展示 `autoresearch`。
兼容说明可以说 `researchloop` 仍然可用。

### Layer 2：面向用户文案

在这些地方使用 `AutoResearch-AI`：

- README
- getting started
- site copy
- generated help
- first-contact prompts
- topic-intake prompts
- generated agent instructions

除了解释 legacy compatibility，不要说 ResearchLoop。

### Layer 3：State Folder 决策

暂时保留 `.researchloop/`。

原因：改变 state folder 会破坏现有仓库和大量测试。
在实现迁移路径前，把它当作稳定本地数据目录。

之后的选项：

- 永久保留 `.researchloop/` 作为数据格式
- 新仓库支持 `.autoresearch/`，并把 `.researchloop/` 作为 legacy 读取
- 如果 folder rename 值得做，添加 `autoresearch migrate-state`

### Layer 4：Skill 重命名

只有在 CLI rename 稳定后再重命名 skill packs。

可能目标是：

- `skills/autoresearch-ai/`
- 类似 `autoresearch-baseline-first` 的 skill names

在用户有迁移路径前，保留旧 skill names 或 shims。

## 未来 Rename 工作规则

任何 rename 都必须一起更新：

- package metadata
- binary names
- help text
- README
- getting started
- prompt templates
- generated agent files
- tests
- packed-package check

如果某个表面故意不 rename，记录原因。
