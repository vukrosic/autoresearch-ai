#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-gates-init.log
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=0.50\n'" \
  --evaluation "printf 'val_loss=0.50\n'" \
  >/tmp/researchloop-gates-goal.log

# Establish baseline at val_loss=0.50.
$cli baseline --dir "$tmpdir" --id baseline-gates >/tmp/researchloop-gates-baseline.log 2>&1
grep -q "val_loss: 0.5" /tmp/researchloop-gates-baseline.log

# Gates: promote if val_loss < baseline - 0.05; discard if val_loss > baseline.
cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
early_stop: []
gates:
  - {metric: val_loss, op: "<",  value: "{baseline}-0.05", action: promote}
  - {metric: val_loss, op: ">",  value: "{baseline}",      action: discard}
YAML

# --- Case 1: above the bar -> promoted ------------------------------------
$cli run --dir "$tmpdir" --id better-run --command "printf 'val_loss=0.40\n'" \
  --timeout 30 >/tmp/researchloop-gates-better.log 2>&1
grep -q "status: promoted" /tmp/researchloop-gates-better.log
grep -q "gate: val_loss=0.4" /tmp/researchloop-gates-better.log
grep -q '"status":"promoted"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"gate_reasons"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

# --- Case 2: below the bar -> discarded -----------------------------------
$cli run --dir "$tmpdir" --id worse-run --command "printf 'val_loss=0.80\n'" \
  --timeout 30 >/tmp/researchloop-gates-worse.log 2>&1 || true
grep -q "status: discarded" /tmp/researchloop-gates-worse.log

# --- Case 3: borderline -> kept (matches no gate) -------------------------
$cli run --dir "$tmpdir" --id borderline-run --command "printf 'val_loss=0.48\n'" \
  --timeout 30 >/tmp/researchloop-gates-borderline.log 2>&1
grep -q "status: kept" /tmp/researchloop-gates-borderline.log

# --- Case 4: no eval.yaml -> status remains "complete" --------------------
rm "$tmpdir/.researchloop/eval.yaml"
$cli run --dir "$tmpdir" --id no-gates-run --command "printf 'val_loss=0.40\n'" \
  --timeout 30 >/tmp/researchloop-gates-none.log 2>&1
grep -q "status: complete" /tmp/researchloop-gates-none.log

echo "autoresearch test:gates passed"
