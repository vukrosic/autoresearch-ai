#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-curves-init.log
$cli goal --dir "$tmpdir" "lower training loss" \
  --metric train_loss --direction lower \
  --baseline "printf 'train_loss=1.0\n'" \
  --evaluation "printf 'train_loss=1.0\n'" \
  >/tmp/researchloop-curves-goal.log

# Emit 10 monotonically decreasing values (printf gives canonical "0.95").
emit_script='for i in 1 2 3 4 5 6 7 8 9 10; do
  val=$(awk -v n="$i" "BEGIN { printf \"%.4f\", 1.0 - 0.05 * n }")
  printf "step=%d train_loss=%s\n" "$i" "$val"
done'
$cli run --dir "$tmpdir" --id curves-run --command "bash -c '$emit_script'" --timeout 30 \
  >/tmp/researchloop-curves-run.log 2>&1
grep -q "status: complete" /tmp/researchloop-curves-run.log

# metrics.jsonl was streamed live.
metrics_file="$tmpdir/.researchloop/scratchpad/runs/curves-run/metrics.jsonl"
if [ ! -s "$metrics_file" ]; then
  echo "expected metrics.jsonl for curves-run"
  exit 1
fi
line_count=$(wc -l < "$metrics_file")
if [ "$line_count" -ne 10 ]; then
  echo "expected 10 streamed samples, got $line_count"
  cat "$metrics_file"
  exit 1
fi

# Text output: shows sparkline + final value.
$cli curves --dir "$tmpdir" --id curves-run >/tmp/researchloop-curves-out.log 2>&1
grep -q "run: curves-run" /tmp/researchloop-curves-out.log
grep -q "metric: train_loss" /tmp/researchloop-curves-out.log
grep -q "samples: 10" /tmp/researchloop-curves-out.log
grep -q "final: 0.5" /tmp/researchloop-curves-out.log
grep -q "curve:" /tmp/researchloop-curves-out.log

# JSON output.
$cli curves --dir "$tmpdir" --id curves-run --format json >/tmp/researchloop-curves-json.log 2>&1
node -e '
const data = JSON.parse(require("fs").readFileSync("/tmp/researchloop-curves-json.log","utf8"));
if (data.run_id !== "curves-run") { console.error("bad run_id"); process.exit(1); }
if (!Array.isArray(data.series) || data.series.length !== 10) { console.error("bad series length"); process.exit(1); }
if (data.series[0].metric !== "train_loss") { console.error("bad metric name"); process.exit(1); }
if (data.series[9].step !== 10) { console.error("bad final step"); process.exit(1); }
'

# Invalid run id => error.
set +e
$cli curves --dir "$tmpdir" --id "../etc" >/tmp/researchloop-curves-bad.log 2>&1
bad_exit=$?
set -e
if [ "$bad_exit" -eq 0 ]; then
  echo "expected invalid run id to fail"
  exit 1
fi

# Missing --id => error.
set +e
$cli curves --dir "$tmpdir" >/tmp/researchloop-curves-missing.log 2>&1
miss_exit=$?
set -e
if [ "$miss_exit" -eq 0 ]; then
  echo "expected missing --id to fail"
  exit 1
fi
grep -q "missing --id" /tmp/researchloop-curves-missing.log

echo "autoresearch test:curves passed"
