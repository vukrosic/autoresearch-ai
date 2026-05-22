#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-sig-init.log
$cli goal --dir "$tmpdir" "lower val loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.0\n'" \
  --evaluation "printf 'val_loss=1.0\n'" >/tmp/autoresearch-sig-goal.log

# Two seed groups, n=8 each. A clusters around 1.0; B around 2.0 — should be significant.
$cli run --dir "$tmpdir" --id A --seeds 8 \
  --command 'printf "val_loss=1.${RESEARCHLOOP_SEED}\n"' >/tmp/autoresearch-sig-A.log
$cli run --dir "$tmpdir" --id B --seeds 8 \
  --command 'printf "val_loss=2.${RESEARCHLOOP_SEED}\n"' >/tmp/autoresearch-sig-B.log

# Usage error when no args.
out_no_args=$($cli significance 2>&1 || true)
case "$out_no_args" in
  *"Usage: autoresearch significance"*) ;;
  *) echo "FAIL: missing usage on bare invocation"; echo "$out_no_args"; exit 1 ;;
esac

# Unknown run id is rejected.
out_bad=$($cli significance NOPE B --dir "$tmpdir" 2>&1 || true)
case "$out_bad" in
  *"Run not found: NOPE"*) ;;
  *) echo "FAIL: missing 'Run not found' for unknown id"; echo "$out_bad"; exit 1 ;;
esac

# Text-format output: assert structure + that A vs B is flagged significant.
text_out=$($cli significance A B --dir "$tmpdir" --direction lower)
grep -q "significance: A vs B" <<<"$text_out"
grep -q "metric: val_loss" <<<"$text_out"
grep -q "delta (A - B):" <<<"$text_out"
grep -q "ci_95 (bootstrap):" <<<"$text_out"
grep -q "p_value (permutation, two-sided):" <<<"$text_out"
grep -q "significant: yes" <<<"$text_out"
grep -q "interpretation: A better (lower)" <<<"$text_out"

# JSON-format output: parse-able, contains expected keys, significant=true,
# delta is negative (A < B), p < 0.05.
json_out=$($cli significance A B --dir "$tmpdir" --format json)
python3 - "$json_out" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["metric"] == "val_loss", d
assert d["run_a"]["id"] == "A" and d["run_a"]["n"] == 8, d
assert d["run_b"]["id"] == "B" and d["run_b"]["n"] == 8, d
assert d["run_a"]["source"] == "seeds" and d["run_b"]["source"] == "seeds", d
assert d["significant"] is True, d
assert d["delta"] < 0, d
assert d["p_value"] < 0.05, d
ci_low, ci_high = d["ci_95"]
assert ci_low < d["delta"] < ci_high or abs(ci_low - d["delta"]) < 0.5, d
PY

# Self-comparison: identical groups -> delta=0, p=1, not significant.
self_out=$($cli significance A A --dir "$tmpdir" --format json)
python3 - "$self_out" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["delta"] == 0, d
assert d["p_value"] == 1.0, d
assert d["significant"] is False, d
PY

# Deterministic across two invocations with the same --seed.
out1=$($cli significance A B --dir "$tmpdir" --format json --seed 7)
out2=$($cli significance A B --dir "$tmpdir" --format json --seed 7)
[ "$out1" = "$out2" ] || { echo "FAIL: same --seed produced different output"; exit 1; }

# Different --seed values should generally yield slightly different CIs (sanity, not exact).
out3=$($cli significance A B --dir "$tmpdir" --format json --seed 999)
[ "$out1" != "$out3" ] || { echo "FAIL: different --seed produced identical output"; exit 1; }

# --require-significant: exit non-zero when not significant.
# Build two near-identical groups so p is high.
$cli run --dir "$tmpdir" --id C --seeds 4 \
  --command 'printf "val_loss=1.0\n"' >/tmp/autoresearch-sig-C.log
$cli run --dir "$tmpdir" --id D --seeds 4 \
  --command 'printf "val_loss=1.0\n"' >/tmp/autoresearch-sig-D.log
set +e
$cli significance C D --dir "$tmpdir" --require-significant >/tmp/autoresearch-sig-CD.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: --require-significant should exit non-zero when not significant"; cat /tmp/autoresearch-sig-CD.log; exit 1; }

# Conversely, --require-significant exits 0 on a clear winner.
$cli significance A B --dir "$tmpdir" --require-significant >/dev/null

# Run with no usable metric on one side -> non-zero exit.
$cli record --dir "$tmpdir" --id NO_METRIC --status complete --note "no metric" >/dev/null
set +e
$cli significance A NO_METRIC --dir "$tmpdir" >/tmp/autoresearch-sig-nm.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: missing metric should exit non-zero"; exit 1; }
grep -q "no usable value" /tmp/autoresearch-sig-nm.log

# `sig` alias works.
$cli sig A B --dir "$tmpdir" --format json >/dev/null

echo "autoresearch test:significance passed"
