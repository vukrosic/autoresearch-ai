#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-safety-init.log
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.42\n'" \
  --evaluation "printf 'val_loss=1.30\n'" >/tmp/researchloop-safety-goal.log

$cli baseline --dir "$tmpdir" --id baseline-safe >/tmp/researchloop-safety-baseline.log 2>&1
grep -q "status: complete" /tmp/researchloop-safety-baseline.log
grep -q "val_loss: 1.42" /tmp/researchloop-safety-baseline.log
grep -q "goal.md Current Best updated" /tmp/researchloop-safety-baseline.log

set +e
$cli run --dir "$tmpdir" --id blocked-prefix --command "git --version" >/tmp/researchloop-safety-blocked-prefix.log 2>&1
blocked_prefix_exit=$?
set -e
if [ "$blocked_prefix_exit" -eq 0 ]; then
  echo "expected missing-prefix command to fail"
  exit 1
fi
grep -q "autoresearch safety: blocked command before execution" /tmp/researchloop-safety-blocked-prefix.log
grep -q "rule: allow_prefixes" /tmp/researchloop-safety-blocked-prefix.log
grep -q "does not start with an allowed prefix" /tmp/researchloop-safety-blocked-prefix.log

set +e
$cli run --dir "$tmpdir" --id blocked-deny --command "python -c \"print('rm -rf /tmp/foo')\"" >/tmp/researchloop-safety-blocked-deny.log 2>&1
blocked_deny_exit=$?
set -e
if [ "$blocked_deny_exit" -eq 0 ]; then
  echo "expected deny-substring command to fail"
  exit 1
fi
grep -q "rule: deny_substrings" /tmp/researchloop-safety-blocked-deny.log
grep -q "matches deny_substrings" /tmp/researchloop-safety-blocked-deny.log

printf '%s\n' \
  'allow_prefixes:' \
  '  - python' \
  '  - python3' \
  '  - bash' \
  '  - sh' \
  '  - node' \
  '  - npm' \
  '  - npx' \
  '  - uv' \
  '  - make' \
  '  - pytest' \
  '  - printf' \
  '  - echo' \
  '  - sleep' \
  '  - false' \
  '  - true' \
  '' \
  'deny_substrings:' \
  '  - rm -rf' \
  '  - sudo' \
  '  - curl' \
  '  - wget' \
  '  - mkfs' \
  '  - shutdown' \
  '  - reboot' \
  '  - poweroff' \
  '' \
  'max_minutes_per_run: 0.02' \
  'max_cost_usd_per_run: 0' \
  > "$tmpdir/.researchloop/safety.yaml"

set +e
$cli run --dir "$tmpdir" --id killed-by-safety --command "sleep 10" --timeout 30 >/tmp/researchloop-safety-time-cap.log 2>&1
time_cap_exit=$?
set -e
if [ "$time_cap_exit" -eq 0 ]; then
  echo "expected safety time cap to fail"
  exit 1
fi
grep -q "status: killed_by_safety" /tmp/researchloop-safety-time-cap.log
grep -q "safety: max_minutes_per_run=0.02" /tmp/researchloop-safety-time-cap.log
grep -q '"status":"killed_by_safety"' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

set +e
$cli run --allow-unsafe --dir "$tmpdir" --id unsafe-bypass --command "git --version" >/tmp/researchloop-safety-unsafe.log 2>&1
unsafe_exit=$?
set -e
if [ "$unsafe_exit" -ne 0 ]; then
  echo "expected --allow-unsafe to bypass safety"
  exit 1
fi
grep -q "WARNING: --allow-unsafe bypasses command safety checks" /tmp/researchloop-safety-unsafe.log
grep -q "status: complete" /tmp/researchloop-safety-unsafe.log
grep -q "git version" /tmp/researchloop-safety-unsafe.log

echo "autoresearch test:safety passed"
