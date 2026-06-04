#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-verify-init.log

# Record a run with a deterministic command (prints val_loss=0.42 every time).
"${cli[@]}" run --dir "$tmpdir" --id det --command 'printf "val_loss=0.42\n"' --metric val_loss >/tmp/autoresearch-verify-det.log
grep -q "status: complete" /tmp/autoresearch-verify-det.log

# verify against the deterministic run — should match exactly.
"${cli[@]}" verify --dir "$tmpdir" --id det >/tmp/autoresearch-verify-match.log
grep -q "source: det" /tmp/autoresearch-verify-match.log
grep -q "determinism: deterministic" /tmp/autoresearch-verify-match.log
grep -q "new val_loss: 0.42" /tmp/autoresearch-verify-match.log

# verify row recorded with verify_of pointer.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -qE '"verify_of":\s*"det"' "$tmpdir/.researchloop/scratchpad/runs/verify-det-"*"/config.json"
grep -qE '"parent_id":\s*"det"' "$ledger"

# Now make the underlying command flaky by recording a fake row with metric 0.50,
# then verify with a command that prints 0.42 — should report drift.
"${cli[@]}" record --dir "$tmpdir" --id drift --command 'printf "val_loss=0.42\n"' --status complete --metric val_loss=0.50 >/tmp/autoresearch-verify-record.log
set +e
"${cli[@]}" verify --dir "$tmpdir" --id drift --tolerance 0.01 >/tmp/autoresearch-verify-drift.log
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
"${cli[@]}" verify --dir "$tmpdir" --id nope >/tmp/autoresearch-verify-missing.log 2>&1
missing_exit=$?
set -e
if [ "$missing_exit" -eq 0 ]; then
  echo "expected missing-id verify to exit nonzero"
  exit 1
fi
grep -q "No run found" /tmp/autoresearch-verify-missing.log

echo "autoresearch test:verify passed"
