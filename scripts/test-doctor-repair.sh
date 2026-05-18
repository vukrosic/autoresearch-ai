#!/usr/bin/env bash
set -e
cd /Users/vukrosic/my-life/autoresearch-ai

echo "=== Test G31 doctor --repair-plan ==="

# Test 1: minimal repo (missing Target Metric, Direction, eval.yaml, safety.yaml)
FIXTURE1=$(mktemp -d)
trap "rm -rf $FIXTURE1" EXIT
mkdir -p "$FIXTURE1/.researchloop/scratchpad"
cat > "$FIXTURE1/.researchloop/goal.md" << 'EOF'
Goal: Test goal

## Baseline Command
echo baseline
EOF

echo "--- Test 1: repair-plan on minimal repo ---"
OUT=$(node bin/researchloop.js doctor --repair-plan --dir "$FIXTURE1" 2>&1)
echo "$OUT"
echo "$OUT" | grep -q "P3.*goal.md" || { echo "FAIL: goal.md issues not caught"; exit 1; }
echo "$OUT" | grep -q "P3.*missing Target Metric" || { echo "FAIL: Target Metric check missing"; exit 1; }
echo "$OUT" | grep -q "P3.*missing Direction" || { echo "FAIL: Direction check missing"; exit 1; }
echo "$OUT" | grep -q "P3.*missing Baseline Command" && { echo "FAIL: should NOT flag Baseline Command when it exists"; exit 1; }
echo "$OUT" | grep -q "P4.*eval.yaml missing" || { echo "FAIL: eval.yaml check missing"; exit 1; }

# Test 2: complete repo (no issues)
FIXTURE2=$(mktemp -d)
trap "rm -rf $FIXTURE2" EXIT
mkdir -p "$FIXTURE2/.researchloop/scratchpad"
cat > "$FIXTURE2/.researchloop/goal.md" << 'EOF'
Goal: Test goal
Target Metric: val_loss
Direction: lower

## Baseline Command
echo baseline
EOF

cat > "$FIXTURE2/.researchloop/eval.yaml" << 'EOF'
metrics:
  - name: val_loss
    regex_or_jsonpath: "val_loss=([0-9.]+)"
eval_command: echo val_loss=0.42
EOF

cat > "$FIXTURE2/.researchloop/safety.yaml" << 'EOF'
allow_prefixes:
  - echo
deny_substrings: []
EOF

echo "--- Test 2: repair-plan on complete repo ---"
OUT2=$(node bin/researchloop.js doctor --repair-plan --dir "$FIXTURE2" 2>&1)
echo "$OUT2"
# goal.md checks should pass (no Target Metric/Direction/Baseline Command issues)
echo "$OUT2" | grep -q "missing Target Metric" && { echo "FAIL: Target Metric should be fine"; exit 1; }
echo "$OUT2" | grep -q "missing Direction" && { echo "FAIL: Direction should be fine"; exit 1; }
echo "$OUT2" | grep -q "goal.md missing Baseline Command" && { echo "FAIL: Baseline Command should be fine"; exit 1; }
echo "$OUT2" | grep -q "eval.yaml missing" && { echo "FAIL: eval.yaml should be fine"; exit 1; }

# Test 3: normal doctor still works (use fixture1 which has no issues from doctor's perspective)
echo "--- Test 3: doctor (no --repair-plan) still works ---"
OUT3=$(node bin/researchloop.js doctor --dir "$FIXTURE1" 2>&1)
echo "$OUT3"
echo "$OUT3" | grep -q "cwd:" || { echo "FAIL: normal doctor output broken"; exit 1; }
echo "$OUT3" | grep -q "Repair Plan" && { echo "FAIL: repair-plan leaked into normal doctor"; exit 1; }

# Test 4: no metric parsed from last run
FIXTURE4=$(mktemp -d)
trap "rm -rf $FIXTURE4" EXIT
mkdir -p "$FIXTURE4/.researchloop/scratchpad"
cat > "$FIXTURE4/.researchloop/goal.md" << 'EOF'
Goal: Test goal
Target Metric: val_loss
Direction: lower

## Baseline Command
echo baseline
EOF

cat > "$FIXTURE4/.researchloop/eval.yaml" << 'EOF'
metrics:
  - name: val_loss
    regex_or_jsonpath: "val_loss=([0-9.]+)"
eval_command: echo val_loss=0.42
EOF

cat > "$FIXTURE4/.researchloop/safety.yaml" << 'EOF'
allow_prefixes:
  - echo
deny_substrings: []
EOF

cat > "$FIXTURE4/.researchloop/scratchpad/runs.jsonl" << 'EOF'
{"id":"r1","status":"completed","metrics":{},"value":null,"timestamp":"2026-05-17T10:00:00Z"}
EOF

echo "--- Test 4: repair-plan detects no metric parsed ---"
OUT4=$(node bin/researchloop.js doctor --repair-plan --dir "$FIXTURE4" 2>&1)
echo "$OUT4"
echo "$OUT4" | grep -q "No metric parsed from last run" || { echo "FAIL: no metric check missing"; exit 1; }

echo "=== All G31 doctor --repair-plan tests passed ==="