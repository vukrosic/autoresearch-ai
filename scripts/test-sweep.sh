#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"
fixtures="$repo_root/examples/fixtures/sweeps"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-sweep-init.log
mkdir -p "$tmpdir/.researchloop/sweeps"
cp "$fixtures"/grid.yaml "$tmpdir/.researchloop/sweeps/lr-grid.yaml"
cp "$fixtures"/random.yaml "$tmpdir/.researchloop/sweeps/rand-seed.yaml"
cp "$fixtures"/list.yaml "$tmpdir/.researchloop/sweeps/lr-list.yaml"

echo "--- Test 1: grid sweep generates a stable 2x2 queue ---"
$cli sweep generate lr-grid --dir "$tmpdir" >/tmp/autoresearch-sweep-grid-generate.log
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
$cli sweep status lr-grid --dir "$tmpdir" >/tmp/autoresearch-sweep-grid-status.log
grep -q "queued: 4 running: 0 done: 0 failed: 0" /tmp/autoresearch-sweep-grid-status.log

echo "--- Test 2: random sweep re-runs identically with the same seed ---"
$cli sweep generate rand-seed --dir "$tmpdir" >/tmp/autoresearch-sweep-rand-1.log
grep -q "rows: 10" /tmp/autoresearch-sweep-rand-1.log
cp "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl" /tmp/autoresearch-sweep-rand-1.jsonl
$cli sweep generate rand-seed --dir "$tmpdir" >/tmp/autoresearch-sweep-rand-2.log
cmp -s /tmp/autoresearch-sweep-rand-1.jsonl "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl"
node --input-type=module - "$tmpdir/.researchloop/sweeps/rand-seed.queue.jsonl" <<'NODE'
import fs from "node:fs";
const file = process.argv[2];
const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (rows.length !== 10) throw new Error(`expected 10 rows, got ${rows.length}`);
if (new Set(rows.map((row) => row.id)).size !== 10) throw new Error("random sweep ids are not unique");
NODE

echo "--- Test 3: list sweep preserves explicit row ordering ---"
$cli sweep generate lr-list --dir "$tmpdir" >/tmp/autoresearch-sweep-list-generate.log
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
$cli sweep --dir "$tmpdir" --spec "$tmpdir/legacy-sweep.json" --metric val_loss --direction lower --dry-run >/tmp/autoresearch-sweep-legacy.log
grep -q "variants: 2" /tmp/autoresearch-sweep-legacy.log
grep -q "dry-run: no runs executed" /tmp/autoresearch-sweep-legacy.log

echo "autoresearch test:sweep passed"
