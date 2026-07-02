#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-retry-init.log
$cli goal --dir "$tmpdir" "lower training loss" \
  --metric train_loss --direction lower \
  --baseline "printf 'train_loss=1.0\n'" \
  --evaluation "printf 'train_loss=1.0\n'" \
  >/tmp/researchloop-retry-goal.log

# eval.yaml with an OOM retry rule that halves --batch_size.
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop: []
gates: []
retry:
  - {match: "CUDA out of memory", transform: "halve:batch_size", max_retries: 2}
YAML

# Fake training script: first run prints "CUDA out of memory" and exits non-zero;
# second run (after attempt counter increments) succeeds with train_loss=0.4.
# Attempt counter lives in $tmpdir/.attempts.
counter="$tmpdir/.attempts"
echo 0 > "$counter"

script=$(cat <<EOF
n=\$(cat "$counter")
n=\$((n + 1))
echo "\$n" > "$counter"
if [ "\$n" -le 1 ]; then
  echo "RuntimeError: CUDA out of memory. Tried to allocate 8 GB"
  exit 1
fi
echo "train_loss=0.40"
EOF
)

$cli run --dir "$tmpdir" --id oom-run --command "bash -c '$script' --batch_size 64" \
  --timeout 30 >/tmp/researchloop-retry-out.log 2>&1
cat /tmp/researchloop-retry-out.log >&2

# Final status of the retry attempt should be "complete".
grep -q "retry: rule matched" /tmp/researchloop-retry-out.log
grep -q "change: batch_size: 64 -> 32" /tmp/researchloop-retry-out.log
grep -q "next attempt: 1/2" /tmp/researchloop-retry-out.log

# Ledger should now have two rows: the original failed one + the retry success.
fail_count=$(grep -c '"id":"oom-run"' "$tmpdir/.researchloop/scratchpad/runs.jsonl")
retry_count=$(grep -c '"id":"oom-run-retry1"' "$tmpdir/.researchloop/scratchpad/runs.jsonl")
if [ "$fail_count" -ne 1 ] || [ "$retry_count" -ne 1 ]; then
  echo "expected one row each for oom-run and oom-run-retry1"
  cat "$tmpdir/.researchloop/scratchpad/runs.jsonl"
  exit 1
fi

grep -q '"id":"oom-run".*"status":"failed"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"id":"oom-run".*"retry_reason"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"id":"oom-run-retry1".*"status":"complete"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"id":"oom-run-retry1".*"retry_of":"oom-run"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"id":"oom-run-retry1".*"parent_id":"oom-run"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

# --- Case 2: max_retries: 0 disables retries -----------------------------
echo 0 > "$counter"
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop: []
gates: []
retry:
  - {match: "CUDA out of memory", transform: "halve:batch_size", max_retries: 0}
YAML

set +e
$cli run --dir "$tmpdir" --id oom-norun --command "bash -c '$script' --batch_size 64" \
  --timeout 30 >/tmp/researchloop-retry-disabled.log 2>&1
no_retry_exit=$?
set -e
if [ "$no_retry_exit" -eq 0 ]; then
  echo "expected single failed run when max_retries=0"
  exit 1
fi
if grep -q "retry: rule matched" /tmp/researchloop-retry-disabled.log; then
  echo "max_retries=0 should not trigger any retry"
  exit 1
fi
if grep -q '"id":"oom-norun-retry1"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"; then
  echo "should not have written a retry row when max_retries=0"
  exit 1
fi

# --- Case 3: no retry rule matches -> single failed row -------------------
echo 0 > "$counter"
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop: []
gates: []
retry: []
YAML

set +e
$cli run --dir "$tmpdir" --id oom-nor --command "bash -c '$script' --batch_size 64" \
  --timeout 30 >/tmp/researchloop-retry-empty.log 2>&1
set -e
if grep -q "retry: rule matched" /tmp/researchloop-retry-empty.log; then
  echo "no retry rules: should not trigger"
  exit 1
fi

echo "autoresearch test:retry passed"
