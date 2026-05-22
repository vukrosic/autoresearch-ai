#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"
fixtures="$repo_root/examples/fixtures/sweeps"

$cli init --agent codex --dir "$tmpdir" >/tmp/autoresearch-sweep-run-init.log
mkdir -p "$tmpdir/.researchloop/sweeps"
cp "$fixtures"/run-demo.yaml "$tmpdir/.researchloop/sweeps/demo-run.yaml"
cp "$fixtures"/maxfail.yaml "$tmpdir/.researchloop/sweeps/stop-after-two.yaml"

echo "--- Test 1: 6-row sweep completes under two workers ---"
$cli sweep run demo-run --dir "$tmpdir" --workers 2 >/tmp/autoresearch-sweep-run-demo.log
grep -q "workers: 2" /tmp/autoresearch-sweep-run-demo.log
grep -q "completed: 6/6" /tmp/autoresearch-sweep-run-demo.log
grep -q "done: 4" /tmp/autoresearch-sweep-run-demo.log
grep -q "failed: 2" /tmp/autoresearch-sweep-run-demo.log
grep -q "queued: 0" /tmp/autoresearch-sweep-run-demo.log
grep -q "running: 0" /tmp/autoresearch-sweep-run-demo.log
grep -q "best: demo-run-005" /tmp/autoresearch-sweep-run-demo.log
test -f "$tmpdir/.researchloop/sweeps/demo-run.queue.jsonl"
node --input-type=module - "$tmpdir/.researchloop/sweeps/demo-run.queue.jsonl" <<'NODE'
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
if (counts.done !== 4 || counts.failed !== 2) {
  throw new Error(`unexpected queue counts: ${JSON.stringify(counts)}`);
}
NODE
ledger="$tmpdir/.researchloop/scratchpad/runs.jsonl"
test -f "$ledger"
run_count_before="$(node --input-type=module - "$ledger" <<'NODE'
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
console.log(rows.length);
NODE
)"
test "$run_count_before" -eq 6

echo "--- Test 2: rerunning a finished sweep is a no-op ---"
$cli sweep run demo-run --dir "$tmpdir" --workers 2 >/tmp/autoresearch-sweep-run-demo-rerun.log
grep -q "completed: 6/6" /tmp/autoresearch-sweep-run-demo-rerun.log
run_count_after="$(node --input-type=module - "$ledger" <<'NODE'
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
console.log(rows.length);
NODE
)"
test "$run_count_after" -eq 6

echo "--- Test 3: max-failure cap stops the run after two failures ---"
$cli sweep run stop-after-two --dir "$tmpdir" --workers 1 --max-failures 2 >/tmp/autoresearch-sweep-run-stop.log
grep -q "max_failures: 2" /tmp/autoresearch-sweep-run-stop.log
grep -q "failed: 2" /tmp/autoresearch-sweep-run-stop.log
grep -q "queued: 4" /tmp/autoresearch-sweep-run-stop.log
grep -q "running: 0" /tmp/autoresearch-sweep-run-stop.log
node --input-type=module - "$tmpdir/.researchloop/sweeps/stop-after-two.queue.jsonl" <<'NODE'
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
if (counts.failed !== 2 || counts.queued !== 4) {
  throw new Error(`unexpected queue counts: ${JSON.stringify(counts)}`);
}
NODE

echo "autoresearch test:sweep-run passed"
