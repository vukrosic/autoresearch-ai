#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
doctor_log="$(mktemp)"
replay_log="$(mktemp)"
cleanup() {
  rm -rf "$tmpdir"
  rm -f "$doctor_log" "$replay_log"
}
trap cleanup EXIT

cli="node $repo_root/bin/researchloop.js"

git init -q "$tmpdir"
git -C "$tmpdir" config user.email "codex@example.com"
git -C "$tmpdir" config user.name "Codex"
printf 'seed\n' >"$tmpdir/model.py"
git -C "$tmpdir" add model.py
git -C "$tmpdir" commit -q -m "seed"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-env-init.log
git -C "$tmpdir" add -A
git -C "$tmpdir" commit -q -m "add researchloop harness"
$cli run --dir "$tmpdir" --id clean-run --command "true" >/tmp/researchloop-env-clean.log

node --input-type=module - "$tmpdir" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const tmpdir = process.argv[2];
const ledger = path.join(tmpdir, ".researchloop", "scratchpad", "runs.jsonl");
const rows = fs
  .readFileSync(ledger, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((row) => JSON.parse(row));
const row = rows.find((entry) => entry.id === "clean-run");
if (!row) throw new Error("missing clean-run row");

const env = row.env;
const requiredKeys = [
  "git_sha",
  "git_dirty",
  "python_version",
  "pip_freeze_sha256",
  "torch_version",
  "cuda_available",
  "cuda_version",
  "gpu_device_names",
  "os",
  "hostname",
];
for (const key of requiredKeys) {
  if (!Object.prototype.hasOwnProperty.call(env, key)) {
    throw new Error(`missing env key: ${key}`);
  }
}
if (typeof env.git_sha !== "string" || !/^[0-9a-f]{40}$/.test(env.git_sha)) {
  throw new Error(`unexpected git_sha: ${env.git_sha}`);
}
if (env.git_dirty !== false) {
  throw new Error(`expected clean git_dirty=false, got ${env.git_dirty}`);
}
if (typeof env.python_version !== "string" || !env.python_version.startsWith("Python ")) {
  throw new Error(`unexpected python_version: ${env.python_version}`);
}
if (env.pip_freeze_sha256 !== null && !/^[0-9a-f]{64}$/.test(env.pip_freeze_sha256)) {
  throw new Error(`unexpected pip_freeze_sha256: ${env.pip_freeze_sha256}`);
}
if (env.cuda_available !== null && typeof env.cuda_available !== "boolean") {
  throw new Error(`unexpected cuda_available: ${env.cuda_available}`);
}
if (env.cuda_available === true) {
  if (env.gpu_device_names !== null && !Array.isArray(env.gpu_device_names)) {
    throw new Error(`unexpected gpu_device_names: ${env.gpu_device_names}`);
  }
} else if (env.gpu_device_names !== null) {
  throw new Error(`expected gpu_device_names=null when CUDA is unavailable, got ${JSON.stringify(env.gpu_device_names)}`);
}
if (env.cuda_available !== true && env.cuda_version !== null) {
  throw new Error(`expected cuda_version=null when CUDA is unavailable, got ${env.cuda_version}`);
}
if (typeof env.os !== "string" || !env.os.trim()) {
  throw new Error(`unexpected os: ${env.os}`);
}
if (typeof env.hostname !== "string" || !env.hostname.trim()) {
  throw new Error(`unexpected hostname: ${env.hostname}`);
}
NODE

printf 'dirty\n' >>"$tmpdir/model.py"

$cli doctor --dir "$tmpdir" >"$doctor_log" 2>&1
grep -q "WARNING: doctor env mismatch git_dirty" "$doctor_log"

$cli replay --dir "$tmpdir" --id clean-run >"$replay_log" 2>&1
grep -q "WARNING: replay env mismatch git_dirty" "$replay_log"

$cli run --dir "$tmpdir" --id dirty-run --command "true" >/tmp/researchloop-env-dirty.log

node --input-type=module - "$tmpdir" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const tmpdir = process.argv[2];
const ledger = path.join(tmpdir, ".researchloop", "scratchpad", "runs.jsonl");
const rows = fs
  .readFileSync(ledger, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((row) => JSON.parse(row));
const row = rows.find((entry) => entry.id === "dirty-run");
if (!row) throw new Error("missing dirty-run row");
if (!row.env) throw new Error("missing env on dirty-run row");
if (row.env.git_dirty !== true) {
  throw new Error(`expected dirty git_dirty=true, got ${row.env.git_dirty}`);
}
NODE

echo "autoresearch test:env passed"
