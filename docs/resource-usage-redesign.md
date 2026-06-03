# AutoResearch-AI 资源占用统计改造需求文档

## 1. 背景与目标

用户提供的 `autoresearch-ai-0.5.1.tar.gz` 是官方 0.5.1 包。解压后可见它已经包含完整的研究闭环：`init`、`goal`、`inspect`、`run`、`baseline`、`sweep`、`loop`、`resume`、`preflight`、`verify`、`compare`、`report`、`dashboard`、`scan-papers`、`idea`、`team` 等命令，并能在每次运行里记录日志、指标、GPU 摘要和实验账本。

本地项目同样是 0.5.1，并且已经叠加了额外能力，例如 `infra-doctor`、`scaffold`、CUDA 运行方式、metric tiers、portfolio、audit、sweep queue、HPC/AI Infra 性能面板等。压缩包中没有缺失到本地项目的文件，所以不做整包覆盖。本次改造重点是把已有“系统资源”视角升级为“测试项目/测试命令资源占用”视角。

改造目标：

- 运行实验时按启动命令的 PID 进程树统计资源，而不是只看整机负载。
- 输出口径接近日常在 macOS 活动监视器、Windows 任务管理器、Linux top/ps 中理解的进程占用。
- 记录 CPU、内存、磁盘 IO、网络传输、GPU 摘要，并明确每项数据来源和支持级别。
- 降低采样延迟和传输误差：固定间隔采样、记录采集耗时、数据年龄、丢样数和来源。
- 将资源摘要写入 `runs.jsonl`，将原始采样写入每次运行目录的 `system.jsonl`，并在 dashboard 中展示。

## 2. 成熟方案参考

可参考但本轮不强制引入依赖：

- [`pidusage`](https://github.com/soyuka/pidusage)：Node 生态中成熟的进程 CPU/内存采样方案，适合作为未来依赖化替代。
- [`pidusage-tree`](https://github.com/soyuka/pidusage-tree)：在 `pidusage` 基础上统计进程树，和本项目“命令 + 子进程”口径一致。
- [`systeminformation`](https://github.com/sebhildebrandt/systeminformation)：Node 跨平台系统信息采集库，适合未来做更完整的硬件面板。
- [`psutil`](https://github.com/giampaolo/psutil)：Python 跨平台进程、内存、磁盘、网络采样库，适合 Python 项目或作为可选采样后端。

本地项目目前保持零运行时依赖，优先用 Node 标准库和系统命令实现，避免增加安装门槛。

## 3. 资源统计口径

### 3.1 整机资源

整机资源继续用于 dashboard 顶部健康概览：

- CPU：macOS 优先 `top`，否则 `os.loadavg()`。
- 内存：macOS 优先 `top`，否则 Node `os.totalmem()` / `os.freemem()`。
- GPU：NVIDIA 优先 `nvidia-smi`，macOS 读取 `system_profiler` 的设备与统一内存信息。
- 磁盘：`statfs` + 项目目录大小估算。

该口径不再作为“某次实验的资源占用”结论。

### 3.2 运行资源

运行资源绑定到 `autoresearch run` / `baseline` / `sweep` / `loop` 等启动的命令：

- 根 PID：`spawn()` 启动的 shell 进程。
- 进程树：按 `pid -> ppid` 递归收集子进程。
- CPU：按进程累计 CPU time 的采样差值计算；缺省时回退到 `ps %cpu`。
- 内存：进程树 RSS 汇总，并记录峰值。
- 磁盘 IO：Linux 读取 `/proc/<pid>/io`；Windows 预留 PowerShell/CIM 路径；macOS 标注为当前轻量实现不支持精确进程 IO。
- 网络：跨平台轻量方案只能记录运行窗口内的系统网络收发增量，并明确标记为 `system_delta`，不伪装成单进程网络。
- GPU：NVIDIA 可记录全局 GPU 摘要，并尝试通过 `nvidia-smi --query-compute-apps` 汇总匹配 PID 的显存占用；macOS 轻量路径只展示设备和统一内存，不伪装 GPU 利用率。

## 4. 数据流与架构

```text
Dashboard / CLI
  -> buildDashboardCommand / run command
  -> spawnCommand()
  -> onSpawn(child.pid)
  -> startSystemSampler(runDir, cwd)
       -> bindPid(pid)
       -> collect process tree snapshots
       -> write system.jsonl
       -> aggregate peak/mean/delta
  -> executeRun()
       -> parse metrics
       -> append runs.jsonl with resource_profile
  -> dashboard /api/state
       -> latestRun.resource_profile
       -> render run resource summary
```

## 5. 数据协议

### 5.1 `system.jsonl` 单条样本

```json
{
  "ts": "2026-06-03T00:00:00.000Z",
  "load_avg_1m": 1.23,
  "mem_total_bytes": 34359738368,
  "mem_free_bytes": 123456789,
  "gpus": null,
  "process": {
    "root_pid": 12345,
    "pids": [12345, 12346],
    "process_count": 2,
    "cpu_pct": 85.2,
    "cpu_total_pct": 21.3,
    "rss_bytes": 456789012,
    "disk_read_bytes": null,
    "disk_write_bytes": null,
    "network_rx_bytes": 1024,
    "network_tx_bytes": 2048,
    "sources": {
      "process": "ps",
      "disk": "unsupported",
      "network": "system_delta"
    }
  },
  "sample": {
    "seq": 12,
    "interval_ms": 1000,
    "collect_ms": 18,
    "drift_ms": 2
  }
}
```

### 5.2 `runs.jsonl` 汇总字段

```json
{
  "resource_profile": {
    "samples": 8,
    "root_pid": 12345,
    "process_cpu_max_pct": 120.5,
    "process_cpu_mean_pct": 72.4,
    "process_cpu_total_max_pct": 30.1,
    "process_memory_peak_bytes": 987654321,
    "process_memory_peak_mb": 941.9,
    "process_disk_read_bytes": null,
    "process_disk_write_bytes": null,
    "system_network_rx_bytes": 4096,
    "system_network_tx_bytes": 8192,
    "source": "process-tree"
  }
}
```

同时保留若干顶层字段，便于 `query`、`report`、`dashboard` 直接读取。

## 6. 模块改造计划

### 6.1 CLI 运行器

- 修改 `spawnCommand()`：启动后回调 `child.pid`。
- 修改 `executeRun()`：将 PID 绑定给采样器，并把资源汇总写入运行账本。

### 6.2 采样器

- 将采样间隔从 5 秒缩短到 1 秒。
- 用递归 `setTimeout` 避免采样任务重叠。
- 记录采样序号、采集耗时、漂移、丢样和错误。
- 新增进程树 CPU/RSS/IO/网络采样函数。

### 6.3 Dashboard

- 保留“系统资源”面板。
- 新增“最近一次运行资源占用”行，展示实验进程树的 CPU 峰值/均值、内存峰值、磁盘 IO、网络窗口增量、采样数量和数据来源。
- 明确区分“整机状态”和“最近运行占用”。

### 6.4 测试

- 增加资源账本 smoke test：运行一个短命令，确认 `resource_profile`、进程 CPU/内存字段、`system.jsonl` 存在。
- 继续保留 GPU ledger 测试，避免破坏旧字段。

## 7. 技术栈与协议

- Runtime：Node.js ESM，保持无新增运行时依赖。
- 采样协议：本地 JSONL，每次运行独立写入 `.researchloop/scratchpad/runs/<run-id>/system.jsonl`。
- 状态协议：dashboard 使用 HTTP JSON，`/api/state` 和 `/api/system` 保持现有结构，运行资源从 `summary.latestRun` 读取。
- 跨平台策略：macOS/Linux 使用 `ps` 和系统文件；Linux 增强 `/proc`；Windows 预留 PowerShell/CIM 采样。
- GPU 策略：NVIDIA 使用 `nvidia-smi`；Apple GPU 不伪造利用率，只显示可观测信息。

## 8. 风险与边界

- macOS 没有轻量、无权限的稳定单进程磁盘 IO/GPU 利用率接口；本轮不伪造这些数据。
- RSS 汇总会包含共享库内存的重复计入，和多数轻量进程监控工具一致，但不是精确物理独占内存。
- 网络按系统窗口增量统计，适合判断实验期间是否发生明显网络传输，不等价于单进程网络流量。
- 极短命令可能只采到 1 个样本；采样器会记录样本数，dashboard 需要显示可信度。
