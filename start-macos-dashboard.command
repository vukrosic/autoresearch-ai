#!/bin/zsh
set -u

DEFAULT_PORT="${AUTORESEARCH_PORT:-8792}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_PROJECT="${AUTORESEARCH_PROJECT:-}"

if [ -z "$DEFAULT_PROJECT" ]; then
  if [ -d "$HOME/Desktop/operator-benchmarks/mlx-benchmark" ]; then
    DEFAULT_PROJECT="$HOME/Desktop/operator-benchmarks/mlx-benchmark"
  else
    DEFAULT_PROJECT="$ROOT_DIR"
  fi
fi

AUTORESEARCH="$ROOT_DIR/bin/researchloop.js"
NODE_BIN="$(command -v node || true)"

echo "AutoResearch-AI 本地实验面板"
echo "--------------------------------"
echo "默认测试项目：$DEFAULT_PROJECT"
echo
echo "请输入要测试的项目文件夹路径。"
echo "直接回车会使用默认项目。"
printf "项目路径: "
read -r PROJECT_DIR

if [ -z "${PROJECT_DIR// }" ]; then
  PROJECT_DIR="$DEFAULT_PROJECT"
fi

PROJECT_DIR="${PROJECT_DIR/#\~/$HOME}"
PROJECT_DIR="${PROJECT_DIR%\"}"
PROJECT_DIR="${PROJECT_DIR#\"}"
PROJECT_DIR="${PROJECT_DIR%\'}"
PROJECT_DIR="${PROJECT_DIR#\'}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo
  echo "项目文件夹不存在："
  echo "$PROJECT_DIR"
  echo
  echo "请重新双击脚本，并输入一个真实存在的项目文件夹。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if [ ! -x "$AUTORESEARCH" ] && [ ! -f "$AUTORESEARCH" ]; then
  FOUND_AUTORESEARCH="$(command -v autoresearch || true)"
  if [ -n "$FOUND_AUTORESEARCH" ]; then
    AUTORESEARCH="$FOUND_AUTORESEARCH"
  else
    echo
    echo "没有找到 AutoResearch-AI 启动程序。"
    echo "当前查找位置：$AUTORESEARCH"
    echo "按任意键关闭窗口。"
    read -k 1
    exit 1
  fi
fi

if [ -f "$AUTORESEARCH" ] && [ -z "$NODE_BIN" ]; then
  echo
  echo "没有找到 Node.js。请先安装 Node.js，或把 node 加入 PATH。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

PORT="$DEFAULT_PORT"
URL="http://127.0.0.1:${PORT}/"
LOG_FILE="/tmp/autoresearch-dashboard-${PORT}.log"
PID_FILE="/tmp/autoresearch-dashboard-${PORT}.pid"

is_port_open() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

is_dashboard_ready() {
  /usr/bin/curl -fsS "${URL}api/state" >/dev/null 2>&1
}

dashboard_has_current_ui() {
  local page
  page="$(/usr/bin/curl -fsS "$URL" 2>/dev/null || true)"
  printf "%s" "$page" | /usr/bin/grep -q 'id="batchAutoconfigBtn"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="clearRunsBtn"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="sweepDeleteBtn"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="toastStack"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'denseTraceChart' &&
    printf "%s" "$page" | /usr/bin/grep -q 'axisTicks' &&
    printf "%s" "$page" | /usr/bin/grep -q 'indexAxisLabel' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="uiBatchMaxParallel"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="batchParallelHint"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'id="uiBatchStabilityEnabled"' &&
    printf "%s" "$page" | /usr/bin/grep -q 'X：实验序号'
}

port_pid() {
  /usr/sbin/lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

switch_dashboard_project() {
  local json
  json="$("$NODE_BIN" -e 'console.log(JSON.stringify({ path: process.argv[1] }))' "$PROJECT_DIR")"
  /usr/bin/curl -fsS -X POST "${URL}api/action/switch-project" \
    -H "content-type: application/json" \
    --data "$json" >/dev/null 2>&1
}

choose_available_port() {
  for candidate in "$DEFAULT_PORT" 8793 8794 8795 8796; do
    PORT="$candidate"
    URL="http://127.0.0.1:${PORT}/"
    LOG_FILE="/tmp/autoresearch-dashboard-${PORT}.log"
    PID_FILE="/tmp/autoresearch-dashboard-${PORT}.pid"
    if ! is_port_open || is_dashboard_ready; then
      return 0
    fi
  done
  return 1
}

echo
echo "正在准备项目：$PROJECT_DIR"

if ! choose_available_port; then
  echo "8792-8796 端口都被占用，无法自动启动面板。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if is_port_open && is_dashboard_ready && dashboard_has_current_ui; then
  echo "检测到面板已经在运行，正在切换到当前项目..."
  switch_dashboard_project || true
else
  if is_port_open; then
    CURRENT_PID="$(port_pid)"
    CURRENT_COMMAND="$(ps -p "$CURRENT_PID" -o command= 2>/dev/null || true)"
    if [[ "$CURRENT_COMMAND" == *"researchloop.js dashboard"* ]]; then
      echo "检测到旧面板或旧界面进程，正在重启..."
      kill "$CURRENT_PID" 2>/dev/null || true
      for _ in {1..20}; do
        if ! is_port_open; then
          break
        fi
        sleep 0.5
      done
    fi
  fi

  echo "正在后台启动面板服务..."
  rm -f "$LOG_FILE" "$PID_FILE"
  if [ -f "$AUTORESEARCH" ]; then
    "$NODE_BIN" -e '
const { spawn } = require("child_process");
const fs = require("fs");
const [script, projectDir, port, logFile, pidFile] = process.argv.slice(1);
const out = fs.openSync(logFile, "a");
const child = spawn(process.execPath, [script, "dashboard", "--dir", projectDir, "--host", "127.0.0.1", "--port", port], {
  detached: true,
  stdio: ["ignore", out, out],
});
child.unref();
fs.writeFileSync(pidFile, `${child.pid}\n`);
' "$AUTORESEARCH" "$PROJECT_DIR" "$PORT" "$LOG_FILE" "$PID_FILE"
  else
    nohup "$AUTORESEARCH" dashboard --dir "$PROJECT_DIR" --host 127.0.0.1 --port "$PORT" >> "$LOG_FILE" 2>&1 &
    echo "$!" > "$PID_FILE"
  fi

  for _ in {1..30}; do
    if is_dashboard_ready && dashboard_has_current_ui; then
      break
    fi
    sleep 0.5
  done
fi

if ! is_dashboard_ready || ! dashboard_has_current_ui; then
  echo
  echo "面板启动失败，或仍然是旧界面。最近日志："
  tail -50 "$LOG_FILE" 2>/dev/null || true
  echo
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

switch_dashboard_project || true

echo
echo "面板已就绪：$URL"
echo "项目路径：$PROJECT_DIR"
echo "正在用 Google Chrome 打开面板..."

if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
else
  open "$URL"
fi

echo
echo "完成。可以在面板顶部“当前项目文件夹”里继续切换项目。"
echo "这个窗口 5 秒后自动关闭。"
sleep 5
