// `autoresearch sweep-projection` — pre-flight cost & wall time for a sweep.
//
// Today `sweep generate <name>` builds the queue and `sweep run <name>` fires
// it. A common foot-gun: the agent submits a 600-cell grid and only discovers
// at hour 9 that it was going to take three days. This command answers
// "what's this sweep going to cost me?" *before* anything launches.
//
// Modes:
//   --name <sweep>     read .researchloop/sweeps/<name>.queue.jsonl directly
//   --spec FILE.yaml   read a spec file and use the cross-product cardinality
//   --n N              just project N runs without any spec / queue
//
// Time-per-run estimate (in priority):
//   --seconds-per-run N         user override
//   median wall_seconds over runs sharing the queue's base_command (token overlap)
//   median wall_seconds across the entire ledger
//   `null` (and a loud warning that the projection is just a count)
//
// Cost-per-run pulls from .researchloop/cost.yaml hourly_usd × seconds/3600,
// per the standard G23 cost-accounting convention.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, loadCostYaml, arrMedian, percentile } from "./researchloop-core.js";

function readQueue(cwd, sweepName) {
  const p = path.join(cwd, ".researchloop", "sweeps", `${sweepName}.queue.jsonl`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readSpecYaml(p) {
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  // Tiny YAML reader — just enough for the grid/list cases the sweep generator
  // uses. We don't ship a YAML dep and the queue file is the source of truth
  // anyway, so this is best-effort.
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function tokens(s) {
  return new Set(String(s || "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function pickReferenceSecs(rows, queueCommand) {
  const finished = rows.filter((r) => Number.isFinite(Number(r.wall_seconds)));
  if (finished.length === 0) return { secs: null, n: 0, source: "no-data" };
  if (queueCommand) {
    const target = tokens(queueCommand);
    const scored = finished.map((r) => ({ r, sim: jaccard(tokens(r.command || ""), target) }))
      .filter((x) => x.sim >= 0.3)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 10);
    if (scored.length >= 3) {
      const secs = arrMedian(scored.map((x) => Number(x.r.wall_seconds)));
      return { secs, n: scored.length, source: "similar-command", p95: percentile(scored.map((x) => Number(x.r.wall_seconds)), 0.95) };
    }
  }
  const all = finished.map((r) => Number(r.wall_seconds));
  return { secs: arrMedian(all), n: all.length, source: "ledger-median", p95: percentile(all, 0.95) };
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec === null) return "—";
  if (sec >= 86400) return `${(sec / 86400).toFixed(2)} d`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(2)} h`;
  if (sec >= 60) return `${(sec / 60).toFixed(1)} m`;
  return `${sec.toFixed(1)} s`;
}

export async function cmdSweepProjection(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const sweepName = option("--name", null);
  const specPath = option("--spec", null);
  const nOverride = option("--n", null);
  const secsOverride = option("--seconds-per-run", null);
  const costOverride = option("--cost-per-run", null);
  const workers = Math.max(1, parseInt(String(option("--workers", "1")), 10) || 1);

  let queue = null;
  let nRuns = null;
  let baseCommand = null;

  if (sweepName) {
    queue = readQueue(cwd, sweepName);
    if (!queue) {
      console.error(`Sweep queue not found at .researchloop/sweeps/${sweepName}.queue.jsonl — run \`autoresearch sweep generate ${sweepName}\` first.`);
      process.exitCode = 1;
      return;
    }
    // Only "queued" rows are still in front of us. "running" rows are
    // already in flight (don't double-count compute), "done"/"completed"
    // are finished, "failed" rows won't auto-retry. Default to remaining
    // queued + currently-running; the user can pass --include all to count
    // the full sweep size.
    const includeAll = option("--include", null) === "all";
    nRuns = includeAll
      ? queue.length
      : queue.filter((r) => ["queued", "running"].includes(String(r.status || "queued"))).length;
    baseCommand = queue.find((r) => r.command)?.command || null;
  } else if (specPath) {
    const spec = readSpecYaml(specPath);
    if (!spec) {
      console.error(`Spec not found or unreadable: ${specPath}`);
      process.exitCode = 1;
      return;
    }
    const budget = Number(spec.budget);
    if (Number.isFinite(budget)) nRuns = budget;
    baseCommand = spec.base_command || null;
  } else if (nOverride) {
    nRuns = parseInt(String(nOverride), 10);
  } else {
    console.error("Usage: autoresearch sweep-projection --name <sweep>            (project an already-generated queue)");
    console.error("   or: autoresearch sweep-projection --spec FILE.yaml          (project a spec's budget)");
    console.error("   or: autoresearch sweep-projection --n 600 [--seconds-per-run 1800] [--workers 4]");
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(nRuns) || nRuns <= 0) {
    console.error(`Could not determine run count.`);
    process.exitCode = 1;
    return;
  }

  // Time per run.
  let secsPerRun = secsOverride ? parseFloat(String(secsOverride)) : null;
  let secsP95 = null;
  let secsSource = "user-override";
  let secsN = null;
  if (!Number.isFinite(secsPerRun)) {
    const rows = readLedgerRows(cwd);
    const ref = pickReferenceSecs(rows, baseCommand);
    secsPerRun = ref.secs;
    secsP95 = ref.p95;
    secsSource = ref.source;
    secsN = ref.n;
  }

  // Cost per run.
  const cost = loadCostYaml(cwd);
  let costPerRun = costOverride ? parseFloat(String(costOverride)) : null;
  if (!Number.isFinite(costPerRun) && cost && Number.isFinite(cost.hourly_usd) && Number.isFinite(secsPerRun)) {
    costPerRun = (secsPerRun / 3600) * cost.hourly_usd;
  }

  const totalSerialSecs = Number.isFinite(secsPerRun) ? secsPerRun * nRuns : null;
  const totalWallSecs = Number.isFinite(totalSerialSecs) ? totalSerialSecs / workers : null;
  const totalCost = Number.isFinite(costPerRun) ? costPerRun * nRuns : null;
  const totalCostP95 = Number.isFinite(secsP95) && cost && Number.isFinite(cost.hourly_usd)
    ? (secsP95 / 3600) * cost.hourly_usd * nRuns : null;

  if (formatJson) {
    console.log(JSON.stringify({
      sweep_name: sweepName,
      spec_path: specPath,
      n_runs: nRuns,
      base_command: baseCommand,
      workers,
      seconds_per_run: secsPerRun,
      seconds_per_run_p95: secsP95,
      seconds_source: secsSource,
      seconds_n_reference: secsN,
      cost_per_run_usd: costPerRun,
      total_serial_seconds: totalSerialSecs,
      total_wall_seconds: totalWallSecs,
      total_cost_usd: totalCost,
      total_cost_usd_p95: totalCostP95,
      cost_yaml_present: !!cost,
    }, null, 2));
    return;
  }

  console.log("autoresearch sweep-projection");
  if (sweepName) console.log(`sweep: ${sweepName}`);
  if (specPath) console.log(`spec:  ${specPath}`);
  if (baseCommand) console.log(`base:  ${baseCommand.slice(0, 100)}${baseCommand.length > 100 ? "…" : ""}`);
  console.log(`runs:  ${nRuns}   workers: ${workers}`);
  console.log("---");
  console.log(`seconds/run: ${Number.isFinite(secsPerRun) ? secsPerRun.toFixed(1) + " s" : "unknown"}  (source: ${secsSource}${secsN !== null ? `, n=${secsN}` : ""})${Number.isFinite(secsP95) ? `   p95: ${secsP95.toFixed(1)} s` : ""}`);
  console.log(`wall (serial):    ${fmtDuration(totalSerialSecs)}`);
  console.log(`wall (×${workers} workers): ${fmtDuration(totalWallSecs)}`);
  if (Number.isFinite(totalCost)) {
    console.log(`cost (median):    $${totalCost.toFixed(2)}${cost && Number.isFinite(cost.hourly_usd) ? `   (${cost.hourly_usd} USD/h × ${(totalSerialSecs / 3600).toFixed(2)} h)` : ""}`);
  } else {
    console.log("cost: unknown (set .researchloop/cost.yaml hourly_usd or pass --cost-per-run)");
  }
  if (Number.isFinite(totalCostP95)) {
    console.log(`cost (p95):       $${totalCostP95.toFixed(2)}   (worst-case per-run pace × N)`);
  }
  console.log("---");
  if (!Number.isFinite(secsPerRun)) {
    console.log("Heads up: no per-run time reference found. Record at least one baseline run, or pass --seconds-per-run explicitly.");
  }
  if (Number.isFinite(totalCost) && totalCost > 100) {
    console.log("Heads up: projected cost > $100. Consider `autoresearch budget --check` first.");
  }
  if (Number.isFinite(totalWallSecs) && totalWallSecs > 86400) {
    console.log("Heads up: projected wall time > 1 day. Either bump --workers or prune the grid.");
  }
}
