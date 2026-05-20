#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

cli="node $repo_root/bin/researchloop.js"
ledger_dir="$fixture/.researchloop/scratchpad"
mkdir -p "$ledger_dir"
cp "$repo_root/examples/fixtures/runs/runs.jsonl" "$ledger_dir/runs.jsonl"

echo "=== Test G13 query ==="

echo "--- Test 1: jsonl query returns up to 3 valid rows sorted by metric ---"
out_jsonl="$($cli query "where metrics.val_loss < 0.5 sort-by metrics.val_loss asc limit 3" --format jsonl --dir "$fixture")"
printf '%s\n' "$out_jsonl"
node --input-type=module - "$out_jsonl" <<'NODE'
const lines = process.argv[2].trim().split("\n").filter(Boolean);
if (lines.length !== 3) throw new Error(`expected 3 jsonl rows, got ${lines.length}`);
const rows = lines.map((line) => JSON.parse(line));
const ids = rows.map((row) => row.id).join(",");
if (ids !== "r5,r4,r2") throw new Error(`unexpected sorted ids: ${ids}`);
for (const row of rows) {
  if (!(row.metrics.val_loss < 0.5)) throw new Error(`row does not match predicate: ${row.id}`);
}
NODE

echo "--- Test 2: table query supports nested params and contains ---"
out_table="$($cli query "where status = completed and params.lr >= 0.01 sort-by params.lr desc limit 2" --dir "$fixture")"
printf '%s\n' "$out_table"
grep -q "| r5 | completed |" <<<"$out_table"
grep -q "| r4 | completed |" <<<"$out_table"
if grep -q "| r2 | completed |" <<<"$out_table"; then
  echo "expected r2 to be filtered out"
  exit 1
fi

echo "--- Test 3: between operator includes endpoints ---"
out_between="$($cli query "where metrics.val_loss between 0.20..0.50" --dir "$fixture")"
printf '%s\n' "$out_between"
grep -q "| r1 |" <<<"$out_between"
grep -q "| r4 |" <<<"$out_between"

echo "--- Test 4: jsonl empty result exits 0 with no output ---"
out_empty_jsonl="$($cli query "where metrics.val_loss > 100" --format jsonl --dir "$fixture")"
if [[ -n "$out_empty_jsonl" ]]; then
  echo "expected empty jsonl output, got: $out_empty_jsonl"
  exit 1
fi

echo "--- Test 5: table empty result prints an empty header row ---"
out_empty_table="$($cli query "where metrics.val_loss > 100" --dir "$fixture")"
printf '%s\n' "$out_empty_table"
grep -q "| id | status | timestamp | value | metrics.val_loss | params.lr |" <<<"$out_empty_table"
if grep -q "| r[0-9] |" <<<"$out_empty_table"; then
  echo "expected no data rows in empty table result"
  exit 1
fi

echo "--- Test 6: invalid syntax exits non-zero with a clear error ---"
set +e
bad_out="$($cli query "whatever" --dir "$fixture" 2>&1)"
bad_status=$?
set -e
printf '%s\n' "$bad_out"
if [[ "$bad_status" -eq 0 ]]; then
  echo "expected invalid query to exit non-zero"
  exit 1
fi
grep -q 'query: expression must start with "where"' <<<"$bad_out"

echo "autoresearch test:query passed"
