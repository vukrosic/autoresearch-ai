#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="node $repo_root/bin/researchloop.js"

tmp_no_python="$(mktemp -d)"
tmp_missing_dep="$(mktemp -d)"
tmp_no_metric="$(mktemp -d)"
tmp_scaffold="$(mktemp -d)"
tmp_timeout="$(mktemp -d)"
sandbox_bin="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_no_python" "$tmp_missing_dep" "$tmp_no_metric" "$tmp_scaffold" "$tmp_timeout" "$sandbox_bin"
}
trap cleanup EXIT

ln -s "$(command -v node)" "$sandbox_bin/node"
ln -s "$(command -v git)" "$sandbox_bin/git"
ln -s "$(command -v npm)" "$sandbox_bin/npm"

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "FAIL: expected '$needle' in $file"
    cat "$file"
    exit 1
  fi
}

echo "=== Test 1: Missing Python ==="
$cli init --agent codex --dir "$tmp_no_python" >/tmp/researchloop-doctor-repair-init-no-python.log
PATH="$sandbox_bin" $cli doctor --dir "$tmp_no_python" --repair-plan >/tmp/researchloop-doctor-repair-no-python.log 2>&1 || true
assert_contains "install Python" /tmp/researchloop-doctor-repair-no-python.log
assert_contains "Repair plan:" /tmp/researchloop-doctor-repair-no-python.log

echo ""
echo "=== Test 2: Missing dependency ==="
$cli init --agent codex --dir "$tmp_missing_dep" >/tmp/researchloop-doctor-repair-init-missing-dep.log
$cli run --dir "$tmp_missing_dep" --id missing-dep --command "python3 -c 'import definitely_missing_module_12345'" >/tmp/researchloop-doctor-repair-run-missing-dep.log 2>&1 || true
PATH="$sandbox_bin:$PATH" $cli doctor --dir "$tmp_missing_dep" --repair-plan >/tmp/researchloop-doctor-repair-missing-dep.log 2>&1 || true
assert_contains "missing dependency" /tmp/researchloop-doctor-repair-missing-dep.log
assert_contains "definitely_missing_module_12345" /tmp/researchloop-doctor-repair-missing-dep.log

echo ""
echo "=== Test 3: No metric matched ==="
$cli init --agent codex --dir "$tmp_no_metric" >/tmp/researchloop-doctor-repair-init-no-metric.log
mkdir -p "$tmp_no_metric/.researchloop"
cat > "$tmp_no_metric/.researchloop/eval.yaml" <<'EOF'
metrics:
  - name: val_loss
    direction: lower
    regex_or_jsonpath: 'val_loss=([0-9.]+)'
    source: stdout
eval_command: python eval.py
EOF
$cli run --dir "$tmp_no_metric" --id no-metric --metric val_loss --command "printf 'hello world\n'" >/tmp/researchloop-doctor-repair-run-no-metric.log 2>&1 || true
PATH="$sandbox_bin:$PATH" $cli doctor --dir "$tmp_no_metric" --repair-plan >/tmp/researchloop-doctor-repair-no-metric.log 2>&1 || true
assert_contains "no metric parsed from last run" /tmp/researchloop-doctor-repair-no-metric.log
assert_contains "val_loss=([0-9.]+)" /tmp/researchloop-doctor-repair-no-metric.log

echo ""
echo "=== Test 4: Partial scaffold ==="
$cli init --agent codex --dir "$tmp_scaffold" >/tmp/researchloop-doctor-repair-init-scaffold.log
rm -f "$tmp_scaffold/.researchloop/plan.md"
rm -f "$tmp_scaffold/.researchloop/scratchpad/runs.jsonl"
PATH="$sandbox_bin:$PATH" $cli doctor --dir "$tmp_scaffold" --repair-plan >/tmp/researchloop-doctor-repair-scaffold.log 2>&1 || true
assert_contains "partial .researchloop scaffold" /tmp/researchloop-doctor-repair-scaffold.log

echo ""
echo "=== Test 5: Command timeout ==="
$cli init --agent codex --dir "$tmp_timeout" >/tmp/researchloop-doctor-repair-init-timeout.log
$cli run --dir "$tmp_timeout" --id timeout-run --command "sleep 5" --timeout 1 >/tmp/researchloop-doctor-repair-run-timeout.log 2>&1 || true
PATH="$sandbox_bin:$PATH" $cli doctor --dir "$tmp_timeout" --repair-plan >/tmp/researchloop-doctor-repair-timeout.log 2>&1 || true
assert_contains "command timeout" /tmp/researchloop-doctor-repair-timeout.log

echo ""
echo "ALL TESTS PASSED"
