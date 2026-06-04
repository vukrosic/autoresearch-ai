<p align="center">
  <img src="./assets/autoresearch-banner.webp" alt="AutoResearch-AI 横幅" width="100%" />
</p>

[![CI](https://github.com/vukrosic/autoresearch-ai/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vukrosic/autoresearch-ai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/autoresearch-ai.svg)](https://www.npmjs.com/package/autoresearch-ai)
[![npm downloads](https://img.shields.io/npm/dm/autoresearch-ai.svg)](https://www.npmjs.com/package/autoresearch-ai)
[![License: MIT](https://img.shields.io/npm/l/autoresearch-ai.svg)](./LICENSE)
[![Node version](https://img.shields.io/node/v/autoresearch-ai.svg)](https://nodejs.org)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#)

AutoResearch-AI 是一个用于自主 AI 研究工作流的开源 npm 包，在 npm 上以 `autoresearch-ai` 发布。

> **状态：alpha（pre-1.0）。** CLI 接口正在稳定，但小版本之间仍可能有破坏性变更。生产使用时请固定具体版本，升级前查看 [CHANGELOG.md](./CHANGELOG.md)。

如果需要完整的分步使用和发布指南，请阅读 [docs/getting-started.md](./docs/getting-started.md)。

它会把一个持久的研究工作台安装到机器学习仓库里，让 Codex、Claude Code、Hermes、Cursor 以及类似工具可以检查代码、提出实验、运行小型检查、记录结果，并在不丢失上下文的情况下继续循环。

## 给你的 Agent 使用的提示词

把下面内容复制到 Codex、Claude Code、Hermes、Cursor 或其他代码 agent 中：

```text
npm install -g autoresearch-ai。你现在是一个自动化 AI 研究员。这个包包含相关工具和提示词。遵循 `templates/prompts/first-contact.md` 和 `templates/prompts/topic-intake.md`：先只和我沟通，用简单语言解释我的系统/GPU/仓库，检查是否已有 baseline 以及记录在哪里，并在 init、training、baselines、sweeps 或 experiments 前等待我批准。当我给出研究主题时，如果已有 baseline 就使用它；如果没有，先建议记录 `.researchloop/baseline.md`。然后提供 propose、novel 或 autonomous 模式。
```

---

手动安装：

```bash
npm install -g autoresearch-ai
```

包名是 `autoresearch-ai`；主要 CLI 命令是 `autoresearch`，`researchloop` 保留为旧别名。

从当前 checkout 做本地开发：

```bash
git clone https://github.com/vukrosic/autoresearch-ai.git
cd autoresearch-ai
npm link
autoresearch --help
```

## 快速开始

```bash
autoresearch init --agent codex
autoresearch goal "lower validation loss" --metric val_loss --direction lower \
  --baseline "python train.py" --evaluation "python eval.py"
autoresearch inspect
autoresearch scan-papers --limit 10
autoresearch idea --write
autoresearch prompt --agent codex
autoresearch team --workers 8
autoresearch baseline
autoresearch run --id lr-3e-4 --command "python train.py --lr 3e-4"
autoresearch compare --metric val_loss --direction lower
autoresearch report
autoresearch dashboard
autoresearch doctor
```

然后把生成的提示词粘贴给代码 agent。第一次接触时，agent 应先用普通语言解释系统和仓库上下文，再请求批准运行任何内容。

## 科研面板一键启动

macOS 可以双击仓库内的中文启动脚本：

```bash
./启动AutoResearch面板.command
```

也可以使用英文脚本名：

```bash
./start-macos-dashboard.command
```

Windows 可以双击：

```cmd
start-windows-dashboard.cmd
```

两个脚本都会提示选择测试项目文件夹，并启动本地面板。面板第六个模块支持自动识别入口、参数库、参数组合队列、按本机资源自动推荐 `max_parallel`、稳定复测 Top K 参数组合、多进程并发运行和批量运行后的指标对比；指标曲线区支持海量实验的连续趋势线和 best-so-far 折线。完整中文操作说明见 [docs/dashboard-usage-zh.md](./docs/dashboard-usage-zh.md)。

## 它会创建什么

```text
.researchloop/
  AGENTS.md
  baseline.md
  goal.md
  plan.md
  repo-profile.json
  team/
  adapters/
  scratchpad/
    THREAD.md
    runs.jsonl
    memory.md
    ideas/
    papers/
    variants/
    sweeps/
```

这个包并不声称能神奇地训练任何模型。它给 agent 提供严肃研究所需的操作系统：约束、baseline 优先行为、实验日志、idea 文件和可复现实验报告。

## 研究主题

当你给 agent 一个类似 “query/key architectures” 的主题时，它不应该直接跳到训练想法。

预期流程是：

1. 检查是否已有可用 baseline，以及它记录在哪里。
2. 如果没有清晰的 baseline markdown 说明，先建议创建或更新 `.researchloop/baseline.md`。
3. baseline 明确后，提供三种模式：

```text
propose     建议 2-4 个有依据的实验，让我选择
novel       推理真正不同的假设，而不只是调参数
autonomous  在我批准后，在约定预算内运行循环
```

论文搜索是可选的。当它能改善决策时，agent 应该主动提出；在 autonomous 模式中有用时也可以使用，但第一个实验仍应保持小规模并围绕 baseline。

## 仓库结构

```text
bin/                  CLI entrypoint
templates/            Harness, adapters, and agent prompts
skills/               Downloadable agent research skill packs
docs/site/            Landing page
docs/research/        Local testing notes and research logs
docs/competitors/     Competitor and adjacent-project research
docs/testing/         Setup and onboarding test plans
docs/startup/         Users, customers, open source, and go-to-market
examples/             Copyable end-to-end usage examples
examples/fixtures/    Minimal repo fixtures used by setup tests
scripts/              Smoke tests for the npm package
```

## 当前证据

已在这台 MacBook 上测试：

- `autoresearch init`、`inspect`、`prompt`、`doctor` 和 `report` 可以在干净的临时仓库中通过。
- `autoresearch inspect` 能正确把 `llm-research-kit` 检测为 `generic`、`pytorch`、`huggingface` 和 `llm-research-kit`。
- `autoresearch doctor` 确认本地 torch 2.8.0、CUDA false、MPS true。
- 一个很小的合成 LLM 训练运行已通过 `llm-research-kit` 在本地 MPS 上完成。

见 `docs/research/experiments/macbook-e2e-2026-05-15.md`。

## 产品论点

自主 AI 研究的瓶颈通常不在模型访问，而在研究纪律。多数仓库缺少一个稳定循环来处理：

- 清晰目标
- baseline
- 小实验
- 运行日志
- 对比
- 剪枝
- 延续

AutoResearch-AI 把这个循环打包成一个开源 npm 工具。

## 用户

主要用户：

- 做消融实验的博士生
- 小型 AI 实验室
- 独立 AI 研究员
- 有模型、prompt 或 eval 优化工作的公司

创业计划在 `docs/startup/`。

## 命令

- `autoresearch init` 创建 `.researchloop/` 和 agent 指令文件。
- `autoresearch goal` 把持久研究目标保存到 `.researchloop/goal.md`。
- `autoresearch inspect` 写入 `.researchloop/repo-profile.json`。
- `autoresearch scan-papers` 把相关 arXiv 摘要抓取到 `.researchloop/scratchpad/papers/`。
- `autoresearch idea` 打开一个聊天优先的研究提示词，它会读取仓库历史，必要时询问时间预算，并可把提示词写入 idea 说明。
- `autoresearch prompt` 打印一个可直接交给 agent 的自主研究提示词，并可附加 focus playbook。
- `autoresearch team` 为 AutoResearch-AI 仓库或其他项目生成本地多 agent 开发看板。
- `autoresearch baseline` 运行 baseline 命令，解析指标，并把它锁定到 `goal.md` 和 `plan.md`。
- `autoresearch run` 执行训练或 eval 命令，流式输出日志，解析指标，并记录本次运行。可用 `--device cuda` 或面板里的 `CUDA / Python` 运行方式把 CUDA 后端传给子进程；`--cuda-visible-devices 0,1` 可限制 CUDA 设备。添加 `--seeds N` 可跨 N 个 seed 运行同一命令（把 `{seed}` 替换并导出为 `$RESEARCHLOOP_SEED`），并记录均值/标准差聚合行。
- `autoresearch sweep --spec FILE.json` 通过 `run` 执行声明式 variant 队列（`variants` 列表或 `grid` 笛卡尔积），每个 variant 可选 `--seeds N`、`--dry-run`，并为每个 sweep 生成 `summary.json`。
- `autoresearch loop --command CMD [--iters N]` 闭合 ratchet 循环，运行 N 次迭代，在 `loop_state.json` 中保留指标最好的结果，并可使用 `--patch-cmd`、`--revert-on-regression` 和 `--commit-on-win`。
- `autoresearch anomalies [--id RUN_ID]` 扫描已记录的指标历史，查找发散（NaN/inf）、尖峰和平台期。
- `autoresearch verify --id <run-id>` 从 ledger 重新运行已记录的 run，并根据指标差异报告 `deterministic` / `drifted`。容差通过 `--tolerance N` 设置。
- `autoresearch preflight` 在 `run` 前检查命令、安全性、指标、磁盘、RAM、GPU 和 baseline。`--require-gpu`、`--min-disk-gb`、`--min-mem-gb` 可作为硬性门槛；`--format json` 便于脚本调用。
- `autoresearch resume [--id RUN_ID]` 重新启动失败或超时的 run。它会把 `$RESEARCHLOOP_RESUME=1`、`$RESEARCHLOOP_RESUME_FROM=<source-id>` 和 `$RESEARCHLOOP_RESUME_DIR=<prior-run-dir>` 暴露给子进程，让训练脚本可以加载上一个 checkpoint。省略 `--id` 时会自动选择最新的可恢复 run。
- `autoresearch inspect` 现在会在 `repo-profile.json` 中写入 `multi_gpu` 块，用来检测 torchrun、accelerate、deepspeed 和 pytorch-lightning 启动器，并输出建议的命令形态。
- `autoresearch record` 向 `runs.jsonl` 追加结构化运行结果（用于手动记录）。
- `autoresearch compare` 按选定指标对 run 排名，并在存在时报告 GPU-hours 和峰值显存。
- `autoresearch report` 汇总 run ledger；如果配置了 `.researchloop/cost.yaml`，还会包含总 wall time 和估算成本。使用 `--format markdown --out report.md --include-plots` 可写出带 SVG 图表的可分享实验报告。
- `autoresearch audit <file.md>` 检查 markdown 报告中的数字指标声明是否能在 `runs.jsonl` 中匹配，若不匹配则以非零状态退出。
- `autoresearch dashboard` 启动一个本地 localhost 实验跟踪 dashboard。
- `autoresearch doctor` 检查基础本地工具链。
- `autoresearch infra-doctor --write` 生成 AI Infra/HPC 本机环境体检报告，覆盖 Python、C++ 构建工具、Apple MPS、本地 CUDA、Profiler 和远程 GPU 配置状态。
- `autoresearch scaffold --template python-benchmark --out demo` 生成可直接在 Mac 上运行的 benchmark 项目；也支持 `cpp-benchmark`、`cuda-basic`、`triton-operator` 和 `llm-serving` 骨架。

当存在 `nvidia-smi` 时，每次运行都会自动采集 GPU 统计：`gpu_util_max_pct`、`gpu_util_mean_pct`、`gpu_memory_peak_mb`、`gpu_memory_total_mb` 和 `gpu_hours` 会写入 ledger 行。非 GPU 主机上这些字段也会存在（值为 null），以保持 schema 稳定。

每次 `run` 和 `baseline` 都会自动记录运行时间：`started_at`、`ended_at` 和 `wall_seconds` 会写入 `runs.jsonl`。若要估算成本，请添加 `.researchloop/cost.yaml`：

```yaml
gpu: H100
hourly_usd: 2.50
```

新的 run 行会包含 `est_cost_usd`，计算方式为 `wall_seconds / 3600 * hourly_usd`。

### 提案和分析

- `autoresearch propose` 会在 `propose`、`novel` 或 `autonomous` 模式下提出 N 个有依据的实验，并可选择 focus（`hyperparameters`、`architecture`、`attention`、`data`）。
- `autoresearch rank` 根据目标对一组实验提案排序。
- `autoresearch suggest` 基于现有 run ledger 建议下一批实验。
- `autoresearch topic "<text>"` 对研究主题执行 baseline-aware intake。
- `autoresearch query "<expression>"` 查询 run ledger，并以 `jsonl` 或 `table` 打印。
- `autoresearch failures` 汇总各 run 中最常见的失败模式。
- `autoresearch diff-runs --id-a <id> --id-b <id>` 对两个 run 的配置和指标做 diff，支持 text / json / markdown。
- `autoresearch param-importance` 排名哪些参数对指标影响最大。

### Run 生命周期和 ledger 卫生

- `autoresearch baseline-status` 显示当前 baseline 锁定状态。
- `autoresearch baseline --lock` / `--unlock` 锁定或解锁 baseline。
- `autoresearch replay --id <run-id>` 重放已记录的 run。
- `autoresearch prune` 按年龄或状态清理 run，支持 `--dry-run` 和 `--no-keep-promoted`。
- `autoresearch tag --id <run-id> --add/--remove/--list` 管理 run 上的标签。

### 可复现性和报告

- `autoresearch data-fingerprint` 对输入数据做哈希以支持可复现性。
- `autoresearch model-card --id <run-id>` 为某个 run 输出 model-card markdown。
- `autoresearch digest --since <duration>` 以 text / json / markdown 汇总近期活动。
- `autoresearch report --format markdown --out report.md --include-plots` 写出适合实验记录的报告，包含 Goal、Baseline、Best run、Sweep summary、Loss curves、Discarded results、Open questions 以及 run id 附录。
- `autoresearch audit report.md` 验证 loss/accuracy/perplexity/F1 风格的数字声明是否能对应到 ledger 指标或指标差异。

### 测试

- `npm test` 按顺序运行下面所有快速检查。CI 会在每次 push 和 PR 时，针对 ubuntu 和 macos 上的 Node 18 / 20 / 22 运行它。
- `npm run test:release` 在 `npm test` 之上增加 packed-tarball 安装检查。发布前请运行它。
- `npm run test:setup` 运行空仓库和最小 fixture 的 setup 检查。
- `npm run test:compare` 检查几个已记录 run 的对比输出。
- `npm run test:run` 用确定性 shell 命令检查 `run` 和 `baseline`，包括一个 noisy-log 场景。
- `npm run test:scan-papers` 使用录制的 XML fixture 检查 arXiv scan 路径（无网络）。
- `npm run test:goal` 检查 goal 保存和 prompt 交接。
- `npm run test:idea` 检查聊天优先 idea prompt，覆盖空仓库、形似 llm-research-kit 的仓库，以及带论文的仓库。
- `npm run test:team` 检查多 agent 开发看板和 worker 文件。
- `npm run test:dashboard` 检查本地 dashboard server 和 API。
- `npm run test:prompts` 检查 prompt 模板是否出现 placeholder 漂移。
- `npm run test:focus-prompts` 检查 hyperparameter、architecture 和 attention playbook。
- `npm run test:site` 检查公开 landing page 文案（直接读取文件，无需 server）。
- `npm run test:adapters` 检查 repo-shape adapter 在负例中的检测结果。
- `npm run test:packed` 打包 tarball，安装到隔离 npm prefix，并端到端运行 harness。
- `npm run test:sweep` 检查 sweep 命令的 `variants` 和 `grid` spec，包括 dry-run。
- `npm run test:seeds` 检查 `--seeds N`、`{seed}` 替换，以及均值/标准差聚合行。
- `npm run test:anomalies` 检查 text 和 JSON 输出中的尖峰、平台期和发散检测。
- `npm run test:loop` 检查 ratchet loop 是否跨迭代追踪 running-best 并持久化 `loop_state.json`。
- `npm run test:gpu-ledger` 检查非 GPU 主机上 GPU 字段存在且为 null，并确认 `compare` 跳过 GPU 行。
- `npm run test:cost` 检查 `started_at`、`ended_at`、`wall_seconds`、`est_cost_usd` 运算和报告成本合计。
- `npm run test:query` 检查 `autoresearch query` 的过滤、排序、limit、嵌套字段、JSONL 输出、空结果和语法错误。
- `npm run test:report` 检查 markdown 报告生成、必需章节、run-id 引用和 SVG 图表资产。
- `npm run test:audit` 检查受支持声明能通过，伪造声明会失败，生成报告的 audit 是干净的。
- `npm run test:verify` 检查 `verify --id` 能复现确定性 run，并在记录指标不匹配时报告 drift。
- `npm run test:preflight` 检查 preflight 门槛（命令、安全性、指标、磁盘、内存、GPU、baseline）的 text 和 JSON 输出。
- `npm run test:multi-gpu-detect` 检查 `inspect` 能检测 torchrun / accelerate / deepspeed / pytorch-lightning 启动器。
- `npm run test:resume` 检查 resume 命令能找到最新失败 run，将 resume 环境变量暴露给子进程，并记录 `resume_of` 指针。

## 贡献

AutoResearch-AI 由人类和 AI 代码 agent 并行公开构建。

每个可发布工作单元都是 [GOALS.md](./GOALS.md) 中的编号目标，大小适合一个 agent 独立处理，并带有验收标准、测试计划、文件所有权和明确依赖。贡献流程：

1. 阅读 [AGENTS.md](./AGENTS.md) 和 [CONTRIBUTING.md](./CONTRIBUTING.md)。
2. 从 [GOALS.md](./GOALS.md) 选择一个没有开放 issue / PR、且其 `Depends on` 目标已合并的 `G##` 目标。
3. 打开一个 [Contribute-a-Goal issue](./.github/ISSUE_TEMPLATE/contribute-goal.yml) 来认领它。
4. 创建分支、实现、运行 `npm test`，并使用 [PR template](./.github/PULL_REQUEST_TEMPLATE.md) 打开 PR。

欢迎全部或部分由 AI 代码 agent 编写的 PR。请在 PR 描述中注明 agent 名称，让 reviewer 知道需要什么样的审查。

另见：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)、[SECURITY.md](./SECURITY.md)、[GOVERNANCE.md](./GOVERNANCE.md)、[SUPPORT.md](./SUPPORT.md)、[RELEASING.md](./RELEASING.md)。

## 引用

如果你在论文、消融研究或实验记录中使用 AutoResearch-AI，请通过 [CITATION.cff](./CITATION.cff) 引用它（GitHub 会在侧边栏显示 “Cite this repository” 按钮）。

## 并行 Agent 工具

用于在同一仓库中并行运行多个代码 agent 的本地辅助工具：

```bash
./researchloop-dev/tools/codex-swarm.sh           # opens a 3x2 grid of Terminal.app windows, each running `codex`
```

完整选项和模式见 [researchloop-dev/tools/README.md](./researchloop-dev/tools/README.md)。目前仅支持 macOS。

## 开源

AutoResearch-AI 的核心应保持开源。npm 包、提示词、adapter 和 run ledger 格式都应该可检查、可 fork。

这个包还会在 `skills/` 下发布可选 skill pack，让团队可以把同一套研究规则复制到 Codex、Claude Code 或其他 agent 专用目录中。

未来可能的付费层：

- 托管 dashboard
- 团队 run 历史
- 托管 GPU runner
- 私有实验室模板
- 合规/导出支持
- 面向实验室和公司的优先支持
