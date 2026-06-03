#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

cli="node ./bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-queue-init.log

cat > "$tmpdir/sweep.yaml" <<'YAML'
version: 1
name: queue-smoke
metric: val_loss
direction: lower
command_template: "printf 'val_loss={loss}\\n'"
retry:
  max_retries: 1
budget:
  max_runs: 5
grid:
  loss: [0.30, 0.20]
YAML

$cli sweep validate --dir "$tmpdir" --spec "$tmpdir/sweep.yaml" >/tmp/autoresearch-queue-validate.log
grep -q "ok: true" /tmp/autoresearch-queue-validate.log
grep -q "variants: 2" /tmp/autoresearch-queue-validate.log

$cli sweep preview --dir "$tmpdir" --spec "$tmpdir/sweep.yaml" >/tmp/autoresearch-queue-preview.log
grep -q "sweep preview: queue-smoke" /tmp/autoresearch-queue-preview.log
grep -q "queue-smoke-v001" /tmp/autoresearch-queue-preview.log

$cli sweep create --dir "$tmpdir" --spec "$tmpdir/sweep.yaml" --id queue-smoke-fixed >/tmp/autoresearch-queue-create.log
grep -q "queue: queue-smoke-fixed" /tmp/autoresearch-queue-create.log
test -f "$tmpdir/.researchloop/scratchpad/queues/queue-smoke-fixed/queue.yaml"
test -f "$tmpdir/.researchloop/scratchpad/queues/queue-smoke-fixed/state.json"

$cli queue start --dir "$tmpdir" --id queue-smoke-fixed >/tmp/autoresearch-queue-start.log
grep -q "status: complete" /tmp/autoresearch-queue-start.log
grep -q "complete: 2/2" /tmp/autoresearch-queue-start.log
grep -q '"queue_id":"queue-smoke-fixed"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"params":{"loss":0.2}' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

$cli queue status --dir "$tmpdir" --id queue-smoke-fixed --format json >/tmp/autoresearch-queue-status.json
grep -q '"status": "complete"' /tmp/autoresearch-queue-status.json
grep -q '"complete": 2' /tmp/autoresearch-queue-status.json
grep -q '"best":' /tmp/autoresearch-queue-status.json

$cli queue report --dir "$tmpdir" --id queue-smoke-fixed >/tmp/autoresearch-queue-report.log
grep -q "sweep-report.md" /tmp/autoresearch-queue-report.log
test -f "$tmpdir/.researchloop/scratchpad/sweeps/queue-smoke-fixed/sweep-report.md"
test -f "$tmpdir/.researchloop/scratchpad/sweeps/queue-smoke-fixed/results.csv"
test -f "$tmpdir/.researchloop/scratchpad/sweeps/queue-smoke-fixed/summary.json"

cat > "$tmpdir/sweep-fail.yaml" <<'YAML'
version: 1
name: queue-retry
metric: val_loss
direction: lower
command_template: "false"
variants:
  - id: broken
    params:
      loss: 1.0
YAML

$cli sweep create --dir "$tmpdir" --spec "$tmpdir/sweep-fail.yaml" --id queue-retry-fixed >/tmp/autoresearch-queue-retry-create.log
$cli queue start --dir "$tmpdir" --id queue-retry-fixed >/tmp/autoresearch-queue-retry-start.log
grep -q "failed: 1" <($cli queue status --dir "$tmpdir" --id queue-retry-fixed)
$cli queue retry-failed --dir "$tmpdir" --id queue-retry-fixed >/tmp/autoresearch-queue-retry.log
grep -q "retry_pending=1" /tmp/autoresearch-queue-retry.log
grep -q '"pending": 1' "$tmpdir/.researchloop/scratchpad/queues/queue-retry-fixed/state.json"

cat > "$tmpdir/sweep-no-metric.yaml" <<'YAML'
version: 1
name: queue-no-metric
metric: val_loss
direction: lower
command_template: "true"
variants:
  - id: empty
    params:
      loss: 1.0
YAML

$cli sweep create --dir "$tmpdir" --spec "$tmpdir/sweep-no-metric.yaml" --id queue-no-metric-fixed >/tmp/autoresearch-queue-no-metric-create.log
$cli queue start --dir "$tmpdir" --id queue-no-metric-fixed >/tmp/autoresearch-queue-no-metric-start.log
grep -q '"complete_no_metric": 1' "$tmpdir/.researchloop/scratchpad/queues/queue-no-metric-fixed/state.json"
$cli queue retry-failed --dir "$tmpdir" --id queue-no-metric-fixed >/tmp/autoresearch-queue-no-metric-retry.log
grep -q "retry_pending=1" /tmp/autoresearch-queue-no-metric-retry.log
grep -q '"pending": 1' "$tmpdir/.researchloop/scratchpad/queues/queue-no-metric-fixed/state.json"

echo "autoresearch test:sweep-queue passed"
