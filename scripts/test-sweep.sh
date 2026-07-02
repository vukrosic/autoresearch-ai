#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")
fixtures="$repo_root/examples/fixtures/sweeps"

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-sweep-init.log
mkdir -p "$tmpdir/.researchloop/sweeps"
cp "$fixtures"/grid.yaml "$tmpdir/.researchloop/sweeps/lr-grid.yaml"
cp "$fixtures"/random.yaml "$tmpdir/.researchloop/sweeps/rand-seed.yaml"
cp "$fixtures"/list.yaml "$tmpdir/.researchloop/sweeps/lr-list.yaml"

echo "--- Test 1: grid sweep generates a stable 2x2 queue ---"
"${cli[@]}" sweep generate lr-grid --dir "$tmpdir" >/tmp/autoresearch-sweep-grid-generate.log
grep -q "rows: 4" /tmp/autoresearch-sweep-grid-generate.log
grep -q "queue: .researchloop/sweeps/lr-grid.queue.jsonl" /tmp/autoresearch-sweep-grid-generate.log
queue="$tmpdir/.researchloop/sweeps/lr-grid.queue.jsonl"
test -f "$queue"
node --input-type=module - "$queue" <<'NODE'
import fs from "node:fs";
const file = process.argv[2];
const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (rows.length !== 4) throw new Error(`expected 4 rows, got ${rows.length}`);
if (new Set(rows.map((row) => row.id)).size !== 4) throw new Error("ids are not unique");
if (!rows.some((row) => row.command.includes("batch_size=64"))) throw new Error("missing rendered batch_size variant");
NODE
"${cli[@]}" sweep status lr-grid --dir "$tmpdir" >/tmp/autoresearch-sweep-grid-status.log
grep -q "queued: 4 running: 0 done: 0 failed: 0" /tmp/autoresearch-sweep-grid-status.log

echo "--- Test 2: random sweep re-runs identically with the same seed ---"
"${cli[@]}" sweep generate rand-seed --dir "$tmpdir" >/tmp/autoresearch-sweep-rand-1.log
grep -q "rows: 10" /tmp/autoresearch-sweep-rand-1.log
cp "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl" /tmp/autoresearch-sweep-rand-1.jsonl
"${cli[@]}" sweep generate rand-seed --dir "$tmpdir" >/tmp/autoresearch-sweep-rand-2.log
cmp -s /tmp/autoresearch-sweep-rand-1.jsonl "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl"
node --input-type=module - "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl" <<'NODE'
import fs from "node:fs";
const file = process.argv[2];
const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (rows.length !== 10) throw new Error(`expected 10 rows, got ${rows.length}`);
if (new Set(rows.map((row) => row.id)).size !== 10) throw new Error("random sweep ids are not unique");
NODE

echo "--- Test 3: list sweep preserves explicit row ordering ---"
"${cli[@]}" sweep generate lr-list --dir "$tmpdir" >/tmp/autoresearch-sweep-list-generate.log
grep -q "rows: 3" /tmp/autoresearch-sweep-list-generate.log
node --input-type=module - "$tmpdir/.researchloop/sweeps/lr-list.queue.jsonl" <<'NODE'
import fs from "node:fs";
const file = process.argv[2];
const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (rows.length !== 3) throw new Error(`expected 3 rows, got ${rows.length}`);
const losses = rows.map((row) => row.params.lr);
if (JSON.stringify(losses) !== JSON.stringify([0.5, 0.3, 0.1])) {
  throw new Error(`unexpected list order: ${JSON.stringify(losses)}`);
}
NODE

echo "--- Test 4: legacy one-shot sweep still works ---"
cat > "$tmpdir/legacy-sweep.json" <<'JSON'
{
  "name": "legacy",
  "command_template": "printf 'val_loss={lr}\\n'",
  "variants": [
    {"lr": 0.50},
    {"lr": 0.20}
  ]
}
JSON
# Dry-run should print all variants and not record runs.
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/legacy-sweep.json" --metric val_loss --direction lower --dry-run >/tmp/autoresearch-sweep-dry.log
grep -q "variants: 2" /tmp/autoresearch-sweep-dry.log
grep -q "dry-run: no runs executed" /tmp/autoresearch-sweep-dry.log
if [ -f "$tmpdir/.researchloop/scratchpad/runs.jsonl" ]; then
  if grep -q "legacy" "$tmpdir/.researchloop/scratchpad/runs.jsonl" 2>/dev/null; then
    echo "dry-run should not record runs"
    exit 1
  fi
fi

# Real sweep run.
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/legacy-sweep.json" --metric val_loss --direction lower >/tmp/autoresearch-sweep-run.log
grep -q "sweep: legacy" /tmp/autoresearch-sweep-run.log
grep -q "completed: 2/2" /tmp/autoresearch-sweep-run.log
grep -q "scored: 2" /tmp/autoresearch-sweep-run.log
grep -q 'val_loss=0.2' /tmp/autoresearch-sweep-run.log
# Best should be lr=0.20 (lowest val_loss).
grep -q '"lr":0.2' /tmp/autoresearch-sweep-run.log
test -f "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"sweep":"legacy"' "$tmpdir/.researchloop/scratchpad/runs.jsonl" || \
  grep -q 'sweep:legacy' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

# Grid spec: 2x2 cross product = 4 variants.
cat > "$tmpdir/sweep-grid.json" <<'JSON'
{
  "name": "grid",
  "command_template": "printf 'accuracy={hidden}\\n'",
  "grid": {
    "lr": [0.001, 0.01],
    "hidden": [128, 256]
  }
}
JSON

"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-grid.json" --metric accuracy --direction higher >/tmp/autoresearch-sweep-grid.log
grep -q "variants: 4" /tmp/autoresearch-sweep-grid.log
grep -q "completed: 4/4" /tmp/autoresearch-sweep-grid.log

# Summary file should exist.
test -d "$tmpdir/.researchloop/scratchpad/sweeps"

# Bad spec is rejected.
echo "{ this is not json" > "$tmpdir/sweep-bad.json"
set +e
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-bad.json" >/tmp/autoresearch-sweep-bad.log 2>&1
bad_exit=$?
set -e
if [ "$bad_exit" -eq 0 ]; then
  echo "expected invalid sweep spec to exit nonzero"
  exit 1
fi
grep -q "sweep spec" /tmp/autoresearch-sweep-bad.log

echo "autoresearch test:sweep passed"
