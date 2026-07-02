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

# Checkpoint-aware resume (G09): record newest checkpoint, print exact restart
# command on dry-run, then launch with checkpoint env vars.
ckpt_dir="$tmpdir/checkpoint-case"
mkdir -p "$ckpt_dir"
$cli init --agent codex --dir "$ckpt_dir" >/dev/null
cat > "$ckpt_dir/.researchloop/eval.yaml" <<'YAML'
checkpoint_glob: "checkpoints/*.pt"
resume_flag_template: "--resume {path}"
YAML

ckpt_cmd='bash -c '"'"'mkdir -p checkpoints; touch checkpoints/step_10.pt; sleep 0.1; touch checkpoints/step_50.pt; if [ "${RESEARCHLOOP_RESUME:-}" = "1" ]; then printf "checkpoint=%s\nval_loss=0.2\n" "${RESEARCHLOOP_RESUME_CHECKPOINT_REL:-missing}"; exit 0; fi; printf "val_loss=0.9\n"; exit 1'"'"' --'
set +e
$cli run --dir "$ckpt_dir" --id ckpt-crash --command "$ckpt_cmd" --metric val_loss >/tmp/autoresearch-resume-ckpt-crash.log
ckpt_exit=$?
set -e
if [ "$ckpt_exit" -eq 0 ]; then
  echo "expected checkpoint run to fail before resume"
  exit 1
fi
grep -q "status: failed" /tmp/autoresearch-resume-ckpt-crash.log
grep -q "checkpoint: checkpoints/step_50.pt" /tmp/autoresearch-resume-ckpt-crash.log
ckpt_ledger="$ckpt_dir/.researchloop/scratchpad/runs.jsonl"
grep -qE '"last_checkpoint":\s*"checkpoints/step_50.pt"' "$ckpt_ledger"

$cli resume --dir "$ckpt_dir" ckpt-crash --dry-run --metric val_loss >/tmp/autoresearch-resume-ckpt-dry.log
grep -q "source: ckpt-crash (status=failed)" /tmp/autoresearch-resume-ckpt-dry.log
grep -q "command: .*--resume checkpoints/step_50.pt" /tmp/autoresearch-resume-ckpt-dry.log
grep -q "dry_run: true" /tmp/autoresearch-resume-ckpt-dry.log
if grep -q '"id":"resume-ckpt-crash' "$ckpt_ledger"; then
  echo "dry-run should not append a resume row"
  exit 1
fi

$cli resume --dir "$ckpt_dir" ckpt-crash --metric val_loss >/tmp/autoresearch-resume-ckpt-real.log
grep -q "checkpoint: checkpoints/step_50.pt" /tmp/autoresearch-resume-ckpt-real.log
grep -q "new val_loss: 0.2" /tmp/autoresearch-resume-ckpt-real.log
ckpt_resume_id=$(grep -o '"id":"resume-ckpt-crash-[^"]*"' "$ckpt_ledger" | head -1 | sed 's/"id":"//;s/"$//')
test -n "$ckpt_resume_id"
ckpt_resume_log="$ckpt_dir/.researchloop/scratchpad/runs/$ckpt_resume_id/log.txt"
test -f "$ckpt_resume_log"
grep -q "checkpoint=checkpoints/step_50.pt" "$ckpt_resume_log"
grep -qE '"resume_checkpoint":\s*"checkpoints/step_50.pt"' "$ckpt_dir/.researchloop/scratchpad/runs/$ckpt_resume_id/config.json"
grep -qE '"resume_command":\s*".*--resume checkpoints/step_50.pt"' "$ckpt_dir/.researchloop/scratchpad/runs/$ckpt_resume_id/config.json"

# Configured checkpoint resume should fail clearly when no checkpoint exists.
no_ckpt_dir="$tmpdir/no-checkpoint-case"
mkdir -p "$no_ckpt_dir"
$cli init --agent codex --dir "$no_ckpt_dir" >/dev/null
cat > "$no_ckpt_dir/.researchloop/eval.yaml" <<'YAML'
checkpoint_glob: "checkpoints/*.pt"
resume_flag_template: "--resume {path}"
YAML
set +e
$cli run --dir "$no_ckpt_dir" --id no-ckpt --command 'echo "val_loss=0.7"; false' --metric val_loss >/tmp/autoresearch-resume-no-ckpt-run.log
set -e
set +e
$cli resume --dir "$no_ckpt_dir" no-ckpt >/tmp/autoresearch-resume-no-ckpt.log 2>&1
no_ckpt_exit=$?
set -e
if [ "$no_ckpt_exit" -eq 0 ]; then
  echo "expected resume without checkpoint to exit nonzero"
  exit 1
fi
grep -q "no checkpoint found for run no-ckpt" /tmp/autoresearch-resume-no-ckpt.log
grep -Fq "checkpoint_glob: checkpoints/*.pt" /tmp/autoresearch-resume-no-ckpt.log

echo "autoresearch test:resume passed"
