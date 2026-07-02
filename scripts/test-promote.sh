#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-promote-init.log
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=0.50\n'" \
  --evaluation "printf 'val_loss=0.50\n'" \
  >/tmp/researchloop-promote-goal.log

# Run a winning experiment.
$cli run --dir "$tmpdir" --id winner-1 --command "printf 'val_loss=0.30\n'" \
  --timeout 30 >/tmp/researchloop-promote-run.log 2>&1
grep -q "status: complete" /tmp/researchloop-promote-run.log

# Promote it.
$cli promote --dir "$tmpdir" --id winner-1 --note "best so far" \
  >/tmp/researchloop-promote-out.log 2>&1
grep -q "promoted: winner-1" /tmp/researchloop-promote-out.log
grep -q "files:" /tmp/researchloop-promote-out.log

# Verify winners/<id>/ has the expected files.
winners="$tmpdir/.researchloop/winners/winner-1"
[ -f "$winners/PROMOTION.md" ] || { echo "missing PROMOTION.md"; exit 1; }
[ -f "$winners/row.json" ]      || { echo "missing row.json"; exit 1; }
[ -f "$winners/command.txt" ]   || { echo "missing command.txt"; exit 1; }
[ -f "$winners/env.json" ]      || { echo "missing env.json"; exit 1; }
[ -f "$winners/config.json" ]   || { echo "missing config.json"; exit 1; }
[ -f "$winners/MANIFEST.json" ] || { echo "missing MANIFEST.json"; exit 1; }
grep -q "best so far" "$winners/PROMOTION.md"
grep -q "val_loss" "$winners/PROMOTION.md"

# Row in the ledger flipped to "promoted" + has gate_reasons.
grep -q '"id":"winner-1"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"status":"promoted"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"promoted_at"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"promotion_note":"best so far"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

# A failed run cannot be promoted without --force.
$cli run --dir "$tmpdir" --id failed-1 --command "printf 'val_loss=0.99\n' ; exit 7" \
  --timeout 30 >/tmp/researchloop-promote-fail.log 2>&1 || true
grep -q "status: failed" /tmp/researchloop-promote-fail.log

set +e
$cli promote --dir "$tmpdir" --id failed-1 >/tmp/researchloop-promote-block.log 2>&1
block_exit=$?
set -e
if [ "$block_exit" -eq 0 ]; then
  echo "expected promote of failed run to be blocked without --force"
  exit 1
fi
grep -q '"failed"' /tmp/researchloop-promote-block.log

# --force bypasses the block.
$cli promote --dir "$tmpdir" --id failed-1 --force \
  >/tmp/researchloop-promote-force.log 2>&1
grep -q "promoted: failed-1" /tmp/researchloop-promote-force.log

# Missing --id fails.
set +e
$cli promote --dir "$tmpdir" >/tmp/researchloop-promote-noid.log 2>&1
noid_exit=$?
set -e
if [ "$noid_exit" -eq 0 ]; then
  echo "expected promote without --id to fail"
  exit 1
fi
grep -q "missing --id" /tmp/researchloop-promote-noid.log

# Unknown run id fails.
set +e
$cli promote --dir "$tmpdir" --id does-not-exist >/tmp/researchloop-promote-unknown.log 2>&1
unk_exit=$?
set -e
if [ "$unk_exit" -eq 0 ]; then
  echo "expected promote of unknown id to fail"
  exit 1
fi
grep -q "no run found" /tmp/researchloop-promote-unknown.log

echo "autoresearch test:promote passed"
