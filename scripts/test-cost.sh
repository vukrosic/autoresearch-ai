#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/dev/null 2>&1

echo "=== Test 1: run records wall_seconds ==="
$cli run --command "sleep 1 && echo val_loss=0.5" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
node --input-type=module - "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'NODE'
import fs from "node:fs";

const ledger = process.argv[2];
const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const row = rows.at(-1);
if (!Number.isFinite(row.wall_seconds) || row.wall_seconds < 1) {
  throw new Error(`wall_seconds not recorded correctly: ${row.wall_seconds}`);
}
if (typeof row.started_at !== "string" || typeof row.ended_at !== "string") {
  throw new Error("started_at and ended_at must be ISO strings");
}
if (row.est_cost_usd !== null) {
  throw new Error(`est_cost_usd should be null without cost.yaml, got ${row.est_cost_usd}`);
}
console.log(`wall_seconds: ${row.wall_seconds}`);
NODE
echo "PASS: wall_seconds recorded with timestamps"

echo ""
echo "=== Test 2: cost.yaml produces est_cost_usd ==="
echo "gpu: H100
hourly_usd: 2.50" > "$tmpdir/.researchloop/cost.yaml"
$cli run --command "sleep 2 && echo val_loss=0.6" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
node --input-type=module - "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'NODE'
import fs from "node:fs";

const ledger = process.argv[2];
const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const row = rows.at(-1);
const expected = Number((row.wall_seconds / 3600 * 2.5).toFixed(4));
if (row.est_cost_usd !== expected) {
  throw new Error(`est_cost_usd arithmetic mismatch: got ${row.est_cost_usd}, expected ${expected}`);
}
console.log(`est_cost_usd: ${row.est_cost_usd}`);
NODE
echo "PASS: est_cost_usd computed from wall_seconds and hourly_usd"

$cli report --dir "$tmpdir" >/tmp/researchloop-cost-report.log
grep -q "wall_time:" /tmp/researchloop-cost-report.log
grep -q "estimated_cost_usd:" /tmp/researchloop-cost-report.log

echo ""
echo "=== Test 3: no cost.yaml gives null est_cost_usd ==="
rm "$tmpdir/.researchloop/cost.yaml"
$cli run --command "sleep 1 && echo val_loss=0.7" --metric val_loss --dir "$tmpdir" >/dev/null 2>&1
node --input-type=module - "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'NODE'
import fs from "node:fs";

const ledger = process.argv[2];
const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const row = rows.at(-1);
if (row.est_cost_usd !== null) {
  throw new Error(`est_cost_usd should be null without cost.yaml, got ${row.est_cost_usd}`);
}
console.log(`est_cost_usd: ${row.est_cost_usd}`);
NODE
echo "PASS: est_cost_usd is null without cost.yaml"

echo ""
echo "ALL TESTS PASSED"
