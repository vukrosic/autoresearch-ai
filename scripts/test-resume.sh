#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-resume-init.log

# Run that fails (exit code 1).
set +e
"${cli[@]}" run --dir "$tmpdir" --id crashed --command 'echo "training started"; false' --metric val_loss >/tmp/autoresearch-resume-crash.log
crash_exit=$?
set -e
if [ "$crash_exit" -eq 0 ]; then
  echo "expected the crashed run to exit nonzero"
  exit 1
fi
grep -q "status: failed" /tmp/autoresearch-resume-crash.log

# Resume by --id. Use a command that reads RESEARCHLOOP_RESUME and emits a value.
"${cli[@]}" resume --dir "$tmpdir" --id crashed \
  --command 'printf "resume=%s from=%s\nval_loss=0.3\n" "$RESEARCHLOOP_RESUME" "$RESEARCHLOOP_RESUME_FROM"' \
  --metric val_loss \
  >/tmp/autoresearch-resume-by-id.log

grep -q "autoresearch resume" /tmp/autoresearch-resume-by-id.log
grep -q "source: crashed" /tmp/autoresearch-resume-by-id.log
grep -q "new val_loss: 0.3" /tmp/autoresearch-resume-by-id.log

# The resume env vars actually reached the child.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
resume_run_dir=$(grep -o '"id":"resume-crashed-[^"]*"' "$ledger" | head -1 | sed 's/"id":"//;s/"$//')
test -n "$resume_run_dir"
log_file="$tmpdir/.researchloop/scratchpad/runs/$resume_run_dir/log.txt"
test -f "$log_file"
grep -q "resume=1 from=crashed" "$log_file"

# resume_of pointer recorded in row + config.
grep -qE '"resume_of":\s*"crashed"' "$tmpdir/.researchloop/scratchpad/runs/$resume_run_dir/config.json"
grep -qE '"parent_id":\s*"crashed"' "$ledger"

# Auto-pick latest resumable when no --id given. First create another failure.
set +e
"${cli[@]}" run --dir "$tmpdir" --id crashed2 --command 'sleep 0.1; exit 2' --metric val_loss >/dev/null 2>&1
set -e

"${cli[@]}" resume --dir "$tmpdir" \
  --command 'printf "val_loss=0.5\n"' \
  --metric val_loss \
  >/tmp/autoresearch-resume-auto.log
# Either crashed or crashed2 may be picked depending on timing; verify a recognised source.
grep -qE "source: crashed2? \(status=failed\)" /tmp/autoresearch-resume-auto.log
grep -q "new val_loss: 0.5" /tmp/autoresearch-resume-auto.log

# No resumable runs at all -> exit nonzero.
empty_dir="$(mktemp -d)"
"${cli[@]}" init --agent codex --dir "$empty_dir" >/dev/null
set +e
"${cli[@]}" resume --dir "$empty_dir" >/tmp/autoresearch-resume-empty.log 2>&1
empty_exit=$?
set -e
rm -rf "$empty_dir"
if [ "$empty_exit" -eq 0 ]; then
  echo "expected resume on empty ledger to exit nonzero"
  exit 1
fi
grep -q "no failed/timeout runs" /tmp/autoresearch-resume-empty.log

echo "autoresearch test:resume passed"
