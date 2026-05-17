#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

echo "=== G53: autoresearch validate ==="

# --- Test 1: valid config passes ---
$cli init --agent codex --dir "$tmpdir" >/dev/null
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "python3 -c \"print('val_loss=1.42')\"" \
  --evaluation "python3 -c \"print('val_loss=1.30')\"" >/dev/null

set +e
output_pass=$($cli validate --dir "$tmpdir" 2>&1)
validate_pass_exit=$?
set -e

if [ "$validate_pass_exit" -ne 0 ]; then
  echo "FAIL: valid config should pass (exit $validate_pass_exit)"
  echo "$output_pass"
  exit 1
fi
echo "$output_pass" | grep -q "goal.md complete" || { echo "FAIL: missing goal.md complete"; echo "$output_pass"; exit 1; }
echo "$output_pass" | grep -q "Validation PASSED" || { echo "FAIL: missing Validation PASSED"; echo "$output_pass"; exit 1; }
echo "PASS: valid config passes"

# --- Test 2: missing command fails ---
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "this_cmd_does_not_exist_12345 foo" \
  --evaluation "printf 'val_loss=1.30\n'" >/dev/null

set +e
output_missing_cmd=$($cli validate --dir "$tmpdir" 2>&1)
validate_missing_exit=$?
set -e

if [ "$validate_missing_exit" -eq 0 ]; then
  echo "FAIL: missing command should fail"
  echo "$output_missing_cmd"
  exit 1
fi
echo "$output_missing_cmd" | grep -q "command not found: this_cmd_does_not_exist_12345" || { echo "FAIL: missing command name not reported"; echo "$output_missing_cmd"; exit 1; }
echo "PASS: missing command fails with clear message"

# --- Test 3: broken regex fails ---
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric "[invalid(regex" --direction lower \
  --baseline "printf 'val_loss=1.42\n'" \
  --evaluation "printf 'val_loss=1.30\n'" >/dev/null

set +e
output_bad_regex=$($cli validate --dir "$tmpdir" 2>&1)
validate_badregex_exit=$?
set -e

if [ "$validate_badregex_exit" -eq 0 ]; then
  echo "FAIL: broken regex should fail"
  echo "$output_bad_regex"
  exit 1
fi
echo "$output_bad_regex" | grep -q "metric regex invalid" || { echo "FAIL: broken regex not reported"; echo "$output_bad_regex"; exit 1; }
echo "PASS: broken regex fails"

# --- Test 4: missing data globs fails ---
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "printf 'val_loss=1.42\n'" \
  --evaluation "printf 'val_loss=1.30\n'" >/dev/null

# Append data_globs with a non-matching pattern to goal.md
{
  echo ""
  echo "## Data Globs"
  echo "- *.this_pattern_matches_nothing_xyz123456789"
} >> "$tmpdir/.researchloop/goal.md"

set +e
output_missing_glob=$($cli validate --dir "$tmpdir" 2>&1)
validate_missing_glob_exit=$?
set -e

if [ "$validate_missing_glob_exit" -ne 0 ]; then
  echo "FAIL: data glob warning should pass (exit was $validate_missing_glob_exit, expected 0)"
  echo "$output_missing_glob"
  exit 1
fi
echo "$output_missing_glob" | grep -q "warning: no files match" || { echo "FAIL: missing glob warning not found"; echo "$output_missing_glob"; exit 1; }
echo "PASS: missing data glob warns but passes"

# --- Test 5: missing eval.yaml passes with warning ---
rm -f "$tmpdir/.researchloop/eval.yaml"

set +e
output_no_eval=$($cli validate --dir "$tmpdir" 2>&1)
validate_no_eval_exit=$?
set -e

if [ "$validate_no_eval_exit" -ne 0 ]; then
  echo "FAIL: missing eval.yaml should pass (exit $validate_no_eval_exit)"
  echo "$output_no_eval"
  exit 1
fi
echo "$output_no_eval" | grep -q "eval.yaml not present" || { echo "FAIL: missing eval.yaml warning not found"; echo "$output_no_eval"; exit 1; }
echo "PASS: missing eval.yaml passes with warning"

echo ""
echo "autoresearch test:validate passed"