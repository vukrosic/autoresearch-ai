#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
logfile="$(mktemp)"
pid=""

cleanup() {
  if [[ -n "$pid" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
  rm -f "$logfile"
}
trap cleanup EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/tmp/researchloop-dashboard-init.log
node ./bin/researchloop.js goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-dashboard-goal.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-a --metric val_loss --command "printf 'val_loss=3.20\nval_loss=3.00\nval_loss=2.85\n'" >/tmp/researchloop-dashboard-run-a.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-b --metric val_loss --command "printf 'val_loss=3.10\nval_loss=2.95\nval_loss=2.70\n'" >/tmp/researchloop-dashboard-run-b.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-c --metric val_loss --command "printf 'val_loss=2.95\nval_loss=2.80\nval_loss=2.60\n'" >/tmp/researchloop-dashboard-run-c.log
cat > "$tmpdir/bench.py" <<'PY'
print("latency_ms=1.11")
PY
mkdir -p "$tmpdir/bench_pkg"
: > "$tmpdir/bench_pkg/__init__.py"
cat > "$tmpdir/bench_pkg/run_benchmark.py" <<'PY'
print("latency_ms=1.23")
PY
cat > "$tmpdir/CMakeLists.txt" <<'CMAKE'
cmake_minimum_required(VERSION 3.20)
project(dashboard_perf_smoke LANGUAGES CXX)
CMAKE
mkdir -p "$tmpdir/.researchloop/scratchpad"
printf 'report ok\001still parseable\n' > "$tmpdir/.researchloop/scratchpad/dashboard-report.md"
node ./bin/researchloop.js run --dir "$tmpdir" --id lineage-root --metric val_loss --command "printf 'val_loss=2.40\n'" >/tmp/researchloop-dashboard-lineage-root.log
node ./bin/researchloop.js verify --dir "$tmpdir" --id lineage-root --metric val_loss --tolerance 0.001 >/tmp/researchloop-dashboard-lineage-verify.log
node ./bin/researchloop.js replay --dir "$tmpdir" lineage-root --metric val_loss --tolerance 0.001 >/tmp/researchloop-dashboard-lineage-replay.log

cat >> "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"diff-a","timestamp":"2026-05-17T10:11:00Z","started_at":"2026-05-17T10:10:30Z","ended_at":"2026-05-17T10:11:00Z","wall_seconds":30,"status":"completed","agent":"manual","command":"python train.py --lr 3e-4","metrics":{"val_loss":0.42,"val_acc":0.81},"params":{"lr":0.0003,"batch_size":32},"env":{"git_sha":"aaaa1111","python_version":"3.11.0","os":"macos"}}
{"id":"diff-b","timestamp":"2026-05-17T10:12:00Z","started_at":"2026-05-17T10:11:25Z","ended_at":"2026-05-17T10:12:00Z","wall_seconds":35,"status":"completed","agent":"manual","command":"python train.py --lr 1e-4","metrics":{"val_loss":0.39,"val_acc":0.83},"params":{"lr":0.0001,"batch_size":32},"env":{"git_sha":"aaaa1111","python_version":"3.11.0","os":"macos"}}
EOF

node ./bin/researchloop.js dashboard --dir "$tmpdir" --port 0 >"$logfile" 2>&1 &
pid=$!

url=""
for _ in $(seq 1 80); do
  if [[ -s "$logfile" ]]; then
    url="$(grep -o 'http://127.0.0.1:[0-9]\+' "$logfile" | tail -n 1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
  fi
  sleep 0.1
done

if [[ -z "$url" ]]; then
  echo "dashboard did not start" >&2
  cat "$logfile" >&2 || true
  exit 1
fi

state="$(curl -s "$url/api/state")"
system="$(curl -s "$url/api/system")"
lineage="$(curl -s "$url/api/lineage")"
diff_same="$(curl -s "$url/api/diff?a=diff-a&b=diff-a")"
diff_pair="$(curl -s "$url/api/diff?a=diff-a&b=diff-b")"
curve_a="$(curl -s "$url/api/curves?run=run-a")"
unknown_status="$(curl -s -o /tmp/researchloop-dashboard-diff-404.log -w '%{http_code}' "$url/api/diff?a=missing-a&b=missing-b")"
page="$(curl -s "$url/")"
lineage_page="$(curl -s "$url/lineage")"
diff_page="$(curl -s "$url/diff?a=diff-a&b=diff-b")"

grep -Eq 'AutoResearch-AI (本地实验看板|Dashboard)' <<<"$page"
grep -Eq '实验效果对比|Metric dashboard' <<<"$page"
grep -q '实验记录' <<<"$page"
grep -q '点击操作 · 不用记命令' <<<"$page"
grep -q 'id="toastStack"' <<<"$page"
grep -q '清空看板记录' <<<"$page"
grep -q '本机环境与工具链自动检测' <<<"$page"
grep -q '自动检测并配置' <<<"$page"
grep -q '一键性能诊断' <<<"$page"
grep -q '性能分析 · 参数扫描 · Profiler' <<<"$page"
grep -q '运行 Benchmark' <<<"$page"
grep -q '批量实验 · 队列工作台' <<<"$page"
grep -q 'id="batchParallelHint"' <<<"$page"
grep -q 'id="uiBatchStabilityEnabled"' <<<"$page"
grep -q 'id="sweepDeleteBtn"' <<<"$page"
grep -q '删除当前队列' <<<"$page"
grep -q '功能目录' <<<"$page"
grep -q '导出作品集' <<<"$page"
grep -q 'scatterMount' <<<"$page"
grep -q 'curveCountPill' <<<"$page"
grep -q 'curveStatusPill' <<<"$page"
grep -Eq '实验记录|Experiments' <<<"$page"
grep -Eq 'Run lineage|lineageMount|谱系' <<<"$lineage_page"
grep -q 'diffRunA' <<<"$diff_page"
grep -q 'lineageMount' <<<"$lineage_page"
grep -q '"primaryMetric": "val_loss"' <<<"$state"
grep -q '"performanceTools":' <<<"$state"
grep -q '"projectEnvironment":' <<<"$state"
grep -q '"recommendations":' <<<"$state"
grep -q '"queueParallelism":' <<<"$state"
grep -q '"google-benchmark":' <<<"$state"
grep -q '"gpu":' <<<"$state"
grep -q '"disk":' <<<"$state"
grep -q '"compute":' <<<"$state"
grep -q '"sample":' <<<"$state"
grep -q '"seq":' <<<"$state"
grep -q '"ageMs":' <<<"$state"
grep -q '"collectMs":' <<<"$state"
grep -q '"missedSamples":' <<<"$state"
grep -q '"sample":' <<<"$system"
grep -q '"seq":' <<<"$system"
grep -q '"ageMs":' <<<"$system"
grep -q '"projectBytes":' <<<"$state"
grep -q '"traces"' <<<"$state"
grep -q '"comparison"' <<<"$state"
grep -q '"lineage"' <<<"$state"
grep -q '"run-c"' <<<"$state"
grep -q '"metric_history"' <<<"$state"
grep -q '"val_loss": \[' <<<"$state"
grep -q '3.1' <<<"$state"
grep -q '2.95' <<<"$state"
grep -q '2.7' <<<"$state"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if (j.activeRun?.active) process.exit(1);});' <<<"$state"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const report=j.researchArtifacts?.dashboardReport; if (!report?.hasContent || !report?.sizeBytes) process.exit(1); if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(report.text || "")) process.exit(1);});' <<<"$state"

autoconfig_resp="$(curl -s -X POST "$url/api/action/perf-autoconfig" \
  -H 'content-type: application/json' \
  --data '{"metric":"latency_ms","direction":"lower"}')"
grep -q '"ok": true' <<<"$autoconfig_resp"
grep -q '"action": "perf-autoconfig"' <<<"$autoconfig_resp"
grep -q '"detectionFile": ".researchloop/scratchpad/environment-detection.json"' <<<"$autoconfig_resp"
grep -q '"benchmarkCommand": "python3 bench_pkg/run_benchmark.py"' <<<"$autoconfig_resp"
grep -q '"benchmarkMode": "generic"' <<<"$autoconfig_resp"
! grep -q '__init__.py' <<<"$autoconfig_resp"
grep -q '"buildSystem": "cmake"' <<<"$autoconfig_resp"

batch_autoconfig_resp="$(curl -s -X POST "$url/api/action/batch-autoconfig" \
  -H 'content-type: application/json' \
  --data '{"metric":"latency_ms","direction":"lower"}')"
grep -q '"ok": true' <<<"$batch_autoconfig_resp"
grep -q '"action": "batch-autoconfig"' <<<"$batch_autoconfig_resp"
grep -q '"batchCommandTemplate":' <<<"$batch_autoconfig_resp"
grep -q '"batchParamGrid":' <<<"$batch_autoconfig_resp"
grep -q '"batchMaxParallelSource": "hardware_auto"' <<<"$batch_autoconfig_resp"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);const rec=Number(j.config?.batchMaxParallel);const hw=Number(j.detection?.hardware?.queueParallelism?.max_parallel);if(!Number.isFinite(rec)||rec<1||rec!==hw) process.exit(1);});' <<<"$batch_autoconfig_resp"

config_resp="$(curl -s -X POST "$url/api/action/config" \
  -H 'content-type: application/json' \
  --data '{"runner":"node","entry":"-e","baselineArgs":"\"console.log('\''val_loss=1.00'\'')\"","experimentArgs":"\"console.log('\''val_loss=0.90'\'')\"","metric":"val_loss","regex":"","timeout":"60","device":"auto"}')"
grep -q '"ok": true' <<<"$config_resp"
grep -q '"dashboardConfig"' <<<"$config_resp"
grep -q '"entry": "-e"' <<<"$config_resp"

cuda_config_resp="$(curl -s -X POST "$url/api/action/config" \
  -H 'content-type: application/json' \
  --data '{"runner":"cuda","entry":"train.py","metric":"val_loss","timeout":"60","device":"auto","cudaVisibleDevices":"0"}')"
grep -q '"ok": true' <<<"$cuda_config_resp"
grep -q '"runner": "cuda"' <<<"$cuda_config_resp"
grep -q '"device": "cuda"' <<<"$cuda_config_resp"
grep -q '"cudaVisibleDevices": "0"' <<<"$cuda_config_resp"

cuda_goal_resp="$(curl -s -X POST "$url/api/action/goal" \
  -H 'content-type: application/json' \
  --data '{"goal":"cuda ui smoke","metric":"val_loss","direction":"lower","runner":"cuda","entry":"train.py","timeout":"60","device":"auto","cudaVisibleDevices":"0"}')"
grep -q '"ok": true' <<<"$cuda_goal_resp"
grep -q 'python3 train.py' <<<"$cuda_goal_resp"

switch_resp="$(curl -s -X POST "$url/api/action/switch-project" \
  -H 'content-type: application/json' \
  --data "{\"path\":\"$tmpdir\"}")"
grep -q '"ok": true' <<<"$switch_resp"
grep -q "\"cwd\": \"$tmpdir\"" <<<"$switch_resp"

goal_resp="$(curl -s -X POST "$url/api/action/goal" \
  -H 'content-type: application/json' \
  --data '{"goal":"ui goal smoke","metric":"val_loss","direction":"lower","runner":"node","entry":"-e","baselineArgs":"\"console.log('\''val_loss=1.00'\'')\"","experimentArgs":"\"console.log('\''val_loss=0.90'\'')\"","timeout":"60","device":"auto"}')"
grep -q '"ok": true' <<<"$goal_resp"
grep -q '"goalText": "ui goal smoke"' <<<"$goal_resp"
grep -q "console.log" <<<"$goal_resp"

record_resp="$(curl -s -X POST "$url/api/action/record" \
  -H 'content-type: application/json' \
  --data '{"id":"ui-manual","metricText":"val_loss=2.44\naccuracy=0.88","note":"ui smoke"}')"
grep -q '"ok": true' <<<"$record_resp"
grep -q '"ui-manual"' <<<"$record_resp"

state_after="$(curl -s "$url/api/state")"
grep -q '"goal": "ui goal smoke"' <<<"$state_after"
grep -q '"dashboardConfig"' <<<"$state_after"
grep -q '"id": "ui-manual"' <<<"$state_after"
grep -q '"accuracy": 0.88' <<<"$state_after"

clear_resp="$(curl -s -X POST "$url/api/action/clear-runs" \
  -H 'content-type: application/json' \
  --data '{}')"
grep -q '"ok": true' <<<"$clear_resp"
grep -q '"action": "clear-runs"' <<<"$clear_resp"
node -e 'const payload = JSON.parse(process.argv[1]); if (!Number.isInteger(payload.clearedRuns) || payload.clearedRuns < 4) process.exit(1);' "$clear_resp"
archive_rel="$(node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).archive || ""));' <<<"$clear_resp")"
test -n "$archive_rel"
test -f "$tmpdir/$archive_rel"
state_cleared="$(curl -s "$url/api/state")"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if (j.summary?.totalRuns !== 0) process.exit(1); if ((j.runs || []).length !== 0) process.exit(1); if ((j.traces || []).length !== 0) process.exit(1);});' <<<"$state_cleared"

node - "$tmpdir" <<'NODE'
const fs = require("fs");
const path = require("path");
const cwd = process.argv[2];
const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
const rows = [];
for (let i = 0; i < 1005; i += 1) {
  const value = 3 - i * 0.001;
  rows.push(JSON.stringify({
    id: `dense-${String(i).padStart(4, "0")}`,
    timestamp: new Date(1_700_000_000_000 + i).toISOString(),
    status: "complete",
    metrics: { val_loss: Number(value.toFixed(4)) },
    metric_history: { val_loss: [value + 0.1, value] },
  }));
}
fs.writeFileSync(ledger, `${rows.join("\n")}\n`);
NODE
dense_state="$(curl -s "$url/api/state")"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if (!j.payloadInfo?.dense) process.exit(1); if (j.payloadInfo.totalRuns !== 1005) process.exit(1); if ((j.runs || []).length > 500) process.exit(1); if ((j.traces || []).length !== 1005) process.exit(1);});' <<<"$dense_state"
grep -q 'denseTraceChart' <<<"$page"
grep -q 'axisTicks' <<<"$page"
grep -q 'indexAxisTicks' <<<"$page"
grep -q 'indexAxisLabel' <<<"$page"
grep -q 'X：实验序号' <<<"$page"
curl -s -X POST "$url/api/action/clear-runs" -H 'content-type: application/json' --data '{}' >/dev/null

perf_build_payload="$(cat <<'JSON'
{"buildCommand":"printf 'build_ok=1\n'","metric":"latency_ms","direction":"lower"}
JSON
)"
perf_build_resp="$(curl -s -X POST "$url/api/action/perf-build" \
  -H 'content-type: application/json' \
  --data "$perf_build_payload")"
grep -q '"ok": true' <<<"$perf_build_resp"
grep -q '"action": "perf-build"' <<<"$perf_build_resp"

perf_bench_payload="$(cat <<'JSON'
{"benchmarkMode":"generic","benchmarkCommand":"printf 'latency_ms=2.50\n'","metric":"latency_ms","direction":"lower","timeout":"60"}
JSON
)"
perf_bench_resp="$(curl -s -X POST "$url/api/action/perf-benchmark" \
  -H 'content-type: application/json' \
  --data "$perf_bench_payload")"
grep -q '"ok": true' <<<"$perf_bench_resp"
grep -q '"action": "perf-benchmark"' <<<"$perf_bench_resp"

perf_profile_payload="$(cat <<'JSON'
{"profileTool":"time","profileCommand":"printf 'profile_ok=1\n'","metric":"latency_ms","direction":"lower","timeout":"60"}
JSON
)"
perf_profile_resp="$(curl -s -X POST "$url/api/action/perf-profile" \
  -H 'content-type: application/json' \
  --data "$perf_profile_payload")"
grep -q '"ok": true' <<<"$perf_profile_resp"
grep -q '"profiler": "time"' <<<"$perf_profile_resp"

perf_compile_payload="$(cat <<'JSON'
{"compilerCommand":"printf 'ptxas info    : Used 32 registers\\n'","compilerFlags":"","metric":"latency_ms","direction":"lower"}
JSON
)"
perf_compile_resp="$(curl -s -X POST "$url/api/action/perf-compile" \
  -H 'content-type: application/json' \
  --data "$perf_compile_payload")"
grep -q '"ok": true' <<<"$perf_compile_resp"
grep -q '"action": "perf-compile"' <<<"$perf_compile_resp"

perf_sweep_payload="$(cat <<'JSON'
{"sweepName":"dashboard-smoke","sweepTemplate":"printf 'latency_ms={tile}\\n'","sweepGrid":"{\"tile\":[4,2]}","metric":"latency_ms","direction":"lower","timeout":"60"}
JSON
)"
perf_sweep_resp="$(curl -s -X POST "$url/api/action/perf-sweep" \
  -H 'content-type: application/json' \
  --data "$perf_sweep_payload")"
grep -q '"ok": true' <<<"$perf_sweep_resp"
grep -q '"action": "perf-sweep"' <<<"$perf_sweep_resp"
grep -q '"spec":' <<<"$perf_sweep_resp"

batch_payload="$(cat <<'JSON'
{"specText":"name: dashboard-queue\nmetric: val_loss\ndirection: lower\ncommand_template: \"printf 'val_loss={loss}\\\\n'\"\ngrid:\n  loss: [0.44, 0.22]\n","maxRuns":"5","maxRetries":"1"}
JSON
)"
batch_preview_resp="$(curl -s -X POST "$url/api/action/sweep-preview" \
  -H 'content-type: application/json' \
  --data "$batch_payload")"
grep -q '"ok": true' <<<"$batch_preview_resp"
grep -q '"action": "sweep-preview"' <<<"$batch_preview_resp"
grep -q '"count": 2' <<<"$batch_preview_resp"

batch_param_payload="$(cat <<'JSON'
{"commandTemplate":"printf 'latency_ms={tile}\\n'","paramGrid":"{\"tile\":[4,8,16,32],\"dtype\":[\"fp16\",\"bf16\"]}","metric":"latency_ms","direction":"lower","maxRuns":"3","maxRetries":"1"}
JSON
)"
batch_param_preview_resp="$(curl -s -X POST "$url/api/action/sweep-preview" \
  -H 'content-type: application/json' \
  --data "$batch_param_payload")"
grep -q '"ok": true' <<<"$batch_param_preview_resp"
grep -q '"count": 3' <<<"$batch_param_preview_resp"

batch_create_resp="$(curl -s -X POST "$url/api/action/sweep-create" \
  -H 'content-type: application/json' \
  --data "$batch_payload")"
grep -q '"ok": true' <<<"$batch_create_resp"
grep -q '"action": "sweep-create"' <<<"$batch_create_resp"
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);const mp=Number(j.queue?.max_parallel);if(!Number.isFinite(mp)||mp<1) process.exit(1);});' <<<"$batch_create_resp"
queue_id="$(node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).queueId));' <<<"$batch_create_resp")"
test -n "$queue_id"
batch_wait_state="$(curl -s "$url/api/state")"
STATE_JSON="$batch_wait_state" node - "$queue_id" <<'NODE'
const queueId = process.argv[2];
const state = JSON.parse(process.env.STATE_JSON || "{}");
const analysis = state.metricTierAnalysis || {};
if (analysis.batch_queue_id !== queueId) process.exit(1);
if (analysis.selection_mode !== "batch_waiting") process.exit(1);
if (analysis.recommendation?.code !== "waiting_batch") process.exit(1);
if (analysis.candidate_id) process.exit(1);
NODE

batch_start_resp="$(curl -s -X POST "$url/api/action/sweep-start" \
  -H 'content-type: application/json' \
  --data "{\"queueId\":\"$queue_id\"}")"
grep -q '"ok": true' <<<"$batch_start_resp"
grep -q '"action": "sweep-start"' <<<"$batch_start_resp"

batch_status_resp=""
for _ in $(seq 1 80); do
  batch_status_resp="$(curl -s -X POST "$url/api/action/sweep-status" \
    -H 'content-type: application/json' \
    --data "{\"queueId\":\"$queue_id\"}")"
  if node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.exit(j.queue?.status==="complete" && j.queue?.counts?.complete===2 ? 0 : 1);});' <<<"$batch_status_resp"; then
    break
  fi
  sleep 0.1
done
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);if(j.queue?.status!=="complete" || j.queue?.counts?.complete!==2) process.exit(1);});' <<<"$batch_status_resp"
batch_complete_state="$(curl -s "$url/api/state")"
STATE_JSON="$batch_complete_state" node - "$queue_id" <<'NODE'
const queueId = process.argv[2];
const state = JSON.parse(process.env.STATE_JSON || "{}");
const queue = (state.sweepQueues || []).find((entry) => entry.queue_id === queueId);
const analysis = state.metricTierAnalysis || {};
if (!queue?.best?.run_id) process.exit(1);
if (analysis.selection_mode !== "batch_best") process.exit(1);
if (analysis.batch_queue_id !== queueId) process.exit(1);
if (analysis.candidate_id !== queue.best.run_id) process.exit(1);
NODE

cat > "$tmpdir/parallel_metric.js" <<'JS'
const delayMs = Number(process.argv[2] || 900);
const loss = String(process.argv[3] || "0.5");
setTimeout(() => {
  console.log(`val_loss=${loss}`);
  console.log(`cuda_visible_devices=${process.env.CUDA_VISIBLE_DEVICES || ""}`);
}, delayMs);
JS

parallel_payload="$(cat <<'JSON'
{"specText":"name: dashboard-parallel-queue\nmetric: val_loss\ndirection: lower\ncommand_template: \"node parallel_metric.js 900 {loss}\"\nmax_parallel: 2\ncuda_visible_devices: \"0,1\"\ngrid:\n  loss: [0.44, 0.33, 0.22, 0.11]\n","maxRuns":"4","maxParallel":"2","devicePool":"0,1","maxRetries":"0"}
JSON
)"
parallel_create_resp="$(curl -s -X POST "$url/api/action/sweep-create" \
  -H 'content-type: application/json' \
  --data "$parallel_payload")"
grep -q '"ok": true' <<<"$parallel_create_resp"
parallel_queue_id="$(node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).queueId));' <<<"$parallel_create_resp")"
test -n "$parallel_queue_id"

parallel_start_resp="$(curl -s -X POST "$url/api/action/sweep-start" \
  -H 'content-type: application/json' \
  --data "{\"queueId\":\"$parallel_queue_id\",\"maxParallel\":\"2\",\"devicePool\":\"0,1\"}")"
grep -q '"ok": true' <<<"$parallel_start_resp"

parallel_status_resp=""
for _ in $(seq 1 120); do
  parallel_status_resp="$(curl -s -X POST "$url/api/action/sweep-status" \
    -H 'content-type: application/json' \
    --data "{\"queueId\":\"$parallel_queue_id\"}")"
  if node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.exit(j.queue?.status==="complete" && j.queue?.counts?.complete===4 ? 0 : 1);});' <<<"$parallel_status_resp"; then
    break
  fi
  sleep 0.1
done
node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);const q=j.queue;if(q?.status!=="complete"||q?.counts?.complete!==4||q?.max_parallel!==2) process.exit(1);const devices=(q.trials||[]).map(t=>t.cuda_visible_devices).filter(Boolean);if(!devices.includes("0")||!devices.includes("1")) process.exit(1);});' <<<"$parallel_status_resp"
node - "$tmpdir/.researchloop/scratchpad/queues/$parallel_queue_id/events.jsonl" <<'NODE'
const fs = require("fs");
const events = fs.readFileSync(process.argv[2], "utf8").trim().split(/\n/).map((line) => JSON.parse(line));
const firstFinished = events.findIndex((event) => event.event === "trial_completed" || event.event === "trial_finished");
const startsBeforeFirstFinish = events.slice(0, firstFinished < 0 ? events.length : firstFinished).filter((event) => event.event === "trial_started");
if (startsBeforeFirstFinish.length < 2) process.exit(1);
const startDevices = startsBeforeFirstFinish.map((event) => event.cuda_visible_devices).filter(Boolean);
if (!startDevices.includes("0") || !startDevices.includes("1")) process.exit(1);
NODE

batch_delete_resp="$(curl -s -X POST "$url/api/action/sweep-delete" \
  -H 'content-type: application/json' \
  --data "{\"queueId\":\"$parallel_queue_id\",\"clearCurrent\":\"true\"}")"
grep -q '"ok": true' <<<"$batch_delete_resp"
grep -q '"action": "sweep-delete"' <<<"$batch_delete_resp"
grep -q '"archivedQueue":' <<<"$batch_delete_resp"
test ! -e "$tmpdir/.researchloop/scratchpad/queues/$parallel_queue_id/state.json"
find "$tmpdir/.researchloop/scratchpad/queues-archive" -maxdepth 1 -type d -name "$parallel_queue_id-*" | grep -q "$parallel_queue_id"
delete_state="$(curl -s "$url/api/state")"
STATE_JSON="$delete_state" node - "$parallel_queue_id" <<'NODE'
const queueId = process.argv[2];
const state = JSON.parse(process.env.STATE_JSON || "{}");
if ((state.sweepQueues || []).some((entry) => entry.queue_id === queueId)) process.exit(1);
if (state.dashboardConfig?.batchQueueId) process.exit(1);
NODE

batch_report_resp="$(curl -s -X POST "$url/api/action/sweep-report" \
  -H 'content-type: application/json' \
  --data "{\"queueId\":\"$queue_id\"}")"
grep -q '"ok": true' <<<"$batch_report_resp"
grep -q 'sweep-report.md' <<<"$batch_report_resp"

perf_report_resp="$(curl -s -X POST "$url/api/action/perf-report" \
  -H 'content-type: application/json' \
  --data '{"metric":"latency_ms","direction":"lower"}')"
grep -q '"ok": true' <<<"$perf_report_resp"
grep -q '"out": ".researchloop/scratchpad/performance-analysis.md"' <<<"$perf_report_resp"

portfolio_resp="$(curl -s -X POST "$url/api/action/portfolio" \
  -H 'content-type: application/json' \
  --data '{"metric":"latency_ms","direction":"lower"}')"
grep -q '"ok": true' <<<"$portfolio_resp"
grep -q '"out": ".researchloop/scratchpad/portfolio-report.md"' <<<"$portfolio_resp"
test -f "$tmpdir/.researchloop/scratchpad/portfolio-report.md"
test -f "$tmpdir/.researchloop/env/environment.md"

node -e 'const payload = JSON.parse(process.argv[1]); if (payload.run_id !== "run-a") process.exit(1); if (!Array.isArray(payload.series) || payload.series.length !== 3) process.exit(1); if (!payload.series.every((p) => Number.isFinite(p.step) && Number.isFinite(p.value))) process.exit(1);' "$curve_a"
node -e 'const lineage = JSON.parse(process.argv[1]); if (!lineage || !Array.isArray(lineage.roots)) process.exit(1); const root = lineage.roots.find((node) => node.id === "lineage-root"); if (!root || !Array.isArray(root.children) || root.children.length < 2) process.exit(1); const childIds = root.children.map((child) => child.id); if (!childIds.some((id) => /^verify-lineage-root-/.test(id))) process.exit(1); if (!childIds.some((id) => /^replay-lineage-root-/.test(id))) process.exit(1);' "$lineage"
node -e 'const diff = JSON.parse(process.argv[1]); if (!diff.identical || diff.differences.length !== 0) process.exit(1);' "$diff_same"
node -e 'const diff = JSON.parse(process.argv[1]); if (diff.identical) process.exit(1); const paths = diff.differences.map((d) => d.path); if (!paths.includes("params.lr")) process.exit(1); if (!paths.includes("metrics.val_loss")) process.exit(1); if (diff.sections.params.length !== 1) process.exit(1); if (diff.sections.metrics.length < 2) process.exit(1);' "$diff_pair"
if [[ "$unknown_status" != "404" ]]; then
  echo "FAIL: diff endpoint should 404 for unknown runs"
  cat /tmp/researchloop-dashboard-diff-404.log >&2 || true
  exit 1
fi

echo "autoresearch test:dashboard passed"
