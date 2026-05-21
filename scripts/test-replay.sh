#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/dev/null

# Deterministic replay should reproduce the metric, exit 0, and write replay_of.
$cli run --dir "$tmpdir" --id det --command 'printf "val_loss=0.42\n"' --metric val_loss >/tmp/autoresearch-replay-det-run.log
$cli replay --dir "$tmpdir" det --metric val_loss --tolerance 0.001 >/tmp/autoresearch-replay-det.log
grep -q "replay: det" /tmp/autoresearch-replay-det.log
grep -q "| replay_id | status | metric | expected | actual | delta | within_tolerance |" /tmp/autoresearch-replay-det.log
grep -q "| replay-det-" /tmp/autoresearch-replay-det.log
grep -q "| complete | val_loss | 0.42 | 0.42 | 0.000000 | yes |" /tmp/autoresearch-replay-det.log
grep -q "replay: reproduced" /tmp/autoresearch-replay-det.log

ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -qE '"replay_of":\s*"det"' "$ledger"
grep -qE '"parent_id":\s*"det"' "$ledger"

# --n should write multiple replay rows with replay_index values.
$cli replay --dir "$tmpdir" det --metric val_loss --n 2 --replay-id det-replay-batch >/tmp/autoresearch-replay-n.log
grep -q "| det-replay-batch-1 | complete | val_loss | 0.42 | 0.42 | 0.000000 | yes |" /tmp/autoresearch-replay-n.log
grep -q "| det-replay-batch-2 | complete | val_loss | 0.42 | 0.42 | 0.000000 | yes |" /tmp/autoresearch-replay-n.log
grep -qE '"id":"det-replay-batch-1".*"replay_index":1' "$ledger"
grep -qE '"id":"det-replay-batch-2".*"replay_index":2' "$ledger"

# Non-deterministic replay should report drift and exit nonzero.
state_file="$tmpdir/non-det-counter.txt"
non_det_cmd="bash -c 'n=\$(cat \"$state_file\" 2>/dev/null || echo 0); n=\$((n + 1)); echo \"\$n\" > \"$state_file\"; if [ \"\$n\" -eq 1 ]; then printf \"val_loss=0.10\\n\"; else printf \"val_loss=0.25\\n\"; fi'"
$cli run --dir "$tmpdir" --id nondet --command "$non_det_cmd" --metric val_loss >/tmp/autoresearch-replay-nondet-run.log
set +e
$cli replay --dir "$tmpdir" nondet --metric val_loss --tolerance 0.01 >/tmp/autoresearch-replay-nondet.log
nondet_exit=$?
set -e
if [ "$nondet_exit" -eq 0 ]; then
  echo "expected non-deterministic replay to exit nonzero"
  exit 1
fi
grep -q "| complete | val_loss | 0.1 | 0.25 | 0.150000 | no |" /tmp/autoresearch-replay-nondet.log
grep -q "replay: drifted" /tmp/autoresearch-replay-nondet.log
grep -qE '"replay_of":\s*"nondet"' "$ledger"

echo "autoresearch test:replay passed"
