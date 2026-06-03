# AutoResearch-AI Hub

这个文件夹是 startup 的工作主基地。

规范组件：

- Site：`/Users/vukrosic/my-life/projects/research-loop-site/index.html`
- npm CLI：`/Users/vukrosic/my-life/projects/researchloop-cli`
- Mac-safe model repo：`/Users/vukrosic/my-life/research-repos/llm-research-kit`
- Reference archive：`/Users/vukrosic/my-life/research-repos/experiments-autonomous-speedrunning`

当前状态：

- site 通过 localhost 提供服务。
- `autoresearch` CLI 可以初始化 harness、检查仓库、打印 agent prompt、运行 doctor 检查，并汇总 run ledger。
- `llm-research-kit` 中的 MacBook-safe runtime branch 可以在 MPS 上运行一个很小的 smoke training loop。

仍然重要的事情：

- 保持产品窄：安装 research harness，然后让 Codex / Claude Code / Hermes 驱动实验。
- 让 startup 基于真实用户工作流，而不是抽象 AI 工具。
- 保持 Mac 路径可用，即使更大的训练以后放到 NVIDIA 上。

## E2E 测试状态

已在这台机器上端到端验证：

1. `autoresearch init --agent codex`
2. `autoresearch inspect`
3. `autoresearch prompt --agent codex --goal "improve validation loss"`
4. `autoresearch doctor --python /Users/vukrosic/miniconda3/bin/python3`
5. `autoresearch report`

CLI 创建了 harness 文件，在空仓库中检测到 generic adapter，打印出可用 prompt，并确认本地 Python / torch / MPS 支持。

`http://localhost:8000/projects/research-loop-site/index.html` 上的 landing page 也能提供当前 startup 文案。

## 用户触点计划

目标：与博士生、实验室和早期客户保持定期联系，让产品反映真实研究痛点。

节奏：

- 每周：向活跃 tester 或感兴趣的研究员发送 3 条短 check-in。
- 每两周：做 1 次 live demo 或 office-hour 风格通话。
- 每月：向博士生或实验室用户请求 1 次 repo walkthrough。

要问的问题：

- 你正在尝试改进哪个仓库？
- baseline metric 是什么？
- 好的第一周应该是什么样？
- 今天工作流中最烦人的部分是什么：setup、实验设计、日志、对比，还是 follow-up？
- 你会使用一个帮你写入 harness 和 prompt 文件的 CLI 吗？

渠道：

- Email 用于直接 follow-up。
- Short demo calls 面向实验室和认真用户。
- repo 或 CLI 输出里的小反馈说明用于快速反应。
- 产品准备好后，在站点上放一个简单 waitlist 或 beta form。

要观察什么：

- 首次 setup 节省的时间。
- harness 是否能撑过一次完整实验循环。
- 用户是否会在无人追问时回来做第二次 run。
- 他们是否希望把 prompt 文件复制到自己的仓库。

下一条 proof：

- 在一个真实小仓库上运行 AutoResearch-AI，并记录第一个有用的实验想法。
