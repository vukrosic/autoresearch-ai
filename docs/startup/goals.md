# 产品目标

这个文件定义 AutoResearch-AI 作为完整自主 AI 研究循环运行时应该做什么。

## Mission

帮助 AI agent 把真实机器学习仓库变成有纪律的研究循环，可以：

- 理解当前机器和仓库
- 建立并保护 baseline
- 生成有依据的研究想法
- 选择最便宜且有用的实验
- 记录证据
- 对比结果
- 从普通失败中恢复
- 把成功想法提升为持久后续工作

## 核心目标

### 1. Baseline First

agent 不能盲目优化。

它应该：

- 检查 `.researchloop/baseline.md`
- 当缺失或不完整时创建或更新它
- 记录 artifact path、metric、command 或 config、冻结变量和限制
- 把 baseline 作为所有后续决策的起点

### 2. Baseline-Aware Topic Intake

当用户命名一个主题时，agent 不应直接跳到随机实验。

它应该：

- 检查 baseline 是否已存在
- 汇总已知内容和缺失内容
- 提供三种模式之一：
  - `propose`：给用户选择的有依据选项
  - `novel`：带理由、失败模式和 kill criteria 的真正不同假设
  - `autonomous`：agent 在批准后运行循环

### 3. Paper-Grounded Research

论文搜索应该加强循环，而不是主导循环。

它应该：

- 当主题宽泛或需要文献依据时搜索论文
- 把论文转成结构化笔记
- 把论文连接到具体假设
- 优先选择有证据支持的想法，而不是通用 knob sweep

### 4. Cheap-to-Run Experiments

第一个实验应该是最便宜的有意义测试。

agent 应该：

- 除一个因果变化外冻结所有东西
- 先使用短运行
- 只有候选项通过剪枝或复现后才扩大搜索
- 为每个提议测试包含现实的时间范围

### 5. Failure Recovery

自主性应该能抵抗普通问题。

agent 应该能从这些问题中恢复：

- 缺失文件
- 错误路径
- 错误解释器或环境
- 空日志
- metric parsing failure
- 过期或不完整的 scratchpad 状态

失败发生时，agent 应记录失败，并移动到下一个可行步骤，而不是停止整个循环。

### 6. Evidence and Promotion

成功想法不应消失在聊天里。

循环应该：

- 记录每次 run
- 将 run 与 baseline 对比
- 在非平凡实验前写 idea notes
- 把成功配置、diff 或后续想法提升到持久文件

## Autonomous 是什么意思

Autonomous 不代表鲁莽。

在这个项目中，它意味着：

1. 先读取 repo 状态。
2. 尊重 baseline gate。
3. 有用时使用论文。
4. 提议或选择一个小的下一步。
5. 运行它。
6. 记录证据。
7. 决定复现、剪枝、细化或转向。

当用户想控制搜索时，仍然可以选择 `propose` 或 `novel`。

## 非目标

AutoResearch-AI 不试图成为：

- 通用文档聊天应用
- 完整 SciSpace clone
- dashboard-first 产品
- 跳过证据的神奇 optimizer

核心产品是研究循环。

## 成功标准

当用户可以做到以下事情时，产品表现良好：

- 安装它
- 指向一个仓库
- 看到 baseline 已记录
- 理解当前机器和仓库
- 得到几个有依据的想法
- 批准一个小实验
- 看到结果被记录和对比
- 在不丢上下文的情况下继续循环
