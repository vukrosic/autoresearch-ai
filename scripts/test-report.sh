#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

cli=(node "$repo_root/bin/researchloop.js")
research_dir="$fixture/.researchloop"
mkdir -p "$research_dir/scratchpad"

cp "$repo_root/examples/fixtures/report/runs.jsonl" "$research_dir/scratchpad/runs.jsonl"
cat > "$research_dir/goal.md" <<'EOF'
# Research Goal

## Goal
Lower validation loss on the fixture language-model training loop.

## Target Metric
val_loss

## Direction
lower

## Baseline Command
python train.py --lr 1e-3

## Evaluation Command
python eval.py

## Current Best
val_loss = 0.38 (run lr-3e-4)
EOF

cat > "$research_dir/plan.md" <<'EOF'
# Research Plan

## Current State
- Baseline: val_loss = 0.50 (run baseline-001)
- Best valid result: lr-3e-4

## Time Budget
30m

## Picklist
- Verify lr-3e-4.
- Try one seed sweep.

## Ruled Out
- High learning-rate run diverged.
EOF

echo "=== Test G20 markdown report ==="

"${cli[@]}" report --dir "$fixture" --format markdown --out report.md --include-plots >/tmp/autoresearch-report.log
grep -q "report: report.md" /tmp/autoresearch-report.log

report="$fixture/report.md"
assets="$fixture/report-assets"
test -f "$report"
test -d "$assets"
test -f "$assets/metric-trend.svg"
test -f "$assets/loss-curves.svg"
grep -q "<svg" "$assets/metric-trend.svg"
grep -q "<svg" "$assets/loss-curves.svg"

line_count="$(wc -l < "$report" | tr -d ' ')"
if [ "$line_count" -lt 50 ]; then
  echo "expected report.md to be at least 50 lines, got $line_count"
  exit 1
fi

grep -q "# AutoResearch-AI Experiment Report" "$report"
grep -q "## Goal" "$report"
grep -q "## Baseline" "$report"
grep -q "## Best Run" "$report"
grep -q "## Sweep Summary" "$report"
grep -q "## Loss Curves" "$report"
grep -q "## Discarded Results" "$report"
grep -q "## Open Questions" "$report"
grep -q "## Appendix: Run Ledger Index" "$report"
grep -q 'Best recorded run for `val_loss` is `lr-3e-4` with value 0.38' "$report"
grep -q 'Between best run `lr-3e-4` and worst recorded run `baseline-001`, the spread is 0.12 val_loss' "$report"
grep -q '!\[Metric trend\](report-assets/metric-trend.svg)' "$report"
grep -q '!\[Loss curves\](report-assets/loss-curves.svg)' "$report"
grep -q '| `nan-run` | failed |' "$report"
grep -q 'autoresearch verify --id lr-3e-4' "$report"

node --input-type=module - "$report" "$repo_root/examples/fixtures/report/runs.jsonl" <<'NODE'
import fs from "node:fs";

const report = fs.readFileSync(process.argv[2], "utf8");
const ids = new Set(
  fs.readFileSync(process.argv[3], "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).id)
);
for (const match of report.matchAll(/`([^`]+)`/g)) {
  const value = match[1];
  if (/^(baseline-001|lr-1e-3|lr-3e-4|dropout-0-1|nan-run)$/.test(value) && !ids.has(value)) {
    throw new Error(`unknown run id in report: ${value}`);
  }
}
for (const id of ids) {
  if (!report.includes("`" + id + "`")) {
    throw new Error(`report omitted run id: ${id}`);
  }
}
NODE

stdout_report="$("${cli[@]}" report --dir "$fixture" --format markdown)"
grep -q "# AutoResearch-AI Experiment Report" <<<"$stdout_report"

text_report="$("${cli[@]}" report --dir "$fixture")"
grep -q "runs: 5" <<<"$text_report"
grep -q "estimated_cost_usd:" <<<"$text_report"

echo "autoresearch test:report passed"
