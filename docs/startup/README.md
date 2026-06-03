# Startup 操作系统

AutoResearch-AI 是一个开源产品，围绕它有一套 startup motion。

核心想法：

研究人员已经有仓库、模型、prompt、eval 和目标。他们需要一个可靠的自主研究循环，让 agent 可以遵循它，同时不丢失研究纪律。

## 服务对象

- 需要更快消融和更干净日志的博士生。
- 需要在多个仓库中重复研究循环的 AI 实验室。
- 优化 prompt、model、eval、agent 或 fine-tuning pipeline 的公司。
- 想要 agent 帮助、但不想放弃可复现性的独立研究员。

## 这里的 Startup 是什么意思

Startup 工作指围绕开源工具构建一个可重复引擎：

- 识别痛苦的研究工作流
- 每周和真实用户交流
- 把反复出现的痛点变成产品功能
- 保持核心 npm 包开源
- 未来再为 hosting、team、support、private templates、GPU orchestration 或 managed research runs 收费

## 每周节奏

- 周一：选择一个 product proof 和一个 user-learning goal。
- 周二到周四：构建、测试，并和用户交流。
- 周五：写一条简短公开更新，并总结用户教会我们的东西。
- 周末：可选 demo 打磨；除非有真实证据，否则不做大的战略转向。

## 关键指标

- 从安装到第一个有用 prompt 的时间。
- 从安装到第一次记录实验的时间。
- 运行第二个实验的用户数。
- 分享自己 repo workflow 的用户数。
- 来自实验室或学生的真实 adapter 请求数。

## 文件夹

```text
users/              博士生、实验室、公司、访谈、反馈
goals.md            自主研究循环的清晰产品目标
development-goals.md 具体工具目标和并行实现工作线
open-source.md      开源原则和商业化边界
agent-ops.md        构建 AutoResearch-AI 的多 agent 操作模型
positioning.md      我们如何描述产品是什么、不是什么
pricing.md          未来付费层，不是第一个切入点
risks.md            失败模式和应对措施
release-plan.md     如何发布、上线和传播 release
x-launch-draft.md   X 发布文案草稿
```
