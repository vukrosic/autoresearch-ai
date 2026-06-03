# 研究笔记

这个文件夹跟踪 AutoResearch-AI 背后的真实研究和产品证据。

规则很简单：没有 run、用户对话或具体 artifact，就不做声明。

## 当前本地测试台

主要本地测试仓库：

`/Users/vukrosic/my-life/research-repos/llm-research-kit`

MacBook 当前角色：

- 测试 harness
- 检查仓库
- 生成 prompts
- 运行很小的 smoke training loops
- 验证 Mac/MPS 兼容性
- 准备之后可在 NVIDIA 上运行的实验

MacBook 不是主要严肃训练机器。它是快速 reality-check 机器。

## 产品研究问题

- 这个包能否让用户在 2 分钟内从安装到第一个有用 prompt？
- 代码 agent 能否使用 harness 且不丢失目标？
- run ledger 是否让结果更可信？
- 真实用户会首先请求哪些 adapter？
- 哪个最小命令会让这个包感觉活起来？

## 实验

见 `experiments/`。
