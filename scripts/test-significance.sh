#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

echo "=== G33: autoresearch significance ==="

$cli init --agent codex --dir "$tmpdir" >/dev/null

# Create two runs with curve data
cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"run-a","status":"completed","started_at":"2026-01-01T00:00:00Z","metrics":{"val_loss":0.42},"metric_history":{"val_loss":[0.60,0.55,0.50,0.46,0.44,0.43,0.42]}}
{"id":"run-b","status":"completed","started_at":"2026-01-01T00:01:00Z","metrics":{"val_loss":0.30},"metric_history":{"val_loss":[0.60,0.55,0.50,0.45,0.40,0.35,0.30]}}
EOF

echo "--- Test 1: Two clear runs with curves ---"
# Create two runs with curve data (run-b is clearly better)
printf '{"id":"run-a","status":"completed","metrics":{"val_loss":0.50},"metric_history":{"val_loss":[0.60,0.58,0.56,0.54,0.52,0.51,0.50]}}\n{"id":"run-b","status":"completed","metrics":{"val_loss":0.30},"metric_history":{"val_loss":[0.60,0.52,0.45,0.40,0.36,0.33,0.30]}}\n' > "$tmpdir/.researchloop/scratchpad/runs.jsonl"
output_curves=$($cli significance --id-a run-a --id-b run-b --metric val_loss --dir "$tmpdir" 2>&1)
echo "$output_curves"
echo "$output_curves" | grep -q "^val_loss: significant" || { echo "FAIL: expected significant"; echo "$output_curves"; exit 1; }
echo "PASS: curves test"

echo ""
echo "--- Test 2: Two identical runs (not significant) ---"
printf '{"id":"run-a","status":"completed","metrics":{"val_loss":0.42},"metric_history":{"val_loss":[0.42,0.42,0.42,0.42,0.42]}}\n{"id":"run-b","status":"completed","metrics":{"val_loss":0.42},"metric_history":{"val_loss":[0.42,0.42,0.42,0.42,0.42]}}\n' > "$tmpdir/.researchloop/scratchpad/runs.jsonl"
output_identical=$($cli significance --id-a run-a --id-b run-b --metric val_loss --dir "$tmpdir" 2>&1)
echo "$output_identical"
echo "$output_identical" | grep -q "not significant" || { echo "FAIL: expected not significant"; exit 1; }
echo "PASS: identical runs test"

echo ""
echo "--- Test 3: JSON output ---"
output_json=$($cli significance --id-a run-a --id-b run-b --metric val_loss --format json --dir "$tmpdir" 2>&1)
echo "$output_json" | python3 -c "import json,sys; r=json.load(sys.stdin); assert 'mean_diff' in r; assert 'p_value' in r; assert 'effect_size' in r" || { echo "FAIL: invalid JSON output"; exit 1; }
echo "PASS: JSON output"

echo ""
echo "--- Test 4: Markdown output ---"
output_md=$($cli significance --id-a run-a --id-b run-b --metric val_loss --format markdown --dir "$tmpdir" 2>&1)
echo "$output_md"
echo "$output_md" | grep -q "Significance Test" || { echo "FAIL: expected markdown header"; exit 1; }
echo "$output_md" | grep -q "Cohen" || { echo "FAIL: expected Cohen's d in output"; exit 1; }
echo "PASS: markdown output"

echo ""
echo "--- Test 5: Missing runs ---"
set +e
output_missing=$($cli significance --id-a run-a --id-b run-nonexistent --metric val_loss --dir "$tmpdir" 2>&1)
missing_exit=$?
set -e
if [ "$missing_exit" -eq 0 ]; then
  echo "FAIL: should fail when run not found"
  exit 1
fi
echo "$output_missing" | grep -q "not found" || { echo "FAIL: expected 'not found' error"; exit 1; }
echo "PASS: missing run detection"

echo ""
echo "autoresearch test:significance passed"