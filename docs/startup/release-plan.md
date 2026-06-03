# Release Plan

AutoResearch-AI 应该像一个活的开发者工具一样发布，而不是一次性 launch。

发布节奏应该小而频繁：只要有真实改进，就每隔几天发布一次；不要只为了仪式感发布。

## 发布什么

每次 release 应该交付以下一项或多项：

- 更好的 onboarding
- 更清晰的 prompt
- 更强的 adapter
- 更有用的 dashboard
- 更好的 experiment command
- 更可信的 test 或 log
- 在 `llm-research-kit` 上的真实 benchmark 或 proof

不要发布模糊的 “startup progress”。发布具体、用户可见的变化。

## 发布节奏

使用轻量节奏：

- `0.1.x` 用于第一个公开循环
- 当包快速变化时使用 `0.1.1-beta.1` 这样的 prerelease
- 当循环和测试稳定时发布完整 patch release

目标是让 shipping 变成常态。小 release 会建立信任，因为用户能看到动量。

## GitHub Setup

GitHub repo 应该简单公开：

- 默认 branch protected
- pull request 要求 CI
- bug、adapter request 和 user feedback 的 issue templates
- `release`、`adapter`、`onboarding`、`docs`、`bug`、`good first issue` labels
- 启用 release drafts
- 仓库内有 changelog 或 release note 文件

repo 应该让外部用户理解产品：

- 一个 README
- 一个 getting-started guide
- 一个 roadmap
- 一个放 startup notes 的地方
- 一个放 competitor notes 的地方
- 一个放 release notes 的地方

## Release Process

1. 选择一个用户可见改进。
2. 在干净临时仓库中本地验证它。
3. 确认 `npm test` 绿色，且 `npm run test:packed` 成功。
4. bump 版本。
5. 写一条短 release note，包含：
   - 变了什么
   - 为什么重要
   - 测试了什么
   - 任何限制
6. 在 GitHub 上打 tag。
7. 发布 npm 包。
8. 在 X 上发布 release。
9. 邀请一两个用户试用新循环。

## Pre-Publish Checklist

每次 release 都运行这份字面 checklist。把每个框勾在 release PR 描述里。

```text
[ ] git status clean, on main, up to date with origin
[ ] CHANGELOG "Unreleased" promoted to the new version with concrete entries
[ ] ROADMAP "Done (X.Y.Z)" updated; "Next" still accurate
[ ] package.json version bumped
[ ] npm test passes locally (all fast tests green)
[ ] npm run test:packed passes (tarball installs and boots from an isolated prefix)
[ ] npm pack --dry-run: file count looks right, no researchloop-dev/, no scripts/, no docs/competitors/, no docs/startup/
[ ] autoresearch --version prints the new version (from the packed tarball, not just the linked checkout)
[ ] README install/quickstart copy-pasted into a fresh shell still works end-to-end
[ ] docs/site/index.html mentions the new headline feature, if any
[ ] One LLM-driven onboarding scenario run against the packed tarball; transcript saved in researchloop-dev/transcripts/
[ ] CI green on the release commit (Node 18 / 20 / 22 on ubuntu + macos)
[ ] git tag vX.Y.Z, git push --follow-tags
[ ] npm publish
[ ] post-publish: install from npm in a fresh shell (npm install -g autoresearch-ai), run autoresearch --version and autoresearch --help
[ ] GitHub release draft published with the CHANGELOG entry
```

“LLM-driven onboarding scenario” 使用 `researchloop-dev/skills/researchloop-onboarding-tester/SKILL.md`。它慢且容易波动，所以不属于 CI。它属于 release gate。

## Regression Gate

三层，从小到大：

1. **`npm test`** 运行 `scripts/test-*.sh` 中每个快速脚本。每个 PR 都必须保持绿色。CI 会在 ubuntu + macos 上用 Node 18 / 20 / 22 强制执行。
2. **`npm run test:packed`** 打包 tarball，安装到隔离 npm prefix，并端到端运行 harness。它会抓住 `files:` whitelist drift 和 linked-checkout 路径会静默掩盖的 ESM resolution 问题。
3. **LLM onboarding scenario**（手动）- 干净 lab 文件夹中的新 agent 对 packed tarball 运行已发布 onboarding prompt。把 transcript 和短 summary 保存到 `researchloop-dev/transcripts/` 和 `researchloop-dev/summaries/`。这会抓住文件测试看不到的行为回归（prompt drift、缺失 target-selection question、sweep-first 默认行为）。

如果发现 regression，先为它写 failing test，再修复。

## Release Note Style

保持 release notes 简短具体。

好的 release notes 会提到：

- feature name
- 它解决的用户问题
- 它改进的确切命令或 workflow
- 支撑它的 test 或 proof

糟糕 release notes 只谈 “vision”，但不展示用户可见变化。

## Launch Sequence

第一次 launch 应该是：

1. `autoresearch-ai` 的公开 GitHub repo
2. 第一次 npm publish
3. 简短 demo video 或 screen recording
4. X post 宣布这个循环
5. 给博士生或实验室用户发 3 到 5 条 direct messages
6. 公开请求一次 feedback

包发布并不代表 launch 结束。有人尝试这个循环并给出有用反馈，才算结束。

## 下一步改进什么

下一步改进应该枯燥且实用：

- 更好的 first-run onboarding
- 更明显的 `autoresearch goal`
- 如果用户真正需要，再加一个 adapter
- 更好的 `autoresearch compare` 输出
- 更丰富的 dashboard view
- 更清晰的 `autoresearch idea` 流程：从 repo history 和 chat 开始，然后建议真实研究想法，而不是默认 sweep

launch 后的第一个 release 应专注移除前 10 分钟的摩擦。
