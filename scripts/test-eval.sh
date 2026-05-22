#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-eval-init.log
$cli goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower \
  --baseline "python train.py" --evaluation "python eval.py" \
  >/tmp/autoresearch-eval-goal.log

cat > "$tmpdir/.researchloop/eval.yaml" <<'YAML'
metrics:
  - {name: val_loss, direction: lower, regex_or_jsonpath: "val_loss=([0-9.]+)", source: stdout}
  - {name: val_acc, direction: higher, regex_or_jsonpath: "$.val_acc", source: file, file: eval.json}
  - {name: missing_metric, direction: higher, regex_or_jsonpath: "never_matches=([0-9.]+)", source: stdout}
YAML

cat > "$tmpdir/eval.py" <<'PY'
import json
import os

run_id = os.environ.get("RESEARCHLOOP_RUN_ID", "")
val_acc = 0.91 if run_id.endswith("b") else 0.87
with open("eval.json", "w", encoding="utf-8") as handle:
    json.dump({"val_acc": val_acc}, handle)
print("val_loss=0.42")
PY

printf 'eval_command: "python %s/eval.py"\n' "$tmpdir" >> "$tmpdir/.researchloop/eval.yaml"

$cli run --dir "$tmpdir" --id eval-a --command 'printf "train start\n"' >/tmp/autoresearch-eval-run-a.log
$cli run --dir "$tmpdir" --id eval-b --command 'printf "train start\n"' >/tmp/autoresearch-eval-run-b.log

ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
python3 - "$ledger" <<'PY'
import json, pathlib, sys

rows = {}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    if row.get("id") in {"eval-a", "eval-b"}:
        rows[row["id"]] = row

assert set(rows) == {"eval-a", "eval-b"}, rows.keys()
for run_id, expected_acc in {"eval-a": 0.87, "eval-b": 0.91}.items():
    row = rows[run_id]
    assert row["status"] == "complete", row["status"]
    assert row["eval_status"] == "complete", row.get("eval_status")
    assert abs(row["metrics"]["val_loss"] - 0.42) < 1e-9, row["metrics"]["val_loss"]
    assert abs(row["metrics"]["val_acc"] - expected_acc) < 1e-9, row["metrics"]["val_acc"]
    assert row["metrics"]["missing_metric"] is None, row["metrics"]["missing_metric"]
    assert any("missing_metric" in warning for warning in row.get("parse_warnings", [])), row.get("parse_warnings")
print("OK: auto-eval rows recorded with null missing metrics")
PY

COMPARE_OUT="$($cli compare --dir "$tmpdir" --metric val_acc --direction higher eval-a eval-b)"
printf '%s\n' "$COMPARE_OUT" | grep -q "best: eval-b = 0.91"
printf '%s\n' "$COMPARE_OUT" | grep -q "worst: eval-a = 0.87"

EVAL_JSON="$($cli eval --dir "$tmpdir" --run-id eval-a --format json)"
printf '%s\n' "$EVAL_JSON" | python3 -c '
import json, sys

data = json.loads(sys.stdin.read())
assert data["run_id"] == "eval-a", data["run_id"]
assert data["status"] == "complete", data["status"]
assert abs(data["metrics"]["val_loss"] - 0.42) < 1e-9, data["metrics"]["val_loss"]
assert abs(data["metrics"]["val_acc"] - 0.87) < 1e-9, data["metrics"]["val_acc"]
assert data["metrics"]["missing_metric"] is None, data["metrics"]["missing_metric"]
assert any("missing_metric" in warning for warning in data.get("warnings", [])), data.get("warnings")
print("OK: eval json output parsed")
'

set +e
$cli eval --dir "$tmpdir" --run-id eval-a --command "git --version" >/tmp/autoresearch-eval-blocked.log 2>&1
blocked_eval_exit=$?
set -e
if [ "$blocked_eval_exit" -eq 0 ]; then
  echo "expected eval to fail for disallowed command"
  exit 1
fi
grep -q "eval: blocked by safety: allow_prefixes" /tmp/autoresearch-eval-blocked.log

echo "autoresearch test:eval passed"
