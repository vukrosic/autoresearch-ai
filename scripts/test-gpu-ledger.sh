#!/usr/bin/env bash
set -euo pipefail

# This test exercises the GPU-ledger code path on machines WITHOUT a GPU.
# nvidia-smi is expected to fail / be absent here, so gpu_present should be
# false on the recorded row and `compare` should not emit GPU summary lines.
# A separate manual test is required on real GPU hardware to confirm peak
# memory / max util / gpu_hours are recorded.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-gpu-init.log
"${cli[@]}" run --dir "$tmpdir" --id r1 --command 'printf "val_loss=0.5\n"' --metric val_loss >/tmp/autoresearch-gpu-run.log
"${cli[@]}" run --dir "$tmpdir" --id cuda-env \
  --command 'node -e "console.log(\"device=\" + process.env.RESEARCHLOOP_DEVICE); console.log(\"visible=\" + process.env.CUDA_VISIBLE_DEVICES); console.log(\"val_loss=0.4\")"' \
  --metric val_loss \
  --device cuda \
  --cuda-visible-devices 0 \
  >/tmp/autoresearch-gpu-cuda-env.log
grep -q 'device=cuda' /tmp/autoresearch-gpu-cuda-env.log
grep -q 'visible=0' /tmp/autoresearch-gpu-cuda-env.log

ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
test -f "$ledger"

# Row must include all GPU fields, even when no GPU is present.
grep -q '"gpu_present":' "$ledger"
grep -q '"gpu_util_max_pct":' "$ledger"
grep -q '"gpu_memory_peak_mb":' "$ledger"
grep -q '"gpu_hours":' "$ledger"
grep -q '"wall_seconds":' "$ledger"
grep -q '"compute_device":"cuda"' "$ledger"

# system.jsonl in the run artifact dir should exist (sampler ran at least once).
test -f "$tmpdir/.researchloop/scratchpad/runs/r1/system.jsonl"

# compare should NOT emit gpu_runs lines when no run has gpu_present=true.
"${cli[@]}" compare --dir "$tmpdir" --metric val_loss --direction lower >/tmp/autoresearch-gpu-compare.log
if grep -q "gpu_runs:" /tmp/autoresearch-gpu-compare.log; then
  echo "expected no gpu_runs line on non-GPU host"
  exit 1
fi

echo "autoresearch test:gpu-ledger passed (no-GPU host path)"
