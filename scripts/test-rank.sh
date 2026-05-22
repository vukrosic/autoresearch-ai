#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
tmpempty="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$tmpempty"' EXIT

cli="node $repo_root/bin/researchloop.js"
fixture_dir="$repo_root/examples/fixtures/proposals"
ranked_path="$tmpdir/.researchloop/scratchpad/ranked-proposals.jsonl"
ranked_md="$tmpdir/.researchloop/scratchpad/ranked-proposals.md"

echo "=== Test G02 rank command ==="

cp -R "$fixture_dir/." "$tmpdir/"

echo "--- Test 1: rank generates scored JSON output ---"
OUT1="$($cli rank --dir "$tmpdir")"
printf '%s\n' "$OUT1" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
assert isinstance(rows, list)
assert len(rows) == 4, len(rows)
assert all("score" in row for row in rows)
assert all("score_breakdown" in row for row in rows)
print("OK: got", len(rows), "ranked proposals")
' || { echo "FAIL: rank output invalid"; exit 1; }

echo "--- Test 2: proposals are sorted by score desc ---"
printf '%s\n' "$OUT1" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
scores = [row["score"] for row in rows]
assert scores == sorted(scores, reverse=True), f"Not sorted: {scores}"
print("OK: proposals sorted by score descending")
' || { echo "FAIL: proposals not sorted"; exit 1; }

echo "--- Test 3: score_breakdown has required keys and novelty is low for best-run copy ---"
printf '%s\n' "$OUT1" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
required = ["impact", "cost", "risk", "novelty_vs_runs", "evidence", "why"]
best_run_copy = None
paper_warmup = None
generic_attention = None
for row in rows:
    for key in required:
        assert key in row["score_breakdown"], f"Missing: {key}"
    assert row["score_breakdown"]["why"], "why is empty"
    if row["id"] == "prop_best_run_copy":
        best_run_copy = row
    if row["id"] == "prop_paper_warmup":
        paper_warmup = row
    if row["id"] == "prop_generic_attention":
        generic_attention = row
assert best_run_copy is not None, "best-run copy proposal missing"
assert best_run_copy["score_breakdown"]["novelty_vs_runs"] <= 0.2, best_run_copy["score_breakdown"]["novelty_vs_runs"]
assert paper_warmup is not None and generic_attention is not None
assert paper_warmup["score_breakdown"]["evidence"] > generic_attention["score_breakdown"]["evidence"]
print("OK: score_breakdown keys present, evidence is scored, and best-run copy is low novelty")
' || { echo "FAIL: score_breakdown validation failed"; exit 1; }

echo "--- Test 4: rank --write creates ranked-proposals.jsonl and .md ---"
$cli rank --write --dir "$tmpdir" >/tmp/researchloop-rank-write.log
test -f "$ranked_path" || { echo "FAIL: ranked-proposals.jsonl not created"; exit 1; }
test -f "$ranked_md" || { echo "FAIL: ranked-proposals.md not created"; exit 1; }
grep -q "^# Ranked Proposals$" "$ranked_md"
line_count="$(wc -l < "$ranked_path" | tr -d ' ')"
test "$line_count" -eq 4 || { echo "FAIL: expected 4 ranked rows, got $line_count"; exit 1; }
echo "OK: ranked output files created"

echo "--- Test 5: ranking is deterministic ---"
OUT5A="$($cli rank --dir "$tmpdir")"
OUT5B="$($cli rank --dir "$tmpdir")"
IDS5A="$(printf '%s\n' "$OUT5A" | python3 -c 'import json, sys; print(",".join(row["id"] for row in json.load(sys.stdin)))')"
IDS5B="$(printf '%s\n' "$OUT5B" | python3 -c 'import json, sys; print(",".join(row["id"] for row in json.load(sys.stdin)))')"
test "$IDS5A" = "$IDS5B" || { echo "FAIL: ranking not deterministic"; exit 1; }
echo "OK: ranking is deterministic"

echo "--- Test 6: missing proposals file shows error ---"
set +e
$cli rank --dir "$tmpempty" >/tmp/researchloop-rank-missing.log 2>&1
rc=$?
set -e
test "$rc" -ne 0 || { echo "FAIL: missing proposals should exit non-zero"; exit 1; }
grep -q "no proposals found" /tmp/researchloop-rank-missing.log || { echo "FAIL: expected missing proposals error"; exit 1; }
echo "OK: missing proposals file fails clearly"

echo "=== All G02 rank tests passed ==="
