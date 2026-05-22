#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-preflight-init.log

# Set up a goal with metric + commands so preflight has something to check.
$cli goal --dir "$tmpdir" "improve val loss" \
  --metric val_loss --direction lower \
  --baseline 'printf "val_loss=1.0\n"' \
  --evaluation 'printf "val_loss=0.9\n"' >/tmp/autoresearch-preflight-goal.log

# Text format.
$cli preflight --dir "$tmpdir" >/tmp/autoresearch-preflight-text.log
grep -q "autoresearch preflight" /tmp/autoresearch-preflight-text.log
grep -q "command: " /tmp/autoresearch-preflight-text.log
grep -q "safety: " /tmp/autoresearch-preflight-text.log
grep -q "metric: val_loss" /tmp/autoresearch-preflight-text.log
grep -q "memory: " /tmp/autoresearch-preflight-text.log
grep -q "preflight: OK" /tmp/autoresearch-preflight-text.log

# JSON format.
$cli preflight --dir "$tmpdir" --format json >/tmp/autoresearch-preflight-json.log
grep -qE '"name":\s*"command"' /tmp/autoresearch-preflight-json.log
grep -qE '"ok":\s*true' /tmp/autoresearch-preflight-json.log

# Safety deny path should match run/eval policy behavior.
set +e
$cli preflight --dir "$tmpdir" --command "git --version" >/tmp/autoresearch-preflight-deny.log
deny_exit=$?
set -e
if [ "$deny_exit" -eq 0 ]; then
  echo "expected preflight to fail for disallowed command"
  exit 1
fi
grep -q "safety: allow_prefixes" /tmp/autoresearch-preflight-deny.log
grep -q "preflight: FAIL" /tmp/autoresearch-preflight-deny.log

# --require-gpu on a non-GPU host should fail.
set +e
$cli preflight --dir "$tmpdir" --require-gpu >/tmp/autoresearch-preflight-gpu.log
gpu_exit=$?
set -e
if [ "$gpu_exit" -eq 0 ]; then
  # Only fail the test if the host actually has no GPU. If nvidia-smi works, skip.
  if grep -q "no GPU detected" /tmp/autoresearch-preflight-gpu.log; then
    echo "expected --require-gpu to fail on non-GPU host"
    exit 1
  fi
fi

# Unreasonable disk requirement should fail.
set +e
$cli preflight --dir "$tmpdir" --min-disk-gb 999999 >/tmp/autoresearch-preflight-disk.log
disk_exit=$?
set -e
if [ "$disk_exit" -eq 0 ]; then
  echo "expected impossible --min-disk-gb to fail"
  exit 1
fi
grep -q "preflight: FAIL" /tmp/autoresearch-preflight-disk.log

echo "autoresearch test:preflight passed"
