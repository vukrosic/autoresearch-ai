#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
tmpnovel="$(mktemp -d)"
tmpsweep="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$tmpnovel" "$tmpsweep"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-hypothesis-init.log
$cli goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-hypothesis-goal.log

mkdir -p "$tmpdir/.researchloop/scratchpad/papers" "$tmpdir/.researchloop/scratchpad/hypotheses"
cp "$repo_root/examples/fixtures/hypotheses/paper-read-note.md" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
cp "$repo_root/examples/fixtures/runs/runs.jsonl" "$tmpdir/.researchloop/scratchpad/runs.jsonl"

paper_log="/tmp/researchloop-hypothesis-paper.log"
$cli hypothesis --dir "$tmpdir" --from-papers --paper-id 2503.12345v1 --write >"$paper_log"
paper_path="$(awk -F': ' '/^hypothesis written to:/ {print $2}' "$paper_log" | tail -n 1)"
test -f "$paper_path"
grep -q "^## Mechanism$" "$paper_path"
grep -q "^## Why This Beats Baseline$" "$paper_path"
grep -q "^## Why This Might Fail$" "$paper_path"
grep -q "^## Smallest Test$" "$paper_path"
grep -q "^## Expected Metric Movement$" "$paper_path"
grep -q "^## Kill Criterion$" "$paper_path"
grep -q "^## Implementation Surface (Files / Configs)$" "$paper_path"
grep -q "^## Evidence Source$" "$paper_path"
grep -q "paper:2503.12345v1" "$paper_path"
grep -q "learning-rate schedule" "$paper_path"

run_log="/tmp/researchloop-hypothesis-run.log"
$cli hypothesis --dir "$tmpdir" --from-runs --run-id r5 --write >"$run_log"
run_path="$(awk -F': ' '/^hypothesis written to:/ {print $2}' "$run_log" | tail -n 1)"
test -f "$run_path"
grep -q "run:r5" "$run_path"
grep -q "## Mechanism" "$run_path"
grep -q "## Evidence Source" "$run_path"

novel_log="/tmp/researchloop-hypothesis-novel.log"
$cli hypothesis --dir "$tmpdir" --novel --write >"$novel_log"
novel_path="$(awk -F': ' '/^hypothesis written to:/ {print $2}' "$novel_log" | tail -n 1)"
test -f "$novel_path"
grep -q "Evidence Source" "$novel_path"
grep -q "Evidence source: null" "$novel_path"
grep -vq "sweep" "$novel_path"

mkdir -p "$tmpsweep/.researchloop/scratchpad/papers"
cp "$repo_root/examples/fixtures/hypotheses/sweep-note.md" "$tmpsweep/.researchloop/scratchpad/papers/2509.00001v1.md"
set +e
$cli hypothesis --dir "$tmpsweep" --from-papers --paper-id 2509.00001v1 --novel >/tmp/researchloop-hypothesis-sweep.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: novel hypothesis should reject sweep-like paper notes"; cat /tmp/researchloop-hypothesis-sweep.log; exit 1; }
grep -q "rejected a sweep-like mechanism" /tmp/researchloop-hypothesis-sweep.log

echo "autoresearch test:hypothesis passed"
