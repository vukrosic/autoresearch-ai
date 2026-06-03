# AutoResearch-AI Dev Control Room

这个文件夹只用于本地。

它是在不把这些资产混入已发布 npm 包的情况下，用于开发、部署和测试 AutoResearch-AI 的 control room。

## 这里应该放什么

- AutoResearch-AI 应如何部署和测试的规则
- fresh onboarding agents 使用的 prompts
- 用于监督 onboarding 和 first-experiment runs 的 skills
- install、setup、dashboard 和 first-run 行为测试
- bounded autonomous research runs 的 experiment protocols
- 空仓库和样例仓库 fixtures
- 当前本地 build 的 pack/install deploy helpers
- 模拟用户运行产生的 transcripts 和 summaries

## 为什么存在

已发布的 `autoresearch-ai` 包应该保持精简。
这个文件夹承载其外围额外 harness。

## 结构

```text
researchloop-dev/
  rules/
  prompts/
  skills/
  tests/
  experiments/
  fixtures/
  deploy/
  transcripts/
  summaries/
```

## 主流程

1. 打包当前本地 AutoResearch-AI checkout。
2. 把 tarball 安装进隔离测试环境。
3. 在干净 lab folder 中启动 fresh agent。
4. 只给它 onboarding prompt。
5. 把 transcript 和简短 summary 保存到这里。

## 快速命令

打包当前 build：

```bash
./deploy/pack-current-build.sh
```

创建干净 lab folder：

```bash
./deploy/create-lab.sh
```

## Agent prompt

默认 first prompt 存在 [`prompts/onboarding.md`](./prompts/onboarding.md)。
