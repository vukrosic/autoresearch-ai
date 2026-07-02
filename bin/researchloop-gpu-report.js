// `autoresearch gpu-report` — aggregate GPU + system metrics across runs.
//
// Reads each run's `system.jsonl` (sampled every 5s by default per G32) and
// summarizes:
//   - per-run wall time, peak/avg load, peak/avg memory used
//   - across-ledger totals: how many GPU-hours, biggest run, longest run
//
// The system.jsonl entries come from `os.loadavg()` / `os.totalmem()` /
// `os.freemem()` today, so this is "system pressure" rather than GPU
// utilization per se — but the framework is ready to absorb true GPU
// telemetry as soon as a sampler ships.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, arrMean, percentile, fmt } from "./researchloop-core.js";

function systemJsonlPath(cwd, runId) {
  return path.join(cwd, ".researchloop", "scratchpad", "runs", runId, "system.jsonl");
}

function readSystemSamples(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function summarize(samples) {
  if (samples.length === 0) return null;
  const loads = samples.map((s) => Number(s.load1 ?? (Array.isArray(s.loadavg) ? s.loadavg[0] : NaN))).filter(Number.isFinite);
  const memUsedFracs = samples
    .map((s) => {
      const total = Number(s.totalmem ?? s.total_mem ?? s.mem_total);
      const free = Number(s.freemem ?? s.free_mem ?? s.mem_free);
      if (!Number.isFinite(total) || total <= 0) return NaN;
      if (!Number.isFinite(free)) return NaN;
      return (total - free) / total;
    })
    .filter(Number.isFinite);
  return {
    n_samples: samples.length,
    load_mean: loads.length ? arrMean(loads) : null,
    load_p95: loads.length ? percentile(loads, 0.95) : null,
    load_max: loads.length ? Math.max(...loads) : null,
    mem_used_frac_mean: memUsedFracs.length ? arrMean(memUsedFracs) : null,
    mem_used_frac_p95: memUsedFracs.length ? percentile(memUsedFracs, 0.95) : null,
    mem_used_frac_max: memUsedFracs.length ? Math.max(...memUsedFracs) : null,
  };
}

export async function cmdGpuReport(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const top = Math.max(1, parseInt(String(option("--top", "10")), 10) || 10);

  const rows = readLedgerRows(cwd);
  const enriched = rows.map((r) => {
    const samples = readSystemSamples(systemJsonlPath(cwd, r.id));
    const sum = summarize(samples);
    return {
      id: r.id,
      status: r.status,
      wall_seconds: Number.isFinite(Number(r.wall_seconds)) ? Number(r.wall_seconds) : null,
      gpu: r.env && r.env.gpu ? (Array.isArray(r.env.gpu) ? r.env.gpu.join(", ") : r.env.gpu) : null,
      summary: sum,
    };
  });

  const withSummary = enriched.filter((e) => e.summary !== null);
  const totalWall = withSummary.reduce((acc, e) => acc + (e.wall_seconds || 0), 0);
  const longest = withSummary.slice().sort((a, b) => (b.wall_seconds || 0) - (a.wall_seconds || 0))[0] || null;
  const heaviestLoad = withSummary.slice().sort((a, b) => (b.summary.load_max || 0) - (a.summary.load_max || 0))[0] || null;
  const heaviestMem = withSummary.slice().sort((a, b) => (b.summary.mem_used_frac_max || 0) - (a.summary.mem_used_frac_max || 0))[0] || null;

  if (formatJson) {
    console.log(JSON.stringify({
      n_total_runs: rows.length,
      n_with_system_samples: withSummary.length,
      total_wall_seconds: totalWall,
      total_wall_hours: totalWall / 3600,
      longest: longest ? { id: longest.id, wall_seconds: longest.wall_seconds } : null,
      heaviest_load: heaviestLoad ? { id: heaviestLoad.id, load_max: heaviestLoad.summary.load_max } : null,
      heaviest_mem: heaviestMem ? { id: heaviestMem.id, mem_used_frac_max: heaviestMem.summary.mem_used_frac_max } : null,
      runs: withSummary.slice(0, top),
    }, null, 2));
    return;
  }

  console.log("autoresearch gpu-report");
  console.log(`runs in ledger: ${rows.length}  with system.jsonl: ${withSummary.length}`);
  console.log(`total wall time: ${(totalWall / 3600).toFixed(2)}h`);
  if (longest) console.log(`longest run: ${longest.id} (${(longest.wall_seconds / 3600).toFixed(2)}h)`);
  if (heaviestLoad) console.log(`heaviest load: ${heaviestLoad.id} (load_max=${fmt(heaviestLoad.summary.load_max, 2)})`);
  if (heaviestMem) console.log(`heaviest mem:  ${heaviestMem.id} (mem_used_frac_max=${fmt(heaviestMem.summary.mem_used_frac_max, 3)})`);
  console.log("---");
  console.log("| id | gpu | wall | load_mean | load_p95 | mem_frac_p95 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  const sorted = withSummary.slice().sort((a, b) => (b.wall_seconds || 0) - (a.wall_seconds || 0)).slice(0, top);
  for (const r of sorted) {
    const wall = r.wall_seconds === null ? "—" : (r.wall_seconds < 90 ? `${r.wall_seconds.toFixed(0)}s` : `${(r.wall_seconds / 3600).toFixed(2)}h`);
    console.log(`| ${r.id} | ${r.gpu || "—"} | ${wall} | ${fmt(r.summary.load_mean, 2)} | ${fmt(r.summary.load_p95, 2)} | ${fmt(r.summary.mem_used_frac_p95, 3)} |`);
  }
  console.log("---");
  console.log("note: 'load' is os.loadavg()[0]; 'mem_frac' is (totalmem - freemem) / totalmem.");
  console.log("note: true per-GPU utilization will appear here once an nvidia-smi sampler lands.");
}
