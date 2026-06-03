# 风险

## 过于宽泛

风险：“Automated AI research” 变得太模糊。

应对：把第一个产品保持为面向代码 agent 的可安装 harness，而不是完整科学家。

## 没有真实用户

风险：围绕想象中的博士需求构建。

应对：每周对话、repo walkthrough，以及可见的 feedback logs。

## Agent 过度声称

风险：agent 在没有足够证据运行的情况下声称改进。

应对：在 harness 中放入规则：没有 run 不做声明，baseline first，胜利前先复现。

## 脆弱的 Repo 支持

风险：每个 ML repo 都不同。

应对：从 generic、PyTorch、Hugging Face 和 `llm-research-kit` 开始。只在真实需求后添加 adapter。

## 动机漂移

风险：在循环变成真实产品前频繁切换想法。

应对：使用 focus guard skill，并回到一个小 proof：install、inspect、prompt、run、log。
