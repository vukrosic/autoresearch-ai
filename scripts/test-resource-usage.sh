#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/bench.js" <<'JS'
let total = 0;
const end = Date.now() + 1200;
while (Date.now() < end) {
  total += Math.sqrt(total + 1);
}
console.log("latency_ms=12.5");
JS

node "$ROOT/bin/researchloop.js" run \
  --dir "$TMP" \
  --id resource-profile-smoke \
  --command "node bench.js" \
  --metric latency_ms \
  --allow-unsafe >/dev/null

node --input-type=module - "$TMP" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const cwd = process.argv[2];
const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const row = rows.find((entry) => entry.id === "resource-profile-smoke");
if (!row) throw new Error("resource run row missing");
if (!row.resource_profile) throw new Error("resource_profile missing");
if (!(row.resource_profile.samples >= 1)) throw new Error("resource_profile.samples missing");
if (!(row.resource_profile.root_pid > 0)) throw new Error("root pid missing");
if (row.resource_profile.process_memory_peak_mb == null) throw new Error("process memory peak missing");
if (row.process_cpu_max_pct == null) throw new Error("process cpu top-level field missing");

const systemFile = path.join(cwd, ".researchloop", "scratchpad", "runs", "resource-profile-smoke", "system.jsonl");
const samples = fs.readFileSync(systemFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
if (!samples.some((sample) => sample.process && sample.process.active)) {
  throw new Error("active process sample missing");
}
NODE

echo "resource usage smoke ok"
