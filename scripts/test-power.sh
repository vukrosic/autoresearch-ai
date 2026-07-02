#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-power-init.log
$cli goal --dir "$tmpdir" "lower val loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.0\n'" \
  --evaluation "printf 'val_loss=1.0\n'" >/tmp/autoresearch-power-goal.log

# --- Mode A: required n (explicit sigma) ---
# sigma=0.01, delta=0.02 -> 4 per group at alpha=0.05 power=0.8 (verified by hand)
json=$($cli power --dir "$tmpdir" --baseline-std 0.01 --detect-delta 0.02 --alpha 0.05 --power 0.8 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "required_n", d
assert d["required_n_per_group"] == 4, d
assert d["required_n_total"] == 8, d
assert d["sigma_source"] == "explicit", d
assert d["small_n_note"], "should warn about small-n approximation"
PY

# --- Mode B: min detectable delta (n given) ---
json=$($cli power --dir "$tmpdir" --baseline-std 0.01 --n 5 --alpha 0.05 --power 0.8 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "min_detectable_delta", d
assert d["n"] == 5, d
mdd = d["min_detectable_delta"]
# Expected ~ sqrt(2 * 0.01**2 * (1.96+0.84)**2 / 5) ≈ 0.0177
assert 0.017 < mdd < 0.019, ("min_detectable_delta out of range", mdd, d)
PY

# --- Mode C: achieved power (both given) ---
# n=3, delta=0.02, sigma=0.01 -> power ~ 0.69, NOT adequate at 0.8
json=$($cli power --dir "$tmpdir" --baseline-std 0.01 --n 3 --detect-delta 0.02 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "achieved_power", d
assert d["n"] == 3, d
assert 0.65 < d["achieved_power"] < 0.72, d
assert d["adequate"] is False, d
PY

# Same n but tiny delta -> always under-powered.
json=$($cli power --dir "$tmpdir" --baseline-std 0.01 --n 100 --detect-delta 0.0001 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "achieved_power", d
assert d["achieved_power"] < 0.1, d
PY

# Big n + big delta -> adequate.
json=$($cli power --dir "$tmpdir" --baseline-std 0.01 --n 50 --detect-delta 0.02 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["adequate"] is True, d
assert d["achieved_power"] > 0.95, d
PY

# --- Ledger discovery: with a seed-aggregate row present, --baseline-std is optional ---
$cli run --dir "$tmpdir" --id baseline --seeds 5 \
  --command 'printf "val_loss=1.${RESEARCHLOOP_SEED}\n"' >/tmp/autoresearch-power-base.log
json=$($cli power --dir "$tmpdir" --detect-delta 0.5 --format json)
python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d["sigma_source"] == "ledger", d
assert "sigma_discovered_from" in d, d
assert d["sigma_discovered_from"]["source"] == "baseline", d
assert d["sigma_discovered_from"]["n"] == 5, d
PY

# --- Error cases ---
# No --baseline-std AND no ledger -> non-zero exit with clear message.
empty=$(mktemp -d)
trap 'rm -rf "$tmpdir" "$empty"' EXIT
$cli init --agent codex --dir "$empty" >/dev/null
set +e
$cli power --dir "$empty" --detect-delta 0.02 >/tmp/autoresearch-power-no-sigma.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: should exit non-zero when no sigma available"; exit 1; }
grep -q "Need a baseline std" /tmp/autoresearch-power-no-sigma.log

# No --detect-delta and no --n -> non-zero exit.
set +e
$cli power --dir "$tmpdir" --baseline-std 0.01 >/tmp/autoresearch-power-no-input.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: should exit non-zero when no detect-delta or n given"; exit 1; }
grep -q "Provide at least one" /tmp/autoresearch-power-no-input.log

# Invalid sigma (negative) -> rejected.
set +e
$cli power --dir "$tmpdir" --baseline-std -0.1 --detect-delta 0.02 >/tmp/autoresearch-power-bad-sigma.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || { echo "FAIL: negative sigma should be rejected"; exit 1; }
grep -q "Invalid baseline std" /tmp/autoresearch-power-bad-sigma.log

# Text mode renders the suggested command for required_n.
text=$($cli power --dir "$tmpdir" --baseline-std 0.01 --detect-delta 0.02)
grep -q "required_n_per_group: 4" <<<"$text"
grep -q "suggested command:" <<<"$text"

# Text mode renders a recommendation for under-powered designs.
text=$($cli power --dir "$tmpdir" --baseline-std 0.01 --n 3 --detect-delta 0.02)
grep -q "adequate (≥ 0.8): no" <<<"$text"
grep -q "recommendation: increase n" <<<"$text"

echo "autoresearch test:power passed"
