# Deploy Helpers

这些 helpers 用于测试当前本地 AutoResearch-AI build。

## 推荐安装流程

1. 打包当前 `autoresearch-ai` checkout。
2. 把 tarball 安装到测试环境。
3. 在空 lab folder 中启动 fresh agent。
4. 使用来自 `../prompts/onboarding.md` 的 onboarding prompt。

Scripts：

- `./pack-current-build.sh`
- `./install-current-build.sh`
- `./create-lab.sh`

## 本地 build 路径

当你想测试最新当前改动时，使用 packed tarball。

## 为什么不发布这些

这些 scripts 和 notes 是本地部署工具，不是产品功能。
