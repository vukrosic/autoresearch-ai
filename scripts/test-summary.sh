#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node ./bin/researchloop.js"

echo "--- summary suggests init for a blank folder ---"
$cli summary --dir "$tmpdir" --format json >/tmp/researchloop-summary-blank.json
python3 -c '
import json
d = json.load(open("/tmp/researchloop-summary-blank.json"))
assert d["initialized"] is False
assert d["next_action"]["command"] == "autoresearch init --agent codex"
'

mkdir -p "$tmpdir/.researchloop/scratchpad"
cat > "$tmpdir/.researchloop/goal.md" <<'EOF'
# Goal
lower validation loss

metric: val_loss
direction: lower
EOF

echo "--- summary asks for baseline before experiments ---"
$cli summary --dir "$tmpdir" >/tmp/researchloop-summary-missing-baseline.log
grep -q "Next action:" /tmp/researchloop-summary-missing-baseline.log
grep -q "autoresearch baseline-status" /tmp/researchloop-summary-missing-baseline.log

cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"baseline-real","status":"complete","agent":"autoresearch baseline","metrics":{"val_loss":1.00},"timestamp":"2026-05-21T00:00:00Z"}
EOF

echo "--- summary recognizes real baseline rows and does not review them as experiments ---"
$cli summary --dir "$tmpdir" --format json >/tmp/researchloop-summary-baseline-only.json
python3 -c '
import json
d = json.load(open("/tmp/researchloop-summary-baseline-only.json"))
assert d["baseline"]["id"] == "baseline-real"
assert d["best"] is None
assert d["n_evaluable_runs"] == 0
assert d["next_action"]["command"] == "autoresearch propose --n 5 --write --with-priors"
'

cat > "$tmpdir/.researchloop/scratchpad/proposals.jsonl" <<'EOF'
{"id":"proposal-warmup","status":"open","mechanism":"short warmup"}
EOF

echo "--- summary ranks open proposals before making a runbook ---"
$cli summary --dir "$tmpdir" --format json >/tmp/researchloop-summary-proposals.json
python3 -c '
import json
d = json.load(open("/tmp/researchloop-summary-proposals.json"))
assert d["proposals"]["open"] == 1
assert d["next_action"]["command"] == "autoresearch rank --write"
'

cat > "$tmpdir/.researchloop/scratchpad/ranked-proposals.jsonl" <<'EOF'
{"id":"proposal-warmup","score":0.82}
EOF

echo "--- summary turns ranked proposals into next-experiment ---"
$cli summary --dir "$tmpdir" --out "$tmpdir/summary.md" >/tmp/researchloop-summary-ranked.log
grep -q "autoresearch next-experiment --write" /tmp/researchloop-summary-ranked.log
grep -q "autoresearch next-experiment --write" "$tmpdir/summary.md"

cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"baseline","status":"complete","tags":["baseline"],"metrics":{"val_loss":1.00},"timestamp":"2026-05-21T00:00:00Z"}
{"id":"run-active","status":"running","metrics":{"val_loss":0.91},"timestamp":"2026-05-21T00:05:00Z"}
{"id":"manual-note","status":"recorded","metrics":{"val_loss":0.90},"timestamp":"2026-05-21T00:10:00Z"}
EOF
: > "$tmpdir/.researchloop/scratchpad/proposals.jsonl"
: > "$tmpdir/.researchloop/scratchpad/ranked-proposals.jsonl"

echo "--- summary prioritizes active runs ---"
$cli status --dir "$tmpdir" --format json >/tmp/researchloop-summary-active.json
python3 -c '
import json
d = json.load(open("/tmp/researchloop-summary-active.json"))
assert d["n_active"] == 1
assert d["active_runs"][0]["id"] == "run-active"
assert d["next_action"]["command"] == "autoresearch tail run-active --metrics --lines 20"
'
$cli status --dir "$tmpdir" >/tmp/researchloop-summary-active.log
grep -q "autoresearch tail run-active --metrics --lines 20" /tmp/researchloop-summary-active.log

cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"baseline","status":"complete","tags":["baseline"],"metrics":{"val_loss":1.00},"timestamp":"2026-05-21T00:00:00Z"}
{"id":"run-failed","status":"failed","metrics":{"val_loss":0.95},"kill_reason":"CUDA out of memory","timestamp":"2026-05-21T00:10:00Z"}
EOF

echo "--- summary highlights blockers ---"
$cli summary --dir "$tmpdir" >/tmp/researchloop-summary-blocker.log
grep -q "autoresearch tail run-failed --lines 80" /tmp/researchloop-summary-blocker.log

cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"baseline","status":"complete","tags":["baseline"],"metrics":{"val_loss":1.00},"timestamp":"2026-05-21T00:00:00Z"}
{"id":"run-discarded","status":"discarded","metrics":{"val_loss":0.10},"timestamp":"2026-05-21T00:15:00Z"}
{"id":"run-best","status":"complete","metrics":{"val_loss":0.87},"timestamp":"2026-05-21T00:20:00Z"}
EOF

echo "--- summary reviews the current best run ---"
$cli summary --dir "$tmpdir" --format json >/tmp/researchloop-summary-best.json
python3 -c '
import json
d = json.load(open("/tmp/researchloop-summary-best.json"))
assert d["best"]["id"] == "run-best"
assert d["best"]["id"] != "run-discarded"
assert d["next_action"]["command"] == "autoresearch review --id run-best"
'

echo "autoresearch test:summary passed"
