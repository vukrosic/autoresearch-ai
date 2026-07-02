// `autoresearch sample-efficiency` — when does a run reach X% of its final?
//
// "Time to convergence" is the metric researchers actually optimize when they
// pick learning rates, schedulers, and data mixes. A run that hits 90% of its
// final loss in 20% of its steps is dramatically more useful than one that
// only crosses the threshold at the end — even if their final numbers match.
//
// This command reads the streamed `metrics.jsonl` (G06) for one run and
// reports:
//   - first step to reach 50%, 90%, 99% of the (start → final) improvement
//   - plateau onset: first step where the last 10% of training didn't move
//     the metric by more than --plateau-threshold (default 0.5%)
//   - sample efficiency vs baseline: if --vs <run-id> is provided, compare
//     "steps to N% of baseline_final" between this run and baseline
//
// Direction is inferred from the goal file (lower for loss-like) or set via
// --direction lower|higher. "Reach X%" of the improvement is interpreted in
// the same direction.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById } from "./researchloop-core.js";

function readGoalDirection(cwd) {
  const p = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^\s*[-*]?\s*direction:\s*([^\n]+)/im);
  if (!m) return null;
  return m[1].trim().toLowerCase().startsWith("high") ? "higher" : "lower";
}

function readMetricsJsonl(cwd, runId, metricFilter) {
  const p = path.join(cwd, ".researchloop", "scratchpad", "runs", String(runId), "metrics.jsonl");
  if (!fs.existsSync(p)) return [];
  const rows = fs.readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  let series = rows;
  if (metricFilter) series = series.filter((r) => !r.metric || r.metric === metricFilter);
  return series
    .map((r) => ({ step: Number(r.step), value: Number(r.value) }))
    .filter((p) => Number.isFinite(p.step) && Number.isFinite(p.value))
    .sort((a, b) => a.step - b.step);
}

function firstReached(series, threshold, isLower) {
  for (const p of series) {
    if (isLower && p.value <= threshold) return p;
    if (!isLower && p.value >= threshold) return p;
  }
  return null;
}

function findPlateau(series, fractionWindow = 0.1, deltaThreshold = 0.005) {
  if (series.length < 10) return null;
  const w = Math.max(2, Math.floor(series.length * fractionWindow));
  for (let i = w; i < series.length; i++) {
    const window = series.slice(i - w, i);
    const vals = window.map((p) => p.value);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const ref = Math.abs(window[0].value) > 1e-9 ? Math.abs(window[0].value) : 1;
    if ((max - min) / ref < deltaThreshold) {
      return { step: series[i - w].step, span: w };
    }
  }
  return null;
}

export async function cmdSampleEfficiency(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Accept positional id or --id.
  const posIds = args.filter((a, i) => !a.startsWith("-") && args[i] !== "sample-efficiency" && args[i - 1] !== "--id" && args[i - 1] !== "--vs" && args[i - 1] !== "--metric" && args[i - 1] !== "--direction" && args[i - 1] !== "--format" && args[i - 1] !== "--dir" && args[i - 1] !== "--plateau-threshold");
  const runId = option("--id", posIds[0] || null);
  const vsId = option("--vs", null);
  const metric = String(option("--metric", "val_loss"));
  const directionRaw = String(option("--direction", readGoalDirection(cwd) || "lower")).toLowerCase();
  const isLower = !directionRaw.startsWith("high");
  const plateauThreshold = parseFloat(String(option("--plateau-threshold", "0.005"))) || 0.005;

  if (!runId) {
    console.error("Usage: autoresearch sample-efficiency <run-id> [--metric NAME] [--direction lower|higher] [--vs <baseline-run-id>] [--plateau-threshold 0.005] [--format text|json]");
    process.exitCode = 1;
    return;
  }

  const series = readMetricsJsonl(cwd, runId, metric);
  if (series.length < 2) {
    console.error(`Not enough metric samples for run "${runId}" (found ${series.length}). Run must have streamed metrics.jsonl.`);
    process.exitCode = 1;
    return;
  }

  const start = series[0];
  const final = series[series.length - 1];
  const totalSteps = final.step - start.step;
  const improvement = isLower ? (start.value - final.value) : (final.value - start.value);

  const milestones = [];
  for (const pct of [50, 75, 90, 95, 99]) {
    const target = isLower
      ? start.value - (improvement * pct / 100)
      : start.value + (improvement * pct / 100);
    const reached = firstReached(series, target, isLower);
    milestones.push({
      pct, target,
      step: reached ? reached.step : null,
      step_fraction: reached ? (reached.step - start.step) / totalSteps : null,
      value_at: reached ? reached.value : null,
    });
  }

  const plateau = findPlateau(series, 0.1, plateauThreshold);

  let comparison = null;
  if (vsId) {
    const baselineSeries = readMetricsJsonl(cwd, vsId, metric);
    if (baselineSeries.length >= 2) {
      const bStart = baselineSeries[0];
      const bFinal = baselineSeries[baselineSeries.length - 1];
      const bImp = isLower ? (bStart.value - bFinal.value) : (bFinal.value - bStart.value);
      const cmpPcts = [50, 90, 99];
      const rows = cmpPcts.map((pct) => {
        const targetVal = isLower
          ? bStart.value - (bImp * pct / 100)
          : bStart.value + (bImp * pct / 100);
        const inA = firstReached(series, targetVal, isLower);
        const inB = firstReached(baselineSeries, targetVal, isLower);
        return {
          pct, target: targetVal,
          baseline_step: inB ? inB.step : null,
          this_step: inA ? inA.step : null,
          speedup: inB && inA ? inB.step / inA.step : null,
        };
      });
      comparison = { baseline_id: vsId, rows };
    } else {
      comparison = { baseline_id: vsId, error: `baseline has <2 samples (${baselineSeries.length})` };
    }
  }

  if (formatJson) {
    console.log(JSON.stringify({
      run_id: runId, metric, direction: isLower ? "lower" : "higher",
      n_samples: series.length,
      start: { step: start.step, value: start.value },
      final: { step: final.step, value: final.value },
      total_improvement: improvement,
      milestones,
      plateau,
      comparison,
    }, null, 2));
    return;
  }

  console.log(`autoresearch sample-efficiency`);
  console.log(`run: ${runId}  metric: ${metric}  direction: ${isLower ? "lower" : "higher"}`);
  console.log(`samples: ${series.length}  start: step ${start.step} (${start.value.toFixed(6)})  final: step ${final.step} (${final.value.toFixed(6)})`);
  console.log(`total improvement: ${improvement.toFixed(6)}${improvement <= 0 ? "  (run did not improve!)" : ""}`);
  console.log("---");
  console.log("Steps to reach % of (start → final) improvement:");
  console.log("| % | target value | step    | fraction of run |");
  console.log("| ---| ---         | ---     | ---             |");
  for (const m of milestones) {
    console.log(`| ${String(m.pct).padStart(3)} | ${m.target.toFixed(6).padStart(11)} | ${m.step === null ? "n/a".padStart(7) : String(m.step).padStart(7)} | ${m.step_fraction === null ? "—".padStart(15) : (100 * m.step_fraction).toFixed(2).padStart(13) + " %"} |`);
  }
  console.log("---");
  if (plateau) {
    console.log(`Plateau detected: starting around step ${plateau.step} (last ${plateau.span} samples moved < ${(100 * plateauThreshold).toFixed(2)}% of |value|).`);
    const wasted = (final.step - plateau.step) / totalSteps;
    console.log(`Potentially wasted compute: ~${(100 * wasted).toFixed(1)}% of total steps after the plateau.`);
  } else {
    console.log("No plateau detected — the run was still moving at the end. Consider longer training.");
  }
  if (comparison) {
    console.log("---");
    if (comparison.error) {
      console.log(`Comparison vs ${vsId}: ${comparison.error}`);
    } else {
      console.log(`Sample efficiency vs ${vsId} (steps to reach % of *baseline's* improvement):`);
      console.log("| % | baseline target | baseline step | this step | speedup |");
      console.log("| ---| ---            | ---           | ---       | ---     |");
      for (const row of comparison.rows) {
        const speedup = row.speedup === null ? "—" : (row.speedup >= 1 ? `${row.speedup.toFixed(2)}× faster` : `${row.speedup.toFixed(2)}× slower`);
        console.log(`| ${String(row.pct).padStart(3)} | ${row.target.toFixed(6).padStart(14)} | ${row.baseline_step === null ? "n/a".padStart(13) : String(row.baseline_step).padStart(13)} | ${row.this_step === null ? "n/a".padStart(9) : String(row.this_step).padStart(9)} | ${speedup} |`);
      }
    }
  }
}
