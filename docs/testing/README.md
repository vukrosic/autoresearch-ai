# 测试

这个文件夹定义 AutoResearch-AI 的 setup 和 onboarding 测试。

目标是证明新用户可以：

1. 安装包
2. 初始化 harness
3. 检查仓库
4. 生成 prompt
5. 检查环境
6. 记录一次 run
7. 生成报告

## 测试类型

- `setup` - 空仓库 install/init 流程
- `fixture` - 带 `train.py` 的最小 ML 仓库形态
- `llm-kit` - 真实本地 `llm-research-kit` adapter 和 MPS sanity check

## 命令

- `npm run smoke`
- `npm run smoke:e2e`
- `npm run test:setup`
- `npm run test:prompts`
- `npm run test:site`

## 测量什么

- 包是否安装成功？
- harness 文件是否创建？
- repo inspection 是否识别正确 adapter？
- prompt 是否提到真实 goal？
- ledger 是否接受结构化记录？
- report 是否正确汇总 run？
