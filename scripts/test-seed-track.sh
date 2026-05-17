#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

echo "=== G46: autoresearch seed-track ==="

$cli init --agent codex --dir "$tmpdir" >/dev/null

# Create a run to seed from
printf '{"id":"run-1","status":"completed","metrics":{"val_loss":0.42,"accuracy":0.85},"command":"python train.py --lr 3e-4","seed_group":null,"seed_value":null,"parent_id":null,"started_at":"2026-01-01T00:00:00Z"}\n' > "$tmpdir/.researchloop/scratchpad/runs.jsonl"

echo "--- Test 1: seed-track create ---"
$cli seed-track run-1 --seeds 3 --seed-flag "--seed" --dir "$tmpdir" 2>&1

# Check runs.jsonl has seed runs
seed_count=$(grep -c '"seed_group":"sg-' "$tmpdir/.researchloop/scratchpad/runs.jsonl" || echo 0)
echo "Seed runs created: $seed_count"
if [ "$seed_count" -ne 3 ]; then
  echo "FAIL: expected 3 seed runs, got $seed_count"
  exit 1
fi
echo "PASS: seed runs created"

echo ""
echo "--- Test 2: seed-track report ---"
output_report=$($cli seed-track report --id run-1 --metric val_loss --dir "$tmpdir" 2>&1)
echo "$output_report"
echo "$output_report" | grep -q "mean:" || { echo "FAIL: report should show mean"; exit 1; }
echo "$output_report" | grep -q "std:" || { echo "FAIL: report should show std"; exit 1; }
echo "PASS: seed-track report"

echo ""
echo "--- Test 3: seed runs have correct fields ---"
first_seed=$(grep "run-1-seed-1" "$tmpdir/.researchloop/scratchpad/runs.jsonl" | head -1)
echo "$first_seed" | grep -q '"seed_value":1' || { echo "FAIL: seed_value not set"; exit 1; }
echo "$first_seed" | grep -q '"seed_group"' || { echo "FAIL: seed_group not set"; exit 1; }
echo "$first_seed" | grep -q '"parent_id":"run-1"' || { echo "FAIL: parent_id not set"; exit 1; }
echo "PASS: seed runs have correct fields"

echo ""
echo "--- Test 4: seed-track without run id fails ---"
set +e
$cli seed-track --seeds 3 --dir "$tmpdir" 2>&1
fail_exit=$?
set -e
if [ "$fail_exit" -eq 0 ]; then
  echo "FAIL: should fail without run id"
  exit 1
fi
echo "PASS: seed-track fails without run id"

echo ""
echo "autoresearch test:seed-track passed"