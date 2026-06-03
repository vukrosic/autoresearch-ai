# 竞品和相邻项目

这个文件夹跟踪自主 AI 研究、prompt/eval 工具和 agent harness 周边格局。

重点不是盲目复制它们，而是理解工作流中哪些部分已经被解决、哪些部分缺失，以及 AutoResearch-AI 应该在哪里保持更简单。

## 主要类别

- `prime-intellect.md` - 持久自主研究 harness 和 scratchpad 纪律。
- `promptfoo.md` - prompt/model/agent eval、red teaming、CI 和本地私有测试。
- `langsmith.md` - eval 类型、annotation queue、启发式检查，以及在线/离线测量。
- `wandb.md` - run tracking、artifact、sweep、report 和项目 dashboard。
- `openhands.md` - 更宽的 agent runtime、本地 GUI、SDK，以及 hosted/cloud 分层。
- `swe-agent.md` - issue-to-fix 代码 agent 和 benchmark-first 叙事。
- `adjacent-autoresearch.md` - 更广泛的 autoresearch 生态和 skill-first loop 工具。

## 我们学到什么

- 第一个产品保持为普通 CLI 加文件，而不是大型平台。
- 让 run 成为一等对象，并保持结构化。
- 同时支持本地实验，以及之后的托管协作。
- 让循环在文件中可见，方便 agent 在上下文丢失后恢复。
- 把 onboarding/test/setup 当作产品表面，而不只是内部便利。
