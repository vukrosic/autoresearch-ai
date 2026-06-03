# AutoResearch 科研面板使用说明

这份说明用于本地启动 AutoResearch-AI 面板、选择测试项目、逐个使用面板模块，并在第六个模块里批量执行实验、记录指标和对比参数组合。

## 1. 启动面板

### macOS 桌面脚本

双击桌面上的 `启动AutoResearch面板.command`。脚本会提示输入测试项目文件夹路径：

```text
项目路径:
```

直接回车会使用默认项目 `~/Desktop/operator-benchmarks/mlx-benchmark`。如果要测试别的项目，把项目文件夹完整路径粘贴进去，例如：

```text
/Users/MacBook/Desktop/my-benchmark-project
```

脚本会启动本地面板并打开：

```text
http://127.0.0.1:8792/
```

仓库内也保留了同等逻辑的脚本：

```bash
./启动AutoResearch面板.command
./start-macos-dashboard.command
```

这个版本会自动使用当前仓库里的 `bin/researchloop.js`，适合提交到 GitHub 后在本地 checkout 中复用。

### Windows 脚本

Windows 下双击：

```text
start-windows-dashboard.cmd
```

或在命令行里运行：

```cmd
start-windows-dashboard.cmd
```

### 命令行启动

如果不想用脚本，也可以进入 AutoResearch-AI 仓库后运行：

```bash
node ./bin/researchloop.js dashboard --dir "/path/to/test-project" --host 127.0.0.1 --port 8792
```

`--dir` 后面填要测试的科研或 benchmark 项目文件夹。

## 2. 选择测试项目

打开面板后，顶部会显示当前项目文件夹。这里的项目不是 AutoResearch-AI 自己，而是你要测试、跑实验、做性能对比的目标项目。

常见项目路径示例：

```text
/Users/MacBook/Desktop/operator-benchmarks/mlx-benchmark
/Users/MacBook/Desktop/my-pytorch-training
/Users/MacBook/Desktop/my-cuda-kernel-benchmark
```

切换项目后，面板会重新读取该项目中的入口文件、实验脚本、`.researchloop/` 记录和运行结果。

## 3. 模块功能

### 模块 1：项目与系统概览

这个模块用于确认面板当前连接的是哪个项目，以及本机的基础运行环境。

重点看：

- 当前项目文件夹是否正确。
- Python、Node、系统环境是否可用。
- 本机 GPU/加速器信息，例如 Apple MPS、CUDA、NVIDIA GPU。
- 最近一次运行状态。

如果这里的项目路径不对，后面的实验都会跑错目录，需要先切换项目。

### 模块 2：单次实验 / Baseline

这个模块用于先跑一个单独实验，确认项目能正常执行并能产出指标。

常见输入：

```bash
python train.py --epochs 1 --batch-size 8
python benchmark.py --batch_size 1 --dtype fp32
bash scripts/bench.sh
```

建议先用一个很小的命令跑通 baseline。命令最好在日志里打印可解析指标，例如：

```text
accuracy=0.873
loss=0.421
latency_ms=12.8
throughput=256.4
tokens_per_second=830.2
```

如果实验完成但没有指标，通常说明命令输出里没有这类指标文本，或者项目把结果写到特殊文件里但面板还不知道在哪里读取。

### 模块 3：运行记录与对比

这个模块读取 `.researchloop/scratchpad/runs.jsonl`，展示历史实验。

可以用它查看：

- 每次运行的 run id。
- 运行状态：成功、失败、超时、完成但无指标。
- 解析到的指标。
- 当前最佳实验。
- 多次实验之间的趋势。

如果某次运行显示“完成但无指标”，说明命令实际执行结束了，但没有被解析到性能指标。需要回到模块 2 或模块 6 调整命令和指标输出。

### 模块 4：指标层级与目标

这个模块用于告诉系统什么指标更重要。

推荐用法：

- 训练任务：主指标选 `loss`、`accuracy`、`val_loss`、`f1`。
- 推理任务：主指标选 `latency_ms`、`throughput`、`tokens_per_second`。
- AI Infra / HPC：主指标选 `gflops`、`bandwidth_gbps`、`latency_ms`、`speedup`。

方向也要设置正确：

```text
loss / latency_ms：越低越好
accuracy / throughput / gflops / speedup：越高越好
```

### 模块 5：系统资源与 AI Infra 检查

这个模块用于观察运行时资源占用和本机工具链状态。

常用操作：

- 查看 CPU、内存、GPU 的基础状态。
- 运行 infra doctor，检查 Python、C++、CUDA、MPS、profiler 等工具。
- 观察最近一次实验的资源采样。

macOS 上部分 GPU 利用率和单进程磁盘 IO 不容易无权限精确读取，面板会显示能可靠采到的数据，不会伪造不存在的指标。

### 模块 6：批量实验队列

这是做参数组合、自动队列、多次实验对比的核心模块。

#### 6.1 自动识别入口

点击“自动识别入口”后，后台会扫描当前测试项目，优先寻找真实可运行的入口文件，而不是空的 `__init__.py`。

常见可识别入口：

```text
benchmark.py
bench.py
train.py
eval.py
run_benchmark.py
scripts/bench.sh
run_m1_safe_ops.py
```

识别完成后，面板会自动填入适合当前项目的命令模板。模板里可以包含参数占位符：

```bash
python benchmark.py --batch_size {batch_size} --dtype {dtype}
python train.py --lr {lr} --batch_size {batch_size} --epochs {epochs}
bash -lc '.venv/bin/python run_m1_safe_ops.py --op {op} --backend {backend} --repeats {repeats}'
```

#### 6.2 参数库

点击“参数库”可以选择常见 AI Infra、HPC、训练和推理实验参数。推荐按任务选择，不要一次把所有参数都勾上，否则组合数会膨胀。

常用参数：

```text
batch_size: 1, 2, 4, 8, 16, 32
dtype: fp32, fp16, bf16
lr: 1e-4, 3e-4, 1e-3
optimizer: adamw, sgd
epochs: 1, 3, 5
seq_len: 128, 512, 1024, 2048
backend: cpu, mps, cuda
device: cpu, mps, cuda
threads: 1, 2, 4, 8
num_workers: 0, 2, 4, 8
warmup: 1, 3, 5
repeats: 3, 5, 10
op: matmul, conv, attention, layernorm
```

#### 6.3 生成参数配置

选择参数后，点击“生成参数配置”。系统会按参数网格生成实验队列。

可以人为限制生成数量，例如：

```text
最大队列数量: 16
```

这样即使理论组合有上百个，面板也只生成前 16 个或抽样后的 16 个，避免一次跑太久。

#### 6.4 运行队列

点击运行队列后，系统会逐个执行实验。每个实验都会写入运行记录，并在下方图表和表格中对比。

观察重点：

- 哪组参数指标最好。
- 是否有失败或超时。
- 是否出现“完成但无指标”。
- 资源占用是否异常。
- 性能提升是否稳定，而不是偶然波动。

## 4. 如何确保生成指标

面板需要从命令输出或结果文件中解析指标。最稳妥的做法是在测试项目入口脚本最后打印明确的键值对。

推荐格式：

```text
loss=0.421
accuracy=0.873
latency_ms=12.8
throughput=256.4
gflops=91.2
bandwidth_gbps=44.5
tokens_per_second=830.2
```

也可以输出 JSON：

```json
{"latency_ms": 12.8, "throughput": 256.4, "dtype": "fp32", "batch_size": 1}
```

不推荐只输出自然语言，例如：

```text
The model is pretty fast today.
```

这种日志没有稳定的指标名和数字，面板无法可靠对比。

## 5. 常见问题

### 面板像图片一样不能操作，或看不到“自动识别入口”

说明浏览器里可能仍是旧服务或旧界面。关闭旧页面后重新双击启动脚本。当前脚本会检查三个新界面标记：

```text
batchAutoconfigBtn
clearRunsBtn
toastStack
```

如果检测到旧界面，脚本会尝试重启面板服务。

### 队列运行完成但没有指标

按顺序检查：

1. 命令是否真的在当前项目目录下运行。
2. 命令输出里是否有 `loss=...`、`latency_ms=...` 这类指标。
3. 参数占位符是否和参数配置一致，例如模板里有 `{batch_size}`，参数配置里也必须有 `batch_size`。
4. 是否使用了错误的 Python 环境。
5. 结果是否写入了项目自定义文件，但没有打印到标准输出。

### 端口被占用

默认端口是 `8792`。脚本会自动尝试 `8793` 到 `8796`。如果都被占用，先关闭旧面板进程再重新启动。

## 6. 本地核对命令

开发者可以用这些命令核对面板功能：

```bash
node --check bin/researchloop.js
npm run test:dashboard
npm run test:sweep-queue
npm run test:metric-tiers
npm run test:infra
npm run test:resource-usage
npm run test:windows
```

启动后还可以访问：

```text
http://127.0.0.1:8792/api/state
```

确认当前项目、入口命令、批量队列模板和运行记录是否正确。
