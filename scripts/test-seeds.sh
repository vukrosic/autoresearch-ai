#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-seeds-init.log
"${cli[@]}" goal --dir "$tmpdir" "lower val loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.0\n'" \
  --evaluation "printf 'val_loss=1.0\n'" >/tmp/autoresearch-seeds-goal.log

# {seed} placeholder substitution: emits val_loss=1.0, 1.1, 1.2 across seeds 0/1/2.
"${cli[@]}" run --dir "$tmpdir" --id mr --seeds 3 \
  --command 'printf "val_loss=1.{seed}\n"' \
  >/tmp/autoresearch-seeds-run.log

grep -q "autoresearch run --seeds 3" /tmp/autoresearch-seeds-run.log
grep -q "runs: 3/3" /tmp/autoresearch-seeds-run.log
grep -q "val_loss: mean=" /tmp/autoresearch-seeds-run.log
grep -q "recorded: mr" /tmp/autoresearch-seeds-run.log

# Child rows + aggregator row exist.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
test -f "$ledger"
grep -q '"id":"mr-seed0"' "$ledger"
grep -q '"id":"mr-seed1"' "$ledger"
grep -q '"id":"mr-seed2"' "$ledger"
grep -q '"id":"mr"' "$ledger"
grep -q '"seeds":' "$ledger"
grep -q '"val_loss_std":' "$ledger"

# Confirm mean is correct (mean of 1.0, 1.1, 1.2 = 1.1).
grep -q '"val_loss":1.1,"val_loss_std":' "$ledger"

# RESEARCHLOOP_SEED env var also exposed to the child shell — verify by using $RESEARCHLOOP_SEED.
"${cli[@]}" run --dir "$tmpdir" --id env --seeds 2 \
  --command 'printf "val_loss=0.${RESEARCHLOOP_SEED}\n"' \
  >/tmp/autoresearch-seeds-env.log
grep -q "runs: 2/2" /tmp/autoresearch-seeds-env.log
grep -q '"id":"env-seed0"' "$ledger"
grep -q '"id":"env-seed1"' "$ledger"

echo "autoresearch test:seeds passed"
