# AutoResearch-AI 文档规则

你正在编辑 `docs/`。

## 范围

覆盖：

- `docs/getting-started.md`
- `docs/startup/`
- `docs/competitors/`
- `docs/testing/`
- `docs/research/`
- `docs/site/`

## 规则

1. 让文档与真实 CLI 行为保持一致。
2. 不要描述尚未实际发布的工作流。
3. 如果 CLI 支持某个 target 或 flag，展示准确拼写。
4. 如果文档改动反映了行为变化，也要更新相关 template 或 test。
5. 优先使用简短、实用的示例，而不是宽泛营销语言。
6. 保持 README、getting started 和 startup docs 中面向用户的说明一致。

## Review Checklist

- 文档是否匹配当前命令和文件路径？
- 是否清晰解释了第一个有用动作？
- 是否把核心产品行为和可选未来想法分开？
