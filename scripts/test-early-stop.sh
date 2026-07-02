#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

# --- Setup ----------------------------------------------------------------
$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-earlystop-init.log
$cli goal --dir "$tmpdir" "lower training loss" \
  --metric train_loss --direction lower \
  --baseline "printf 'train_loss=1.00\ntrain_loss=0.95\ntrain_loss=0.90\n'" \
  --evaluation "printf 'train_loss=1.00\ntrain_loss=0.95\ntrain_loss=0.90\n'" \
  >/tmp/researchloop-earlystop-goal.log

# Establish a baseline so >Nx_baseline rules have a reference value.
$cli baseline --dir "$tmpdir" --id baseline-ok >/tmp/researchloop-earlystop-baseline.log 2>&1
grep -q "status: complete" /tmp/researchloop-earlystop-baseline.log
grep -q "train_loss: 0.9" /tmp/researchloop-earlystop-baseline.log

# --- Case 1: NaN early-stop ----------------------------------------------
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop:
  - {metric: train_loss, rule: nan_or_inf, action: kill}
gates: []
YAML

# A "training script" that emits 3 normal values then a NaN, then sleeps a long
# time. If early-stop works, the run is killed within ~2s of the NaN line and
# the long sleep is never observed.
nan_script="printf 'train_loss=0.95\n'; sleep 0.2; printf 'train_loss=0.90\n'; sleep 0.2; printf 'train_loss=nan\n'; sleep 30; printf 'EARLY_STOP_LEAK_NAN\n'"

set +e
start_ts=$(date +%s)
$cli run --dir "$tmpdir" --id nan-run --command "$nan_script" --timeout 60 >/tmp/researchloop-earlystop-nan.log 2>&1
nan_exit=$?
end_ts=$(date +%s)
set -e

if [ "$nan_exit" -eq 0 ]; then
  echo "expected NaN early-stop to exit non-zero"
  cat /tmp/researchloop-earlystop-nan.log
  exit 1
fi
elapsed=$((end_ts - start_ts))
if [ "$elapsed" -ge 20 ]; then
  echo "expected NaN early-stop to fire within ~10s; took ${elapsed}s"
  exit 1
fi

grep -q "status: killed_by_rule" /tmp/researchloop-earlystop-nan.log
grep -q "kill_reason: nan_or_inf train_loss" /tmp/researchloop-earlystop-nan.log
grep -q '"status":"killed_by_rule"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"kill_reason":"nan_or_inf train_loss"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
if grep -qE "^EARLY_STOP_LEAK_NAN$" /tmp/researchloop-earlystop-nan.log; then
  echo "child process should have been killed before reaching the trailing marker"
  exit 1
fi

# Verify live metrics.jsonl was streamed (G06 minimal).
metrics_file="$tmpdir/.researchloop/scratchpad/runs/nan-run/metrics.jsonl"
if [ ! -s "$metrics_file" ]; then
  echo "expected metrics.jsonl to be populated for nan-run"
  exit 1
fi
lines_before_nan=$(wc -l < "$metrics_file")
if [ "$lines_before_nan" -lt 3 ]; then
  echo "expected at least 3 streamed metric samples in metrics.jsonl, got $lines_before_nan"
  cat "$metrics_file"
  exit 1
fi

# --- Case 2: >Nx_baseline_after_step_K early-stop -------------------------
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop:
  - {metric: train_loss, rule: ">10x_baseline_after_step_1", action: kill}
gates: []
YAML

# Baseline final value above was ~0.90. Emit 0.95 (1st), then 99.0 (way > 10x).
diverge_script="printf 'train_loss=0.95\n'; sleep 0.2; printf 'train_loss=99.0\n'; sleep 30; printf 'EARLY_STOP_LEAK_DIVERGE\n'"

set +e
$cli run --dir "$tmpdir" --id diverge-run --command "$diverge_script" --timeout 60 >/tmp/researchloop-earlystop-diverge.log 2>&1
diverge_exit=$?
set -e
if [ "$diverge_exit" -eq 0 ]; then
  echo "expected divergence early-stop to exit non-zero"
  cat /tmp/researchloop-earlystop-diverge.log
  exit 1
fi
grep -q "status: killed_by_rule" /tmp/researchloop-earlystop-diverge.log
grep -q "kill_reason: >10x_baseline train_loss" /tmp/researchloop-earlystop-diverge.log

# --- Case 3: Normal run is not affected -----------------------------------
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop:
  - {metric: train_loss, rule: nan_or_inf, action: kill}
gates: []
YAML

normal_script="printf 'train_loss=0.95\ntrain_loss=0.90\ntrain_loss=0.85\n'"
$cli run --dir "$tmpdir" --id normal-run --command "$normal_script" --timeout 30 >/tmp/researchloop-earlystop-normal.log 2>&1
grep -q "status: complete" /tmp/researchloop-earlystop-normal.log
grep -q "train_loss: 0.85" /tmp/researchloop-earlystop-normal.log

echo "autoresearch test:early-stop passed"
