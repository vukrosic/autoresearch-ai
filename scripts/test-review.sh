#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-review-init.log
$cli goal --dir "$tmpdir" "lower val loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=0.50\n'" \
  --evaluation "printf 'val_loss=0.50\n'" \
  >/tmp/researchloop-review-goal.log

# Good run -> review passes.
$cli run --dir "$tmpdir" --id good-run --command "printf 'val_loss=0.30\n'" \
  --timeout 30 >/tmp/researchloop-review-good-run.log 2>&1

$cli review --dir "$tmpdir" --id good-run >/tmp/researchloop-review-good.log 2>&1
grep -q "result: pass" /tmp/researchloop-review-good.log
grep -q "ok  status_ok" /tmp/researchloop-review-good.log
grep -q "ok  metric_finite" /tmp/researchloop-review-good.log
grep -q "ok  artifacts_present" /tmp/researchloop-review-good.log

# JSON format.
$cli review --dir "$tmpdir" --id good-run --format json >/tmp/researchloop-review-json.log 2>&1
node -e '
const data = JSON.parse(require("fs").readFileSync("/tmp/researchloop-review-json.log","utf8"));
if (data.pass !== true) { console.error("expected pass=true"); process.exit(1); }
if (data.run_id !== "good-run") { console.error("bad run_id"); process.exit(1); }
if (!Array.isArray(data.checks) || data.checks.length < 4) { console.error("missing checks"); process.exit(1); }
'

# Markdown output to a file.
$cli review --dir "$tmpdir" --id good-run --out "$tmpdir/review-good.md" \
  >/tmp/researchloop-review-out.log 2>&1
[ -f "$tmpdir/review-good.md" ] || { echo "missing review-good.md"; exit 1; }
grep -q "# Review: good-run" "$tmpdir/review-good.md"
grep -q "result: \*\*PASS\*\*" "$tmpdir/review-good.md"

# Failed run -> review fails non-zero. `false` is in the allowlist and exits 1.
$cli run --dir "$tmpdir" --id bad-run --command "false" --timeout 30 \
  >/tmp/researchloop-review-bad-run.log 2>&1 || true
grep -q "status: failed" /tmp/researchloop-review-bad-run.log
set +e
$cli review --dir "$tmpdir" --id bad-run >/tmp/researchloop-review-bad.log 2>&1
bad_exit=$?
set -e
if [ "$bad_exit" -eq 0 ]; then
  echo "expected review of failed run to exit non-zero"
  cat /tmp/researchloop-review-bad.log
  exit 1
fi
grep -q "result: FAIL" /tmp/researchloop-review-bad.log

# Missing --id fails clearly.
set +e
$cli review --dir "$tmpdir" >/tmp/researchloop-review-noid.log 2>&1
noid=$?
set -e
[ "$noid" -ne 0 ] || { echo "expected missing --id to fail"; exit 1; }
grep -q "missing --id" /tmp/researchloop-review-noid.log

# Promote on the failed run -> blocked, then --force overrides.
set +e
$cli promote --dir "$tmpdir" --id bad-run >/tmp/researchloop-review-promote-block.log 2>&1
pblock=$?
set -e
[ "$pblock" -ne 0 ] || { echo "expected promote of failed run to be blocked"; exit 1; }

# Promote of the good run writes review.md into winners/.
$cli promote --dir "$tmpdir" --id good-run --note "review pass" \
  >/tmp/researchloop-review-promote-good.log 2>&1
[ -f "$tmpdir/.researchloop/winners/good-run/review.md" ] || {
  echo "expected winners/good-run/review.md after promote"; exit 1;
}
grep -q "PASS" "$tmpdir/.researchloop/winners/good-run/review.md"

# --skip-review on promote does NOT write review.md.
$cli run --dir "$tmpdir" --id good-run-2 --command "printf 'val_loss=0.25\n'" \
  --timeout 30 >/tmp/researchloop-review-good-run-2.log 2>&1
$cli promote --dir "$tmpdir" --id good-run-2 --skip-review \
  >/tmp/researchloop-review-promote-skip.log 2>&1
if [ -f "$tmpdir/.researchloop/winners/good-run-2/review.md" ]; then
  echo "--skip-review should not write a review.md"
  exit 1
fi
grep -q "WARNING: --skip-review" /tmp/researchloop-review-promote-skip.log

echo "autoresearch test:review passed"
