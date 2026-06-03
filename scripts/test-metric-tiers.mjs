#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "researchloop.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-metric-tiers-"));
const scratch = path.join(tmp, ".researchloop", "scratchpad");
fs.mkdirSync(scratch, { recursive: true });

const rows = [
  {
    id: "baseline-cpu",
    timestamp: "2026-06-02T00:00:00.000Z",
    status: "complete",
    agent: "autoresearch baseline",
    command: "bench --baseline",
    metrics: {
      tflops: 1.0,
      memory_bandwidth: 100,
      speedup: 1.0,
      p95_latency: 12,
      kernel_time: 10,
      gpu_util: 40,
      cpu_util: 70,
      cache_miss_rate: 0.12,
      launch_overhead: 0.5,
    },
  },
  {
    id: "run-optimized",
    timestamp: "2026-06-02T00:01:00.000Z",
    status: "complete",
    agent: "autoresearch run",
    command: "bench --optimized",
    metrics: {
      tflops: 1.25,
      memory_bandwidth: 118,
      speedup: 1.2,
      p95_latency: 10,
      kernel_time: 8,
      gpu_util: 55,
      cpu_util: 75,
      cache_miss_rate: 0.08,
      launch_overhead: 0.42,
    },
  },
];
fs.writeFileSync(path.join(scratch, "runs.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

function run(args) {
  const res = spawnSync(process.execPath, [cli, ...args, "--dir", tmp], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`command failed: ${args.join(" ")}\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

run(["metric-tiers", "init", "--profile", "hpc_operator"]);
const score = JSON.parse(run(["metric-tiers", "score", "--format", "json"]));
if (score.recommendation?.code !== "recommended") {
  throw new Error(`expected recommended, got ${JSON.stringify(score.recommendation)}`);
}
if (score.baseline_id !== "baseline-cpu" || score.candidate_id !== "run-optimized") {
  throw new Error(`unexpected comparison ids: ${score.baseline_id} vs ${score.candidate_id}`);
}
if (!Number.isFinite(Number(score.overall_score)) || Number(score.overall_score) <= 0) {
  throw new Error(`expected positive score, got ${score.overall_score}`);
}

const compare = run(["compare", "--metric", "tflops", "--direction", "higher"]);
if (!compare.includes("metric_tiers:") || !compare.includes("recommendation: 推荐")) {
  throw new Error(`compare output missing metric tier summary:\n${compare}`);
}

run(["report", "--format", "markdown", "--out", ".researchloop/scratchpad/report.md"]);
const report = fs.readFileSync(path.join(scratch, "report.md"), "utf8");
if (!report.includes("## Multi-Level Metric Score") || !report.includes("**推荐**")) {
  throw new Error("report missing multi-level metric score section");
}

console.log("metric tiers ok");
