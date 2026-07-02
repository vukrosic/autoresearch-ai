// `autoresearch rl-stats` — robust episode-return statistics for RL runs.
//
// RL researchers can't trust point estimates of mean episode return — the
// returns are heavy-tailed, the noise is huge, and individual seeds disagree.
// This command computes the *robust* aggregate statistics that the RL
// community has converged on (see Agarwal et al. 2021, "Deep RL at the Edge
// of the Statistical Precipice", NeurIPS):
//
//   - IQM (interquartile mean): mean over the middle 50% of episode returns.
//     Less seed-noise than mean, less censoring than median.
//   - 95% stratified bootstrap CI on IQM and median.
//   - Optimality Gap: fraction of episodes below `--success-threshold`.
//   - Sample efficiency vs --vs <run-id> (if provided): steps-to-reach
//     baseline's IQM, expressed as a speedup ratio.
//
// Input formats accepted (in priority):
//   1. --file PATH                 — a JSONL of `{step?, episode_return}` rows
//   2. <run-id> positional or --id — reads
//                                    .researchloop/scratchpad/runs/<id>/rewards.jsonl
//                                    falling back to metrics.jsonl with
//                                    `metric == "episode_return"`.
//   3. --vs <run-id>               — optional baseline for side-by-side stats.

import fs from "node:fs";
import path from "node:path";
import { arrMean, arrMedian, percentile, arrStd } from "./researchloop-core.js";

function readReturns(cwd, runId, metricFilter) {
  if (!runId) return null;
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", String(runId));
  // 1. rewards.jsonl is the canonical RL log if the user writes one.
  const rewards = path.join(runDir, "rewards.jsonl");
  if (fs.existsSync(rewards)) {
    return parseReturnsFile(rewards);
  }
  // 2. metrics.jsonl with episode_return metric.
  const metrics = path.join(runDir, "metrics.jsonl");
  if (fs.existsSync(metrics)) {
    const rows = fs.readFileSync(metrics, "utf8")
      .split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    const ep = rows.filter((r) => r.metric === metricFilter || (!r.metric && Number.isFinite(Number(r.value))));
    return ep.map((r) => ({ step: Number(r.step), value: Number(r.value) })).filter((p) => Number.isFinite(p.value));
  }
  return null;
}

function parseReturnsFile(p) {
  const rows = fs.readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return rows
    .map((r) => ({
      step: Number(r.step ?? r.episode ?? r.iter ?? r.t ?? NaN),
      value: Number(r.episode_return ?? r.return ?? r.reward ?? r.value ?? r.score ?? NaN),
      success: typeof r.success === "boolean" ? r.success : null,
    }))
    .filter((p) => Number.isFinite(p.value));
}

function iqm(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q25 = percentile(sorted, 0.25);
  const q75 = percentile(sorted, 0.75);
  const middle = sorted.filter((v) => v >= q25 && v <= q75);
  if (middle.length === 0) return arrMean(sorted);
  return arrMean(middle);
}

// Mulberry32 PRNG — deterministic when seeded.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapCi(values, statFn, n = 1000, alpha = 0.05, seed = 0xC0FFEE) {
  if (values.length < 2) return null;
  const rng = makeRng(seed);
  const stats = [];
  for (let b = 0; b < n; b++) {
    const sample = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
      sample[i] = values[Math.floor(rng() * values.length)];
    }
    stats.push(statFn(sample));
  }
  stats.sort((a, b) => a - b);
  return [percentile(stats, alpha / 2), percentile(stats, 1 - alpha / 2)];
}

function summarize(points, successThreshold, bootstrapN) {
  if (!points || points.length === 0) return null;
  const values = points.map((p) => p.value);
  const successCount = points.filter((p) => p.success === true).length;
  const successFromValue = points.filter((p) => Number.isFinite(successThreshold) && p.value >= successThreshold).length;
  return {
    n: values.length,
    mean: arrMean(values),
    std: arrStd(values),
    median: arrMedian(values),
    iqm: iqm(values),
    iqm_ci_95: bootstrapCi(values, iqm, bootstrapN),
    median_ci_95: bootstrapCi(values, arrMedian, bootstrapN),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    min: Math.min(...values),
    max: Math.max(...values),
    success_rate: Number.isFinite(successThreshold)
      ? successFromValue / values.length
      : (points[0].success !== null ? successCount / values.length : null),
    last_100_iqm: values.length >= 100 ? iqm(values.slice(-100)) : null,
  };
}

function fmtMaybe(n, digits = 4) {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : Number(n).toFixed(digits);
}

export async function cmdRlStats(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const successThreshold = parseFloat(String(option("--success-threshold", "NaN")));
  const bootstrapN = Math.max(100, parseInt(String(option("--bootstrap", "1000")), 10) || 1000);
  const filePath = option("--file", null);
  const positional = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "--file" && args[i - 1] !== "--id" && args[i - 1] !== "--vs" && args[i - 1] !== "--success-threshold" && args[i - 1] !== "--metric" && args[i - 1] !== "--bootstrap" && args[i - 1] !== "--format" && args[i - 1] !== "--dir");
  const runId = option("--id", positional || null);
  const vsId = option("--vs", null);
  const metricName = String(option("--metric", "episode_return"));

  let points;
  let sourceLabel;
  if (filePath) {
    points = parseReturnsFile(path.resolve(filePath));
    sourceLabel = filePath;
  } else if (runId) {
    points = readReturns(cwd, runId, metricName);
    sourceLabel = `run ${runId}`;
  } else {
    console.error("Usage: autoresearch rl-stats <run-id> [--success-threshold N] [--vs BASELINE_ID] [--bootstrap 1000]");
    console.error("   or: autoresearch rl-stats --file rewards.jsonl [--success-threshold N]");
    console.error("");
    console.error("Each row should be JSON like:");
    console.error("  {\"step\": 100, \"episode_return\": 12.4}");
    console.error("  {\"step\": 100, \"reward\": 12.4, \"success\": true}");
    process.exitCode = 1;
    return;
  }

  if (!points || points.length === 0) {
    console.error(`No episode returns found for ${sourceLabel}.`);
    console.error("Looked for: rewards.jsonl, metrics.jsonl with metric=episode_return.");
    process.exitCode = 1;
    return;
  }

  const stats = summarize(points, successThreshold, bootstrapN);
  let vsStats = null;
  let comparison = null;
  if (vsId) {
    const vsPoints = readReturns(cwd, vsId, metricName);
    if (vsPoints && vsPoints.length > 0) {
      vsStats = summarize(vsPoints, successThreshold, bootstrapN);
      // Steps to reach baseline IQM
      if (Number.isFinite(vsStats.iqm)) {
        const target = vsStats.iqm;
        const window = Math.min(50, Math.max(5, Math.floor(points.length * 0.05)));
        let reachedStep = null;
        for (let i = window; i <= points.length; i++) {
          const w = points.slice(i - window, i).map((p) => p.value);
          if (arrMean(w) >= target) { reachedStep = points[i - 1].step; break; }
        }
        comparison = {
          baseline_iqm: target,
          baseline_steps: vsPoints[vsPoints.length - 1].step,
          this_reached_step: reachedStep,
          speedup: reachedStep && vsPoints[vsPoints.length - 1].step ? vsPoints[vsPoints.length - 1].step / reachedStep : null,
        };
      }
    }
  }

  if (formatJson) {
    console.log(JSON.stringify({
      source: sourceLabel,
      success_threshold: Number.isFinite(successThreshold) ? successThreshold : null,
      stats,
      vs: vsId ? { id: vsId, stats: vsStats, comparison } : null,
    }, null, 2));
    return;
  }

  console.log("autoresearch rl-stats");
  console.log(`source: ${sourceLabel}   episodes: ${stats.n}   bootstrap: ${bootstrapN}`);
  if (Number.isFinite(successThreshold)) console.log(`success threshold: episode_return >= ${successThreshold}`);
  console.log("---");
  console.log(`mean:        ${fmtMaybe(stats.mean)} ± ${fmtMaybe(stats.std)}`);
  console.log(`median:      ${fmtMaybe(stats.median)}  CI95 [${fmtMaybe(stats.median_ci_95 ? stats.median_ci_95[0] : null)}, ${fmtMaybe(stats.median_ci_95 ? stats.median_ci_95[1] : null)}]`);
  console.log(`IQM:         ${fmtMaybe(stats.iqm)}     CI95 [${fmtMaybe(stats.iqm_ci_95 ? stats.iqm_ci_95[0] : null)}, ${fmtMaybe(stats.iqm_ci_95 ? stats.iqm_ci_95[1] : null)}]`);
  console.log(`p25 / p75:   ${fmtMaybe(stats.p25)} / ${fmtMaybe(stats.p75)}`);
  console.log(`min / max:   ${fmtMaybe(stats.min)} / ${fmtMaybe(stats.max)}`);
  if (stats.last_100_iqm !== null) console.log(`last-100 IQM:${fmtMaybe(stats.last_100_iqm)}   (most-recent-window check for stability)`);
  if (stats.success_rate !== null) console.log(`success rate:${(100 * stats.success_rate).toFixed(2)}%`);
  if (comparison) {
    console.log("---");
    console.log(`vs ${vsId}:`);
    console.log(`  baseline IQM:        ${fmtMaybe(comparison.baseline_iqm)}`);
    console.log(`  baseline steps used: ${comparison.baseline_steps}`);
    console.log(`  this run reached at: ${comparison.this_reached_step ?? "never within run"}`);
    if (comparison.speedup !== null) {
      console.log(`  sample-efficiency:   ${comparison.speedup.toFixed(2)}× ${comparison.speedup >= 1 ? "faster" : "slower"}`);
    }
  }
  console.log("---");
  if (stats.n < 30) {
    console.log("Heads up: n < 30 episodes — IQM and CIs will be wide. RL noise dominates at low n; collect more episodes before drawing conclusions.");
  }
  if (stats.iqm_ci_95 && (stats.iqm_ci_95[1] - stats.iqm_ci_95[0]) > Math.abs(stats.iqm) * 0.3) {
    console.log("Heads up: IQM CI width is > 30% of |IQM|. Don't compare runs at this CI width — differences will be inside the noise.");
  }
}
