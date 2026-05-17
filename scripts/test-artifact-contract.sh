#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

cli="node $repo_root/bin/researchloop.js"

git init -q "$tmpdir"
git -C "$tmpdir" config user.email "codex@example.com"
git -C "$tmpdir" config user.name "Codex"
printf 'seed\n' >"$tmpdir/model.py"
git -C "$tmpdir" add model.py
git -C "$tmpdir" commit -q -m "seed"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-artifact-init.log
git -C "$tmpdir" add -A
git -C "$tmpdir" commit -q -m "add researchloop harness"

# 1. Clean run with metric — should produce full artifact bundle.
$cli run --dir "$tmpdir" --id clean-run \
  --command "printf 'step 1 val_loss=0.50\nstep 2 val_loss=0.42\n'" \
  --metric val_loss --no-system-sampling \
  >/tmp/researchloop-artifact-clean.log

node --input-type=module - "$tmpdir" "clean-run" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const tmpdir = process.argv[2];
const runId = process.argv[3];
const runDir = path.join(tmpdir, ".researchloop", "scratchpad", "runs", runId);

const required = ["log.txt", "env.json", "code.diff", "config.json", "metrics.jsonl", "MANIFEST.json"];
for (const name of required) {
  if (!fs.existsSync(path.join(runDir, name))) {
    throw new Error(`missing artifact file: ${name}`);
  }
}
// --no-system-sampling was set, so system.jsonl must NOT exist
if (fs.existsSync(path.join(runDir, "system.jsonl"))) {
  throw new Error("system.jsonl should not exist when --no-system-sampling is set");
}

// env.json shape mirrors row.env
const env = JSON.parse(fs.readFileSync(path.join(runDir, "env.json"), "utf8"));
for (const key of ["git_sha", "git_dirty", "python_version", "pip_freeze_sha256", "torch_version", "cuda_available", "cuda_version", "gpu_device_names", "os", "hostname"]) {
  if (!Object.prototype.hasOwnProperty.call(env, key)) {
    throw new Error(`env.json missing key: ${key}`);
  }
}
if (env.git_dirty !== false) {
  throw new Error(`expected clean git_dirty=false in env.json, got ${env.git_dirty}`);
}

// config.json contains the resolved run config
const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
const expectedConfigKeys = ["run_id", "autoresearch_command", "is_baseline", "inner_command", "metric", "timeout_ms", "allow_unsafe"];
for (const key of expectedConfigKeys) {
  if (!Object.prototype.hasOwnProperty.call(config, key)) {
    throw new Error(`config.json missing key: ${key}`);
  }
}
if (config.run_id !== runId) throw new Error(`config.run_id mismatch: ${config.run_id}`);
if (config.is_baseline !== false) throw new Error(`expected is_baseline=false, got ${config.is_baseline}`);
if (!config.inner_command.includes("val_loss=")) throw new Error(`config.inner_command unexpected: ${config.inner_command}`);
if (config.metric !== "val_loss") throw new Error(`config.metric unexpected: ${config.metric}`);

// metrics.jsonl has one line per parsed sample
const metricsLines = fs.readFileSync(path.join(runDir, "metrics.jsonl"), "utf8").trim().split("\n").filter(Boolean);
if (metricsLines.length < 2) throw new Error(`expected >=2 metric samples, got ${metricsLines.length}`);
for (const line of metricsLines) {
  const entry = JSON.parse(line);
  if (entry.metric !== "val_loss") throw new Error(`metrics line wrong metric: ${line}`);
  if (typeof entry.value !== "number") throw new Error(`metrics line missing numeric value: ${line}`);
}

// code.diff is empty on a clean tree
const codeDiff = fs.readFileSync(path.join(runDir, "code.diff"), "utf8");
if (codeDiff.length !== 0) throw new Error(`expected empty code.diff on clean tree, got ${codeDiff.length} bytes`);

// MANIFEST.json validates size + sha256 of every other file in the dir
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "MANIFEST.json"), "utf8"));
if (!Array.isArray(manifest.files)) throw new Error("manifest.files must be an array");
if (typeof manifest.generated_at !== "string") throw new Error("manifest.generated_at missing");
const filesOnDisk = fs.readdirSync(runDir).filter((name) => name !== "MANIFEST.json").sort();
const manifestNames = manifest.files.map((f) => f.path).sort();
if (JSON.stringify(filesOnDisk) !== JSON.stringify(manifestNames)) {
  throw new Error(`manifest file list mismatch: on-disk=${JSON.stringify(filesOnDisk)} manifest=${JSON.stringify(manifestNames)}`);
}
for (const entry of manifest.files) {
  if (typeof entry.size_bytes !== "number") throw new Error(`manifest entry missing size_bytes: ${JSON.stringify(entry)}`);
  if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`manifest entry has bad sha256: ${JSON.stringify(entry)}`);
  }
  const buf = fs.readFileSync(path.join(runDir, entry.path));
  if (buf.length !== entry.size_bytes) {
    throw new Error(`manifest size mismatch for ${entry.path}: actual=${buf.length} manifest=${entry.size_bytes}`);
  }
  const actualSha = createHash("sha256").update(buf).digest("hex");
  if (actualSha !== entry.sha256) {
    throw new Error(`manifest sha256 mismatch for ${entry.path}: actual=${actualSha} manifest=${entry.sha256}`);
  }
}
NODE

# 2. Dirty tree run — code.diff should be non-empty.
printf 'dirty\n' >>"$tmpdir/model.py"
$cli run --dir "$tmpdir" --id dirty-run \
  --command "printf 'val_loss=0.99\n'" \
  --metric val_loss --no-system-sampling \
  >/tmp/researchloop-artifact-dirty.log

node --input-type=module - "$tmpdir" "dirty-run" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const tmpdir = process.argv[2];
const runId = process.argv[3];
const runDir = path.join(tmpdir, ".researchloop", "scratchpad", "runs", runId);

const codeDiff = fs.readFileSync(path.join(runDir, "code.diff"), "utf8");
if (codeDiff.length === 0) throw new Error("expected non-empty code.diff on dirty tree");
if (!codeDiff.includes("dirty")) throw new Error("code.diff should contain the added line");
NODE

# 3. System sampler default-on — system.jsonl should exist and contain at least the initial sample.
git -C "$tmpdir" checkout -- model.py
$cli run --dir "$tmpdir" --id sampled-run \
  --command "true" --metric val_loss \
  >/tmp/researchloop-artifact-sampled.log

node --input-type=module - "$tmpdir" "sampled-run" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const tmpdir = process.argv[2];
const runId = process.argv[3];
const runDir = path.join(tmpdir, ".researchloop", "scratchpad", "runs", runId);

const sysPath = path.join(runDir, "system.jsonl");
if (!fs.existsSync(sysPath)) throw new Error("system.jsonl missing when sampler is default-on");
const lines = fs.readFileSync(sysPath, "utf8").trim().split("\n").filter(Boolean);
if (lines.length < 1) throw new Error("system.jsonl has no samples");
for (const line of lines) {
  const row = JSON.parse(line);
  for (const key of ["ts", "load_avg_1m", "mem_total_bytes", "mem_free_bytes"]) {
    if (!(key in row)) throw new Error(`system.jsonl row missing ${key}: ${line}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "MANIFEST.json"), "utf8"));
const names = manifest.files.map((f) => f.path);
if (!names.includes("system.jsonl")) throw new Error("manifest should include system.jsonl when sampler ran");
NODE

# 4. RESEARCHLOOP_RUN_DIR is exported to the child process.
$cli run --dir "$tmpdir" --id envvar-run \
  --command 'bash -c "printenv RESEARCHLOOP_RUN_DIR > .researchloop/scratchpad/runs/envvar-run/child-saw-rundir.txt"' \
  --metric val_loss --no-system-sampling \
  >/tmp/researchloop-artifact-envvar.log

node --input-type=module - "$tmpdir" "envvar-run" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const tmpdir = process.argv[2];
const runId = process.argv[3];
const runDir = path.join(tmpdir, ".researchloop", "scratchpad", "runs", runId);

const childSaw = fs.readFileSync(path.join(runDir, "child-saw-rundir.txt"), "utf8").trim();
if (childSaw !== runDir) {
  throw new Error(`child saw wrong RESEARCHLOOP_RUN_DIR: got '${childSaw}', expected '${runDir}'`);
}
// Manifest picked up the child-written file automatically.
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "MANIFEST.json"), "utf8"));
if (!manifest.files.some((f) => f.path === "child-saw-rundir.txt")) {
  throw new Error("manifest should include child-written child-saw-rundir.txt");
}
NODE

echo "autoresearch test:artifact-contract passed"
