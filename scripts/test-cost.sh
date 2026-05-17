#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/dev/null 2>&1

echo "=== Test 1: run records wall_seconds ==="
node ./bin/researchloop.js run --command "sleep 1 && echo val_loss=0.5" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
WALL=$(tail -1 "$tmpdir/.researchloop/scratchpad/runs.jsonl" | python3 -c "import json,sys; row=json.loads(sys.stdin.read()); print(row.get('wall_seconds', 'MISSING'))")
echo "wall_seconds: $WALL"
if [ "$WALL" = "MISSING" ] || [ -z "$WALL" ]; then
    echo "FAIL: wall_seconds not recorded"
    exit 1
fi
echo "PASS: wall_seconds recorded"

echo ""
echo "=== Test 2: cost.yaml produces est_cost_usd ==="
echo "gpu: H100
hourly_usd: 2.50" > "$tmpdir/.researchloop/cost.yaml"
node ./bin/researchloop.js run --command "sleep 2 && echo val_loss=0.6" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
COST=$(tail -1 "$tmpdir/.researchloop/scratchpad/runs.jsonl" | python3 -c "import json,sys; row=json.loads(sys.stdin.read()); print(row.get('est_cost_usd', 'MISSING'))")
echo "est_cost_usd: $COST"
if [ "$COST" = "MISSING" ] || [ -z "$COST" ]; then
    echo "FAIL: est_cost_usd not computed"
    exit 1
fi
echo "PASS: est_cost_usd computed ($COST)"

echo ""
echo "=== Test 3: no cost.yaml gives null est_cost_usd ==="
rm "$tmpdir/.researchloop/cost.yaml"
node ./bin/researchloop.js run --command "sleep 1 && echo val_loss=0.7" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
COST2=$(tail -1 "$tmpdir/.researchloop/scratchpad/runs.jsonl" | python3 -c "import json,sys; row=json.loads(sys.stdin.read()); print(row.get('est_cost_usd'))")
echo "est_cost_usd: $COST2"
if [ "$COST2" != "None" ]; then
    echo "FAIL: est_cost_usd should be null without cost.yaml, got $COST2"
    exit 1
fi
echo "PASS: est_cost_usd is null without cost.yaml"

echo ""
echo "ALL TESTS PASSED"