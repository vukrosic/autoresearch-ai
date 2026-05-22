#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-verify-init.log

# Record a run with a deterministic command (prints val_loss=0.42 every time).
$cli run --dir "$tmpdir" --id det --command 'printf "val_loss=0.42\n"' --metric val_loss >/tmp/autoresearch-verify-det.log
grep -q "status: complete" /tmp/autoresearch-verify-det.log

# verify against the deterministic run — should match exactly.
$cli verify --dir "$tmpdir" --id det >/tmp/autoresearch-verify-match.log
grep -q "source: det" /tmp/autoresearch-verify-match.log
grep -q "determinism: deterministic" /tmp/autoresearch-verify-match.log
grep -q "new val_loss: 0.42" /tmp/autoresearch-verify-match.log

# verify row recorded with verify_of pointer.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -qE '"verify_of":\s*"det"' "$tmpdir/.researchloop/scratchpad/runs/verify-det-"*"/config.json"
grep -qE '"parent_id":\s*"det"' "$ledger"

# Missing source metrics should fail before launching another verify run.
$cli run --dir "$tmpdir" --id no-metric --command 'printf "hello\n"' --metric val_loss >/tmp/autoresearch-verify-no-metric-run.log
set +e
$cli verify --dir "$tmpdir" --id no-metric --verify-id bad-no-metric >/tmp/autoresearch-verify-no-metric.log 2>&1
no_metric_exit=$?
set -e
if [ "$no_metric_exit" -eq 0 ]; then
  echo "expected verify without a source metric to exit nonzero"
  exit 1
fi
grep -q "Run no-metric has no finite val_loss metric; cannot verify against a tolerance." /tmp/autoresearch-verify-no-metric.log
if grep -qE '"id":"bad-no-metric"' "$ledger"; then
  echo "verify should not launch when the source metric is missing"
  exit 1
fi

# Invalid verify arguments should fail before launching another run.
set +e
$cli verify --dir "$tmpdir" --id det --tolerance nope --verify-id bad-tolerance >/tmp/autoresearch-verify-bad-tolerance.log 2>&1
bad_tolerance_exit=$?
$cli verify --dir "$tmpdir" --id det --timeout 0 --verify-id bad-timeout >/tmp/autoresearch-verify-bad-timeout.log 2>&1
bad_timeout_exit=$?
set -e
if [ "$bad_tolerance_exit" -eq 0 ] || [ "$bad_timeout_exit" -eq 0 ]; then
  echo "expected invalid verify arguments to exit nonzero"
  exit 1
fi
grep -q "verify: --tolerance must be a non-negative number" /tmp/autoresearch-verify-bad-tolerance.log
grep -q "verify: --timeout must be a positive number of seconds" /tmp/autoresearch-verify-bad-timeout.log
if grep -qE '"id":"bad-(tolerance|timeout)"' "$ledger"; then
  echo "invalid verify arguments should not write verify rows"
  exit 1
fi

# Duplicate ids should resolve to the latest ledger row.
$cli run --dir "$tmpdir" --id dupe --command 'printf "val_loss=0.60\n"' --metric val_loss >/tmp/autoresearch-verify-dupe-run.log
$cli record --dir "$tmpdir" --id dupe --command 'printf "val_loss=0.30\n"' --status complete --metric val_loss=0.30 >/tmp/autoresearch-verify-dupe-record.log
$cli verify --dir "$tmpdir" --id dupe --verify-id verify-dupe-latest >/tmp/autoresearch-verify-dupe-latest.log
grep -q "expected val_loss: 0.3" /tmp/autoresearch-verify-dupe-latest.log
grep -q "new val_loss: 0.3" /tmp/autoresearch-verify-dupe-latest.log
grep -q "determinism: deterministic" /tmp/autoresearch-verify-dupe-latest.log

# Now make the underlying command flaky by recording a fake row with metric 0.50,
# then verify with a command that prints 0.42 — should report drift.
$cli record --dir "$tmpdir" --id drift --command 'printf "val_loss=0.42\n"' --status complete --metric val_loss=0.50 >/tmp/autoresearch-verify-record.log
set +e
$cli verify --dir "$tmpdir" --id drift --tolerance 0.01 >/tmp/autoresearch-verify-drift.log
drift_exit=$?
set -e
if [ "$drift_exit" -eq 0 ]; then
  echo "expected drift verify to exit nonzero"
  exit 1
fi
grep -q "determinism: drifted" /tmp/autoresearch-verify-drift.log
grep -q "delta: " /tmp/autoresearch-verify-drift.log

# Missing run id -> error.
set +e
$cli verify --dir "$tmpdir" --id nope >/tmp/autoresearch-verify-missing.log 2>&1
missing_exit=$?
set -e
if [ "$missing_exit" -eq 0 ]; then
  echo "expected missing-id verify to exit nonzero"
  exit 1
fi
grep -q "No run found" /tmp/autoresearch-verify-missing.log

echo "autoresearch test:verify passed"
