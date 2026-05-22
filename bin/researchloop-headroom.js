// `autoresearch headroom` — gap to perfect / gap to SoTA reality check.
//
// Easy to forget when you're staring at 0.413 vs 0.408 val_loss whether that
// "0.5% improvement" is meaningful in context. This command does the napkin
// math:
//
//   - Theoretical ceiling (default: 0 for loss-like, 1 for accuracy-like).
//   - Optional --sota N for the public state of the art.
//   - % of available headroom closed by your baseline → current best.
//   - Smallest detectable improvement vs your seed variance (links to
//     `autoresearch power` for full sample-size math).
//
// Picks the metric and direction from goal.md when not provided, picks the
// baseline from `tags: [baseline]` ledger row else the row with the worst
// metric, picks current-best from the row with the best metric. Override any
// of these via flags.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, arrStd, fmt } from "./researchloop-core.js";

function readGoalMetric(cwd) {
  const p = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(p)) return { metric: null, direction: null };
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^\s*[-*]?\s*metric:\s*([^\n]+)/im);
  const d = text.match(/^\s*[-*]?\s*direction:\s*([^\n]+)/im);
  return {
    metric: m ? m[1].trim() : null,
    direction: d ? d[1].trim().toLowerCase() : null,
  };
}

function pickBaseline(rows, metric) {
  // Prefer explicit tag.
  const tagged = rows.find((r) => Array.isArray(r.tags) && r.tags.map(String).includes("baseline"));
  if (tagged) return { row: tagged, value: rowMetricValue(tagged, metric), source: "tagged" };
  // Else the parent-of-no-parent (root) ledger row with a finite metric.
  const roots = rows.filter((r) => !r.parent_id && Number.isFinite(rowMetricValue(r, metric)));
  if (roots.length > 0) return { row: roots[0], value: rowMetricValue(roots[0], metric), source: "root" };
  return null;
}

function pickBest(rows, metric, preferHigher) {
  const scored = rows
    .map((r) => ({ row: r, v: rowMetricValue(r, metric) }))
    .filter((e) => Number.isFinite(e.v));
  if (scored.length === 0) return null;
  scored.sort((a, b) => preferHigher ? b.v - a.v : a.v - b.v);
  return { row: scored[0].row, value: scored[0].v };
}

function defaultCeiling(metric, direction) {
  const m = String(metric || "").toLowerCase();
  if (/(loss|error|ppl|perplexity|mse|rmse|mae|cost|latency)/.test(m)) return 0;
  if (/(acc|accuracy|f1|recall|precision|auc|score|exact_match|em|map|ndcg|rouge|bleu|win_rate|pass_rate|success)/.test(m)) return 1;
  return direction === "higher" ? 1 : 0;
}

function seedVariance(rows, metric) {
  // Look for seed-aggregate rows (row.seeds.values) or sibling rows with the
  // same command across multiple seeds.
  for (const r of rows) {
    if (r.seeds && Array.isArray(r.seeds.values) && r.seeds.values.length >= 2) {
      const vals = r.seeds.values.map((v) => Number(v?.metric ?? v?.value ?? v)).filter(Number.isFinite);
      if (vals.length >= 2) return { std: arrStd(vals), n: vals.length, source: `seed-row:${r.id}` };
    }
  }
  // Group by command.
  const groups = new Map();
  for (const r of rows) {
    const v = rowMetricValue(r, metric);
    if (!Number.isFinite(v)) continue;
    const k = String(r.command || "").trim();
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  let best = null;
  for (const [cmd, vals] of groups.entries()) {
    if (vals.length >= 2 && (!best || vals.length > best.n)) {
      best = { std: arrStd(vals), n: vals.length, source: `command-group:${cmd.slice(0, 40)}` };
    }
  }
  return best;
}

export async function cmdHeadroom(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const goal = readGoalMetric(cwd);
  const metric = String(option("--metric", goal.metric || "val_loss")).trim();
  const directionRaw = String(option("--direction", goal.direction || "lower")).toLowerCase();
  const preferHigher = directionRaw.startsWith("high");
  const sotaArg = option("--sota", null);
  const sota = sotaArg !== null ? parseFloat(String(sotaArg)) : null;
  const ceilingArg = option("--ceiling", null);
  const ceiling = ceilingArg !== null ? parseFloat(String(ceilingArg)) : defaultCeiling(metric, preferHigher ? "higher" : "lower");
  const baselineArg = option("--baseline", null);
  const currentArg = option("--current", null);

  const rows = readLedgerRows(cwd);
  if (rows.length === 0 && (baselineArg === null || currentArg === null)) {
    console.error("No runs in ledger. Pass --baseline N and --current N explicitly, or record runs first.");
    process.exitCode = 1;
    return;
  }

  let baseline = baselineArg !== null
    ? { row: null, value: parseFloat(String(baselineArg)), source: "user-arg" }
    : pickBaseline(rows, metric);
  let best = currentArg !== null
    ? { row: null, value: parseFloat(String(currentArg)) }
    : pickBest(rows, metric, preferHigher);

  if (!baseline || !Number.isFinite(baseline.value)) {
    console.error("Could not determine a baseline value for the metric. Tag a row with `tags: [baseline]`, run `autoresearch baseline`, or pass --baseline N.");
    process.exitCode = 1;
    return;
  }
  if (!best || !Number.isFinite(best.value)) {
    console.error(`No run has a finite "${metric}" yet. Pass --current N to project from a hypothetical value.`);
    process.exitCode = 1;
    return;
  }

  const baselineGap = preferHigher ? ceiling - baseline.value : baseline.value - ceiling;
  const currentGap = preferHigher ? ceiling - best.value : best.value - ceiling;
  const closedByYou = baselineGap > 0 ? (baselineGap - currentGap) / baselineGap : null;

  const sotaBlock = Number.isFinite(sota) ? (() => {
    const sotaGap = preferHigher ? ceiling - sota : sota - ceiling;
    const baselineToSota = preferHigher ? sota - baseline.value : baseline.value - sota;
    const youToSota = preferHigher ? sota - best.value : best.value - sota;
    return {
      sota,
      sota_gap_to_ceiling: sotaGap,
      baseline_to_sota: baselineToSota,
      you_to_sota: youToSota,
      closed_pct: baselineToSota > 0 ? (baselineToSota - youToSota) / baselineToSota : null,
      youre_past_sota: preferHigher ? best.value > sota : best.value < sota,
    };
  })() : null;

  const variance = seedVariance(rows, metric);
  const youGain = Math.abs(best.value - baseline.value);
  const noiseBars = variance ? youGain / variance.std : null;

  if (formatJson) {
    console.log(JSON.stringify({
      metric, direction: preferHigher ? "higher" : "lower",
      ceiling, baseline, current: best,
      baseline_gap_to_ceiling: baselineGap,
      current_gap_to_ceiling: currentGap,
      pct_headroom_closed_from_baseline: closedByYou,
      sota: sotaBlock,
      seed_variance: variance,
      improvement_in_seed_sigmas: noiseBars,
    }, null, 2));
    return;
  }

  console.log("autoresearch headroom");
  console.log(`metric: ${metric}   direction: ${preferHigher ? "higher" : "lower"}   ceiling: ${ceiling}`);
  console.log("---");
  console.log(`baseline:     ${fmt(baseline.value, 6)}${baseline.row ? `  [${baseline.row.id}]` : ""} (source: ${baseline.source || "user-arg"})`);
  console.log(`current best: ${fmt(best.value, 6)}${best.row ? `  [${best.row.id}]` : ""}`);
  console.log(`gap to ceiling — baseline: ${fmt(baselineGap, 6)}   current: ${fmt(currentGap, 6)}`);
  if (closedByYou !== null) {
    console.log(`headroom closed from baseline: ${(closedByYou * 100).toFixed(2)}%${closedByYou < 0 ? " (you went BACKWARDS vs baseline!)" : ""}`);
  }
  if (sotaBlock) {
    console.log("---");
    console.log(`SoTA: ${sota}`);
    if (sotaBlock.youre_past_sota) {
      console.log(`🎯 You are AHEAD of SoTA by ${fmt(Math.abs(sotaBlock.you_to_sota), 6)}.`);
    } else {
      console.log(`gap to SoTA — baseline: ${fmt(sotaBlock.baseline_to_sota, 6)}   current: ${fmt(sotaBlock.you_to_sota, 6)}`);
      if (sotaBlock.closed_pct !== null) {
        console.log(`% of baseline→SoTA closed: ${(sotaBlock.closed_pct * 100).toFixed(2)}%`);
      }
    }
  }
  if (variance) {
    console.log("---");
    console.log(`seed-noise σ:           ${fmt(variance.std, 6)}  (n=${variance.n}, ${variance.source})`);
    console.log(`your gain in σ-units:    ${fmt(noiseBars, 3)}`);
    if (noiseBars !== null && noiseBars < 2) {
      console.log("Heads up: your gain is < 2σ of seed noise. Re-run with more seeds before claiming a win — `autoresearch power --detect-delta` will size N for you.");
    }
  } else {
    console.log("---");
    console.log("No seed variance found in ledger. Run with `--seeds N` or repeat the command on multiple seeds to know the noise floor.");
  }
}
