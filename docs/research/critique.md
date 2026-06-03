# 批评

这是对今天 AutoResearch-AI 的诚实判断。

## 强项

- 论点是真实的：自主 AI 研究是实际工作流，不只是 buzzword。
- MacBook 路径已被足够证明，可以继续构建。
- CLI 形态简单且可移植。
- 开源边界让产品更容易被信任。

## 仍然薄弱的地方

- 网站更好了，但仍然更多是在解释产品，而不是证明一个用户可以立即运行的工作流。
- CLI 当前覆盖 setup、inspect、prompt、doctor、record 和 report，但还没有完整 experiment planner 或 compare workflow。
- setup 故事对本地 smoke test 很好，但还没有针对真实首次外部 repo 用户测试。
- 竞品情报有用，但如果不持续更新会漂移。
- 用户发现循环只停留在纸面上，还需要真实对话和笔记。

## 下一步改进

- 添加 `autoresearch idea` 或 `autoresearch compare`，让循环更像产品，而不是文件包。
- 为 `npm run test:setup`、`npm run test:prompts` 和 `npm run test:site` 添加 CI job。
- 把一个真实外部 repo onboarding 笔记写入 research log。
- 把一次用户对话转成可复用 onboarding example。
- 让 homepage 聚焦第一次成功运行，而不是宽泛叙事。

## 结论

AutoResearch-AI 有潜力，因为它有真实用例、真实 Mac 兼容 proof，以及简单开源形态。在它像一个持久 startup 之前，仍需要围绕实验循环做更多产品化，并从真实用户那里获得更多证明。
