#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-loop-init.log

# Counter trick: each iteration appends to a file, output reads line count → strictly decreasing metric.
state="$tmpdir/counter"
echo "" > "$state"

# Simulate improving metric across iterations via a bash one-liner.
# Iteration N produces val_loss = 1.0 / (N+1).
"${cli[@]}" loop --dir "$tmpdir" --id l1 --iters 3 \
  --command "echo tick >> \"$state\"; n=\$(wc -l < \"$state\"); awk -v n=\"\$n\" 'BEGIN{printf \"val_loss=%.4f\\n\", 1.0/n}'" \
  --metric val_loss --direction lower \
  >/tmp/autoresearch-loop-out.log

grep -q "autoresearch loop" /tmp/autoresearch-loop-out.log
grep -q "iters: 3" /tmp/autoresearch-loop-out.log
grep -q "iterations: 3" /tmp/autoresearch-loop-out.log
# First iter is always a win (no prior best).
grep -q "WIN" /tmp/autoresearch-loop-out.log
grep -q "wins: " /tmp/autoresearch-loop-out.log
grep -q "best: l1-iter" /tmp/autoresearch-loop-out.log

# Loop state file persists.
test -f "$tmpdir/.researchloop/scratchpad/loop_state.json"
grep -qE '"loop_id":\s*"l1"' "$tmpdir/.researchloop/scratchpad/loop_state.json"

# Each iteration recorded a run.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"id":"l1-iter0"' "$ledger"
grep -q '"id":"l1-iter1"' "$ledger"
grep -q '"id":"l1-iter2"' "$ledger"

echo "autoresearch test:loop passed"
