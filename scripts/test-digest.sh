#!/usr/bin/env bash
set -e
cd /Users/vukrosic/my-life/autoresearch-ai

echo "=== Test G51 digest ==="

FIXTURE=$(mktemp -d)
trap "rm -rf $FIXTURE" EXIT

mkdir -p "$FIXTURE/.researchloop/scratchpad"

# Current time: 2026-05-17T23:46:33Z
# Timestamps relative to now (all dates before now so they're inside the windows):
#   run-00001: 2026-05-14T10:00:00Z  = 3+ days ago = outside all windows
#   run-00002: 2026-05-15T10:00:00Z  = 2+ days ago = outside all windows
#   run-00003: 2026-05-16T08:00:00Z  = ~39h ago    = inside 48h, outside 24h
#   run-00004: 2026-05-16T20:00:00Z  = ~28h ago    = inside 48h, outside 24h
#   run-00005: 2026-05-17T20:00:00Z  = ~4h ago     = inside 24h
#   run-00006: 2026-05-17T22:00:00Z  = ~2h ago     = inside 24h
cat > "$FIXTURE/.researchloop/scratchpad/runs.jsonl" << 'EOF'
{"id":"run-00001","status":"completed","metrics":{"value":0.41},"value":0.41,"timestamp":"2026-05-14T10:00:00Z","wall_seconds":120,"est_cost_usd":0.05}
{"id":"run-00002","status":"completed","metrics":{"value":0.31},"value":0.31,"timestamp":"2026-05-15T10:00:00Z","wall_seconds":200,"est_cost_usd":0.08}
{"id":"run-00003","status":"failed","metrics":{"value":null},"value":null,"timestamp":"2026-05-16T08:00:00Z","wall_seconds":30,"est_cost_usd":0.01}
{"id":"run-00004","status":"completed","metrics":{"value":0.25},"value":0.25,"timestamp":"2026-05-16T20:00:00Z","wall_seconds":150,"est_cost_usd":0.06}
{"id":"run-00005","status":"completed","metrics":{"value":0.55},"value":0.55,"timestamp":"2026-05-17T20:00:00Z","wall_seconds":180,"est_cost_usd":0.07}
{"id":"run-00006","status":"running","metrics":{"value":0.99},"value":0.99,"timestamp":"2026-05-17T23:30:00Z","wall_seconds":10,"est_cost_usd":0.005}
EOF

echo "--- Test 1: digest last 24h (from 2026-05-17T23:46:33Z) ---"
# cutoff = 2026-05-16T23:46:33Z
# Inside 24h: run-00005 (completed, ~4h ago), run-00006 (running, ~2h ago) = 2 total, 1 completed, 0 failed
OUT=$(node bin/researchloop.js digest --since 24h --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT"
echo "$OUT" | grep -q "Runs total | 2" || { echo "FAIL: expected 2 runs in 24h"; exit 1; }
echo "$OUT" | grep -q "Completed | 1" || { echo "FAIL: expected 1 completed"; echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "Failed | 0" || { echo "FAIL: expected 0 failed in 24h"; echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "Best metric | 0.9900" || { echo "FAIL: best metric should be 0.99 (from running)"; echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "Total wall time | 190s" || { echo "FAIL: wall time should be 190s"; echo "$OUT"; exit 1; }

echo "--- Test 2: digest --since 48h ---"
# cutoff = 2026-05-15T23:46:33Z
# Inside 48h: run-00003 (failed), run-00004 (completed), run-00005 (completed), run-00006 (running) = 4 total, 2 completed, 1 failed
OUT2=$(node bin/researchloop.js digest --since 48h --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT2"
echo "$OUT2" | grep -q "Runs total | 4" || { echo "FAIL: expected 4 runs in 48h"; echo "$OUT2"; exit 1; }
echo "$OUT2" | grep -q "Completed | 2" || { echo "FAIL: expected 2 completed in 48h"; echo "$OUT2"; exit 1; }
echo "$OUT2" | grep -q "Failed | 1" || { echo "FAIL: expected 1 failed in 48h"; echo "$OUT2"; exit 1; }

echo "--- Test 3: digest --since 72h ---"
# cutoff = 2026-05-14T23:46:33Z
# Inside 72h: run-00002 through run-00006 = 5 total (run-00001 at 2026-05-14T10 is before cutoff, excluded)
OUT3=$(node bin/researchloop.js digest --since 72h --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT3"
echo "$OUT3" | grep -q "Runs total | 5" || { echo "FAIL: expected 5 runs in 72h"; echo "$OUT3"; exit 1; }
echo "$OUT3" | grep -q "Completed | 3" || { echo "FAIL: expected 3 completed in 72h"; echo "$OUT3"; exit 1; }

echo "--- Test 4: digest --format json ---"
OUT4=$(node bin/researchloop.js digest --since 24h --now 2026-05-17T23:46:33Z --format json --dir "$FIXTURE" 2>&1)
echo "$OUT4"
echo "$OUT4" | python3 -c "
import sys, json, math
d = json.load(sys.stdin)
assert d['totalRuns'] == 2, f\"totalRuns got {d['totalRuns']}\"
assert d['completed'] == 1, f\"completed got {d['completed']}\"
assert d['failed'] == 0, f\"failed got {d['failed']}\"
assert math.isclose(d.get('totalEstimatedCost', 0), 0.075, rel_tol=1e-9), f\"cost got {d.get('totalEstimatedCost')}\"
print('JSON OK')
"

echo "--- Test 5: digest --since 1h (very recent only) ---"
# cutoff = 2026-05-17T22:46:33Z
# Inside 1h: run-00006 only = 1 total, 0 completed (running), 0 failed
OUT5=$(node bin/researchloop.js digest --since 1h --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT5"
echo "$OUT5" | grep -q "Runs total | 1" || { echo "FAIL: expected 1 run in 1h"; echo "$OUT5"; exit 1; }
echo "$OUT5" | grep -q "Completed | 0" || { echo "FAIL: expected 0 completed in 1h (run is running)"; echo "$OUT5"; exit 1; }
echo "$OUT5" | grep -q "Failed | 0" || { echo "FAIL: expected 0 failed in 1h"; echo "$OUT5"; exit 1; }

echo "--- Test 6: digest --since 2h ---"
# cutoff = 2026-05-17T21:46:33Z
# Inside 2h: run-00006 only = 1 total, 0 completed (running), 0 failed
OUT6=$(node bin/researchloop.js digest --since 2h --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT6"
echo "$OUT6" | grep -q "Runs total | 1" || { echo "FAIL: expected 1 run in 2h"; echo "$OUT6"; exit 1; }
echo "$OUT6" | grep -q "Completed | 0" || { echo "FAIL: expected 0 completed in 2h (only run-00006 is running)"; echo "$OUT6"; exit 1; }

echo "--- Test 7: empty period ---"
# cutoff = now - 10m; run-00006 is at 23:30, now is ~23:50 (20min ago) so it's outside 10m window
OUT7=$(node bin/researchloop.js digest --since 10m --now 2026-05-17T23:46:33Z --dir "$FIXTURE" 2>&1)
echo "$OUT7"
echo "$OUT7" | grep -q "No runs in the last 10m" || { echo "FAIL: expected empty digest"; echo "$OUT7"; exit 1; }

echo "=== All G51 digest tests passed ==="