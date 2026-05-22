#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-det-init.log
$cli goal --dir "$tmpdir" "lower val loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.0\n'" \
  --evaluation "printf 'val_loss=1.0\n'" >/tmp/autoresearch-det-goal.log

# Usage error on missing --command.
set +e
$cli determinism --dir "$tmpdir" >/tmp/autoresearch-det-noargs.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: missing --command should exit non-zero"; exit 1; }
grep -q "Usage: autoresearch determinism" /tmp/autoresearch-det-noargs.log

# DETERMINISTIC case: command always emits the same value -> exit 0, verdict=deterministic.
set +e
$cli determinism --dir "$tmpdir" --n 3 --id det-ok \
  --command 'printf "val_loss=0.5\n"' >/tmp/autoresearch-det-ok.log 2>&1
rc=$?
set -e
[ "$rc" -eq 0 ] || { echo "FAIL: deterministic case should exit 0 (got $rc)"; cat /tmp/autoresearch-det-ok.log; exit 1; }
grep -q "verdict: deterministic" /tmp/autoresearch-det-ok.log
grep -q "n_parsed: 3" /tmp/autoresearch-det-ok.log
grep -q "recorded: det-ok" /tmp/autoresearch-det-ok.log

# Three child rows and one aggregator row landed in the ledger.
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
test -f "$ledger"
grep -q '"id":"det-ok-iter0"' "$ledger"
grep -q '"id":"det-ok-iter1"' "$ledger"
grep -q '"id":"det-ok-iter2"' "$ledger"
grep -q '"id":"det-ok"' "$ledger"
grep -q '"determinism":' "$ledger"
grep -q '"verdict":"deterministic"' "$ledger"

# JSON output: parseable + expected keys.
set +e
json_out=$($cli determinism --dir "$tmpdir" --n 2 --id det-json \
  --command 'printf "val_loss=0.5\n"' --format json 2>/tmp/autoresearch-det-json.err)
rc=$?
set -e
[ "$rc" -eq 0 ] || { echo "FAIL: json deterministic case should exit 0 (got $rc)"; cat /tmp/autoresearch-det-json.err; exit 1; }
python3 - "$json_out" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["verdict"] == "deterministic", d
assert d["n"] == 2, d
assert d["n_parsed"] == 2, d
assert d["values"] == [0.5, 0.5], d
assert d["max_abs_dev"] == 0.0, d
assert d["mean"] == 0.5, d
assert d["std"] == 0.0, d
assert d["hints"] == [], d
PY

# NON-DETERMINISTIC case: bash $RANDOM yields different metrics -> exit 2.
# Use a tight tolerance so even tiny variance trips it.
set +e
$cli determinism --dir "$tmpdir" --n 3 --id det-bad --tolerance 0.0001 \
  --command 'bash -c "printf val_loss=0.%04d\\n $RANDOM"' >/tmp/autoresearch-det-bad.log 2>&1
rc=$?
set -e
[ "$rc" -eq 2 ] || { echo "FAIL: non-deterministic case should exit 2 (got $rc)"; cat /tmp/autoresearch-det-bad.log; exit 1; }
grep -q "verdict: non_deterministic" /tmp/autoresearch-det-bad.log
grep -q "likely causes" /tmp/autoresearch-det-bad.log
grep -q "cudnn.benchmark" /tmp/autoresearch-det-bad.log

# `--no-exit-code` suppresses the failure exit.
set +e
$cli determinism --dir "$tmpdir" --n 3 --id det-bad2 --tolerance 0.0001 \
  --no-exit-code \
  --command 'bash -c "printf val_loss=0.%04d\\n $RANDOM"' >/tmp/autoresearch-det-bad2.log 2>&1
rc=$?
set -e
[ "$rc" -eq 0 ] || { echo "FAIL: --no-exit-code should make non-det exit 0 (got $rc)"; exit 1; }
grep -q "verdict: non_deterministic" /tmp/autoresearch-det-bad2.log

# INSUFFICIENT_DATA case: safety policy blocks all iterations -> exit 1.
set +e
$cli determinism --dir "$tmpdir" --n 3 --id det-blocked \
  --command 'curl http://example.com' >/tmp/autoresearch-det-blocked.log 2>&1
rc=$?
set -e
[ "$rc" -eq 1 ] || { echo "FAIL: insufficient_data should exit 1 (got $rc)"; cat /tmp/autoresearch-det-blocked.log; exit 1; }
grep -q "verdict: insufficient_data" /tmp/autoresearch-det-blocked.log

# `det` alias works.
$cli det --dir "$tmpdir" --n 2 --id det-alias \
  --command 'printf "val_loss=0.5\n"' >/dev/null

echo "autoresearch test:determinism passed"
