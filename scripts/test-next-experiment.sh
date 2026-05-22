#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
tmpempty="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$tmpempty"' EXIT

cli="node $repo_root/bin/researchloop.js"
fixture_dir="$repo_root/examples/fixtures/proposals"
plan_path="$tmpdir/.researchloop/scratchpad/experiments/prop_paper_warmup.md"
script_path="$tmpdir/run-next.sh"

echo "=== Test next-experiment command ==="

cp -R "$fixture_dir/." "$tmpdir/"

echo "--- Test 1: next-experiment reads ranked proposals and emits JSON ---"
$cli rank --write --dir "$tmpdir" >/tmp/researchloop-next-rank.log
OUT1="$($cli next-experiment --dir "$tmpdir" --format json)"
printf '%s\n' "$OUT1" | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["proposal_id"], data
assert data["run_id"].startswith("exp-"), data["run_id"]
assert "autoresearch run" in data["plan"], data["plan"]
assert "autoresearch smoke" in data["plan"], data["plan"]
print("OK: JSON plan shape is valid")
' || { echo "FAIL: next-experiment JSON invalid"; exit 1; }

echo "--- Test 2: explicit proposal writes markdown plan and script ---"
$cli next-experiment --proposal prop_paper_warmup --write --script "$script_path" --dir "$tmpdir" >/tmp/researchloop-next-write.log
test -f "$plan_path" || { echo "FAIL: experiment plan not written"; exit 1; }
test -x "$script_path" || { echo "FAIL: script not written executable"; exit 1; }
grep -q "^# Next Experiment:" "$plan_path"
grep -q "Proposal id: prop_paper_warmup" "$plan_path"
grep -q "paper:2503.12345v1" "$plan_path"
grep -q "autoresearch preflight" "$plan_path"
grep -q "autoresearch smoke" "$script_path"
grep -q "autoresearch run" "$script_path"
echo "OK: markdown plan and script written"

echo "--- Test 3: missing proposal fails clearly ---"
set +e
$cli next-experiment --proposal missing-proposal --dir "$tmpdir" >/tmp/researchloop-next-missing.log 2>&1
rc=$?
set -e
test "$rc" -ne 0 || { echo "FAIL: missing proposal should exit non-zero"; exit 1; }
grep -q "proposal not found" /tmp/researchloop-next-missing.log || { echo "FAIL: expected missing proposal error"; exit 1; }
echo "OK: missing proposal fails clearly"

echo "--- Test 4: missing proposal file fails clearly ---"
set +e
$cli next-experiment --dir "$tmpempty" >/tmp/researchloop-next-empty.log 2>&1
empty_rc=$?
set -e
test "$empty_rc" -ne 0 || { echo "FAIL: missing proposals file should exit non-zero"; exit 1; }
grep -q "no proposals found" /tmp/researchloop-next-empty.log || { echo "FAIL: expected no proposals error"; exit 1; }
echo "OK: missing proposal file fails clearly"

echo "=== All next-experiment tests passed ==="
