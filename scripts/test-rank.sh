#!/usr/bin/env bash
set -e
cd /Users/vukrosic/my-life/autoresearch-ai

echo "=== Test G02 rank command ==="

FIXTURE=$(mktemp -d)
trap "rm -rf $FIXTURE" EXIT

mkdir -p "$FIXTURE/.researchloop/scratchpad"

# Create a proposals.jsonl with test proposals
cat > "$FIXTURE/.researchloop/scratchpad/proposals.jsonl" << 'EOF'
{"id":"prop_abc001","title":"LR warmup","hypothesis":"Warmup prevents gradient instability","change":"add warmup","metric":"val_loss","expected_direction":"lower","risk":"low","estimated_minutes":30,"mechanism":"lr_warmup","kill_criterion":"val_loss does not improve","created_at":"2026-05-18T00:00:00Z"}
{"id":"prop_abc002","title":"AdamW","hypothesis":"Better regularization","change":"use AdamW","metric":"val_loss","expected_direction":"lower","risk":"low","estimated_minutes":30,"mechanism":"optimizer_change","kill_criterion":"val_loss does not improve","created_at":"2026-05-18T00:00:00Z"}
{"id":"prop_abc003","title":"Bigger model","hypothesis":"More capacity","change":"double hidden","metric":"val_loss","expected_direction":"lower","risk":"high","estimated_minutes":240,"mechanism":"width_increase","kill_criterion":"val_loss does not improve","created_at":"2026-05-18T00:00:00Z"}
EOF

echo "--- Test 1: rank generates scored JSON output ---"
OUT1=$(node bin/researchloop.js rank --dir "$FIXTURE" 2>&1)
echo "$OUT1" | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)==3; assert all('score' in p for p in d); assert all('score_breakdown' in p for p in d); print('OK: got', len(d), 'ranked proposals')" || { echo "FAIL: rank output invalid"; exit 1; }

echo "--- Test 2: proposals are sorted by score desc ---"
echo "$OUT1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
scores = [p['score'] for p in d]
assert scores == sorted(scores, reverse=True), f'Not sorted: {scores}'
print('OK: proposals sorted by score descending')
"

echo "--- Test 3: score_breakdown has required keys ---"
echo "$OUT1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
required=['impact','cost','risk','novelty_vs_runs','why']
for p in d:
    for k in required:
        assert k in p['score_breakdown'], f'Missing: {k}'
print('OK: score_breakdown has all required keys')
"

echo "--- Test 4: rank --write creates ranked-proposals.jsonl and .md ---"
node bin/researchloop.js rank --write --dir "$FIXTURE" 2>&1
test -f "$FIXTURE/.researchloop/scratchpad/ranked-proposals.jsonl" || { echo "FAIL: ranked-proposals.jsonl not created"; exit 1; }
test -f "$FIXTURE/.researchloop/scratchpad/ranked-proposals.md" || { echo "FAIL: ranked-proposals.md not created"; exit 1; }
echo "OK: ranked output files created"

echo "--- Test 5: rank with --input flag ---"
# Write to FIXTURE and use relative path (resolved against --dir)
echo '{"id":"prop_x","title":"Test","hypothesis":"Test","change":"test","metric":"val_loss","expected_direction":"lower","risk":"low","estimated_minutes":10,"mechanism":"test","kill_criterion":"test","created_at":"2026-01-01T00:00:00Z"}' > "$FIXTURE/proposals.jsonl"
OUT5=$(node bin/researchloop.js rank --input "proposals.jsonl" --dir "$FIXTURE" 2>&1)
echo "$OUT5" | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)==1; print('OK: --input works')" || { echo "FAIL: --input flag broken"; exit 1; }

echo "--- Test 6: ranking is deterministic ---"
OUT6a=$(node bin/researchloop.js rank --dir "$FIXTURE" 2>&1)
OUT6b=$(node bin/researchloop.js rank --dir "$FIXTURE" 2>&1)
IDS6a=$(echo "$OUT6a" | python3 -c "import sys,json; print(','.join(p['id'] for p in json.load(sys.stdin)))")
IDS6b=$(echo "$OUT6b" | python3 -c "import sys,json; print(','.join(p['id'] for p in json.load(sys.stdin)))")
test "$IDS6a" = "$IDS6b" || { echo "FAIL: ranking not deterministic"; exit 1; }
echo "OK: ranking is deterministic"

echo "--- Test 7: missing proposals file shows error ---"
FIXTURE3=$(mktemp -d)
mkdir -p "$FIXTURE3/.researchloop"
OUT7=$(node bin/researchloop.js rank --dir "$FIXTURE3" 2>&1; echo "exit: $?")
echo "$OUT7"
echo "$OUT7" | grep -q "no proposals found" || { echo "FAIL: expected error about missing proposals"; exit 1; }
rm -rf "$FIXTURE3"

echo "=== All G02 rank tests passed ==="