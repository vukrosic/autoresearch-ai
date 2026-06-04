#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

cli=(node "$repo_root/bin/researchloop.js")
research_dir="$fixture/.researchloop"
mkdir -p "$research_dir/scratchpad"
cp "$repo_root/examples/fixtures/report/runs.jsonl" "$research_dir/scratchpad/runs.jsonl"

cat > "$fixture/supported.md" <<'EOF'
# Supported Report

The best run was lr-3e-4 with val_loss=0.38.
The baseline run baseline-001 had val_loss 0.50.
The spread between lr-3e-4 and baseline-001 is 0.12 val_loss.
EOF

echo "=== Test G21 claim audit pass ==="
pass_out="$("${cli[@]}" audit supported.md --dir "$fixture")"
printf '%s\n' "$pass_out"
grep -q "lr-3e-4:val_loss" <<<"$pass_out"
grep -q "baseline-001:val_loss" <<<"$pass_out"
grep -q "lr-3e-4,baseline-001:val_loss_delta" <<<"$pass_out"
if grep -q "| null |" <<<"$pass_out"; then
  echo "expected no unmatched claims in supported report"
  exit 1
fi

cat > "$fixture/fabricated.md" <<'EOF'
# Fabricated Report

The best run was lr-3e-4 with val_loss=0.31.
EOF

echo "=== Test G21 claim audit fail ==="
set +e
fail_out="$("${cli[@]}" audit fabricated.md --dir "$fixture" 2>&1)"
fail_status=$?
set -e
printf '%s\n' "$fail_out"
if [ "$fail_status" -eq 0 ]; then
  echo "expected fabricated claim audit to fail"
  exit 1
fi
grep -q "| 3 | 0.31 | null |" <<<"$fail_out"
grep -q "audit: 1 unmatched numeric metric claim" <<<"$fail_out"

echo "=== Test G21 generated report audits clean ==="
cat > "$research_dir/goal.md" <<'EOF'
# Research Goal

## Goal
Lower validation loss.

## Target Metric
val_loss

## Direction
lower

## Current Best
val_loss = 0.38 (run lr-3e-4)
EOF

"${cli[@]}" report --dir "$fixture" --format markdown --out generated.md --include-plots >/tmp/autoresearch-audit-report.log
generated_out="$("${cli[@]}" audit generated.md --dir "$fixture")"
printf '%s\n' "$generated_out"
if grep -q "| null |" <<<"$generated_out"; then
  echo "expected generated report to audit cleanly"
  exit 1
fi

echo "autoresearch test:audit passed"
