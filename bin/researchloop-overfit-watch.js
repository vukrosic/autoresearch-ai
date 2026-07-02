// `autoresearch overfit-watch` — find the train/val divergence point.
//
// Classic overfitting: train_loss keeps falling while val_loss bottoms out and
// then starts climbing. The optimal early-stop point is the val minimum;
// every step beyond is paying compute to memorize the training set. This
// command reads a run's streamed metrics and reports:
//
//   - val minimum step + value (the early-stop point)
//   - train value at that step (the "honest" generalization)
//   - divergence point: first step after the val min where val − train
//     opens by more than --gap-threshold (default 5% of the val min)
//   - wasted compute estimate: steps after the val min as a fraction of total
//
// Input formats:
//   <run-id> positional or --id   — reads .researchloop/scratchpad/runs/<id>/metrics.jsonl
//   --train-metric NAME           — name of the train-loss metric (default train_loss)
//   --val-metric NAME             — name of the val-loss metric (default val_loss)
//
// We accept the dual-metric format: rows with `metric` field set to either
// metric name. If your run streams a single metric, point --train-metric and
// --val-metric at it (the warning will fire). Direction is inferred from the
// goal file or set via --direction.

import fs from "node:fs";
import path from "node:path";
import { arrMean } from "./researchloop-core.js";

function readGoalDirection(cwd) {
  const p = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^\s*[-*]?\s*direction:\s*([^\n]+)/im);
  if (!m) return null;
  return m[1].trim().toLowerCase().startsWith("high") ? "higher" : "lower";
}

function readMetrics(cwd, runId) {
  const p = path.join(cwd, ".researchloop", "scratchpad", "runs", String(runId), "metrics.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function byMetric(rows, metricName) {
  return rows
    .filter((r) => r.metric === metricName)
    .map((r) => ({ step: Number(r.step), value: Number(r.value) }))
    .filter((p) => Number.isFinite(p.step) && Number.isFinite(p.value))
    .sort((a, b) => a.step - b.step);
}

function bestIdx(series, isLower) {
  let bi = 0;
  for (let i = 1; i < series.length; i++) {
    if (isLower ? series[i].value < series[bi].value : series[i].value > series[bi].value) bi = i;
  }
  return bi;
}

function interpAt(series, step) {
  // Nearest sample to `step` (no actual interpolation — keep it simple).
  if (series.length === 0) return null;
  let nearest = series[0];
  let bestD = Math.abs(series[0].step - step);
  for (const p of series) {
    const d = Math.abs(p.step - step);
    if (d < bestD) { bestD = d; nearest = p; }
  }
  return nearest;
}

// Pure analyzer — no stdout, no exit codes. Returns a result object (or
// `{error}` if a precondition fails). Used by `cmdOverfitWatch` (CLI), by
// `executeRun` post-completion (to attach an `overfit` block to the row),
// by `cmdReview` (as a gate), and by `cmdReport` (as a section).
export function analyzeOverfit(cwd, runId, opts = {}) {
  if (!runId) return { error: "missing run id" };
  const isLower = opts.direction
    ? !String(opts.direction).toLowerCase().startsWith("high")
    : !String(readGoalDirection(cwd) || "lower").toLowerCase().startsWith("high");
  const trainMetric = opts.trainMetric || "train_loss";
  const valMetric = opts.valMetric || "val_loss";
  const gapThreshold = Number.isFinite(Number(opts.gapThreshold)) ? Number(opts.gapThreshold) : 0.05;

  const rows = readMetrics(cwd, runId);
  if (rows.length === 0) return { error: "no metrics.jsonl" };
  const train = byMetric(rows, trainMetric);
  const val = byMetric(rows, valMetric);
  if (val.length < 3 || train.length < 3) {
    return { error: `not enough samples (train=${train.length}, val=${val.length}; need ≥3 of both)` };
  }
  const valBestIdx = bestIdx(val, isLower);
  const valBestPoint = val[valBestIdx];
  const trainAtValBest = interpAt(train, valBestPoint.step);
  const finalVal = val[val.length - 1];
  const finalTrain = train[train.length - 1];

  const ref = Math.max(1e-9, Math.abs(valBestPoint.value));
  let divergeStep = null;
  let divergeGap = null;
  for (let i = valBestIdx + 1; i < val.length; i++) {
    const vp = val[i];
    const tp = interpAt(train, vp.step);
    if (!tp) continue;
    const gap = isLower ? vp.value - tp.value : tp.value - vp.value;
    if (gap / ref > gapThreshold) { divergeStep = vp.step; divergeGap = gap; break; }
  }
  const totalSteps = finalVal.step - val[0].step;
  const wastedSteps = totalSteps > 0 ? Math.max(0, finalVal.step - valBestPoint.step) : 0;
  const wastedFrac = totalSteps > 0 ? wastedSteps / totalSteps : 0;
  const earlyStopGap = trainAtValBest
    ? (isLower ? valBestPoint.value - trainAtValBest.value : trainAtValBest.value - valBestPoint.value)
    : null;
  const finalGap = trainAtValBest
    ? (isLower ? finalVal.value - finalTrain.value : finalTrain.value - finalVal.value)
    : null;
  const lastTen = val.slice(-10).map((p) => p.value);
  const stillDescending = lastTen.length >= 5 && (isLower
    ? arrMean(lastTen.slice(-5)) < arrMean(lastTen.slice(0, 5))
    : arrMean(lastTen.slice(-5)) > arrMean(lastTen.slice(0, 5)));

  return {
    run_id: runId,
    direction: isLower ? "lower" : "higher",
    train_samples: train.length, val_samples: val.length,
    val_best_step: valBestPoint.step, val_best_value: valBestPoint.value,
    train_at_val_best: trainAtValBest ? trainAtValBest.value : null,
    final_val_step: finalVal.step, final_val_value: finalVal.value,
    final_train_value: finalTrain.value,
    early_stop_gap: earlyStopGap, final_gap: finalGap,
    diverge_step: divergeStep, diverge_gap: divergeGap,
    wasted_steps: wastedSteps, wasted_fraction: wastedFrac,
    still_descending: stillDescending,
    overfit: divergeStep !== null,
  };
}

export async function cmdOverfitWatch(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const positional = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "--id" && args[i - 1] !== "--train-metric" && args[i - 1] !== "--val-metric" && args[i - 1] !== "--direction" && args[i - 1] !== "--gap-threshold" && args[i - 1] !== "--format" && args[i - 1] !== "--dir");
  const runId = option("--id", positional || null);
  const trainMetric = String(option("--train-metric", "train_loss"));
  const valMetric = String(option("--val-metric", "val_loss"));
  const isLower = !String(option("--direction", readGoalDirection(cwd) || "lower")).toLowerCase().startsWith("high");
  const gapThreshold = parseFloat(String(option("--gap-threshold", "0.05"))) || 0.05;

  if (!runId) {
    console.error("Usage: autoresearch overfit-watch <run-id> [--train-metric train_loss] [--val-metric val_loss] [--direction lower|higher]");
    process.exitCode = 1;
    return;
  }

  const rows = readMetrics(cwd, runId);
  if (rows.length === 0) {
    console.error(`No metrics.jsonl for run ${runId}.`);
    process.exitCode = 1;
    return;
  }

  const train = byMetric(rows, trainMetric);
  const val = byMetric(rows, valMetric);

  if (val.length < 3 || train.length < 3) {
    console.error(`Need at least 3 samples for both metrics. train=${train.length}, val=${val.length}.`);
    console.error(`Looked for metric names "${trainMetric}" and "${valMetric}". Override with --train-metric / --val-metric.`);
    process.exitCode = 1;
    return;
  }

  const valBest = bestIdx(val, isLower);
  const valBestPoint = val[valBest];
  const trainAtValBest = interpAt(train, valBestPoint.step);
  const finalVal = val[val.length - 1];
  const finalTrain = train[train.length - 1];

  // Divergence: walking forward from val_best, find first step where the
  // val-train gap exceeds gap_threshold * |val_best|. "Gap" is signed in the
  // direction of overfitting (val gets worse than train).
  const ref = Math.max(1e-9, Math.abs(valBestPoint.value));
  let divergeStep = null;
  let divergeGap = null;
  for (let i = valBest + 1; i < val.length; i++) {
    const vp = val[i];
    const tp = interpAt(train, vp.step);
    if (!tp) continue;
    const gap = isLower ? vp.value - tp.value : tp.value - vp.value;
    if (gap / ref > gapThreshold) {
      divergeStep = vp.step;
      divergeGap = gap;
      break;
    }
  }

  // Total wasted compute = steps after val_best as fraction of total.
  const totalSteps = finalVal.step - val[0].step;
  const wastedSteps = totalSteps > 0 ? Math.max(0, finalVal.step - valBestPoint.step) : 0;
  const wastedFrac = totalSteps > 0 ? wastedSteps / totalSteps : 0;

  // Final overfit gap.
  const finalGap = trainAtValBest
    ? (isLower ? finalVal.value - finalTrain.value : finalTrain.value - finalVal.value)
    : null;
  const earlyStopGap = trainAtValBest
    ? (isLower ? valBestPoint.value - trainAtValBest.value : trainAtValBest.value - valBestPoint.value)
    : null;

  const lastTen = val.slice(-10).map((p) => p.value);
  const stillDescending = lastTen.length >= 5 && (isLower ? arrMean(lastTen.slice(-5)) < arrMean(lastTen.slice(0, 5)) : arrMean(lastTen.slice(-5)) > arrMean(lastTen.slice(0, 5)));

  if (formatJson) {
    console.log(JSON.stringify({
      run_id: runId, direction: isLower ? "lower" : "higher",
      train_samples: train.length, val_samples: val.length,
      val_best: valBestPoint,
      train_at_val_best: trainAtValBest,
      final_train: finalTrain, final_val: finalVal,
      diverge_step: divergeStep, diverge_gap: divergeGap,
      early_stop_gap: earlyStopGap, final_gap: finalGap,
      wasted_steps: wastedSteps, wasted_fraction: wastedFrac,
      still_descending: stillDescending,
    }, null, 2));
    return;
  }

  console.log("autoresearch overfit-watch");
  console.log(`run: ${runId}   train: "${trainMetric}" (${train.length} pts)   val: "${valMetric}" (${val.length} pts)`);
  console.log("---");
  console.log(`val best:         step ${valBestPoint.step}   ${valMetric}=${valBestPoint.value.toFixed(6)}`);
  console.log(`train at that:    ${trainAtValBest ? `step ${trainAtValBest.step}   ${trainMetric}=${trainAtValBest.value.toFixed(6)}` : "n/a"}`);
  console.log(`early-stop gap:   ${earlyStopGap === null ? "—" : earlyStopGap.toFixed(6)}    (val − train at val best, signed in overfit direction)`);
  console.log("---");
  console.log(`final val:        step ${finalVal.step}   ${valMetric}=${finalVal.value.toFixed(6)}`);
  console.log(`final train:      step ${finalTrain.step}   ${trainMetric}=${finalTrain.value.toFixed(6)}`);
  console.log(`final overfit gap:${finalGap === null ? "—" : finalGap.toFixed(6)}`);
  console.log("---");
  if (divergeStep !== null) {
    console.log(`divergence detected at step ${divergeStep}   gap=${divergeGap.toFixed(6)} ( > ${(gapThreshold * 100).toFixed(1)}% of |val_best|)`);
  } else {
    console.log("no clear train/val divergence — model may still be in the well-behaved phase");
  }
  if (wastedFrac > 0.05) {
    console.log(`wasted compute after val min: ${wastedSteps} steps (${(wastedFrac * 100).toFixed(1)}% of total) — early-stop at step ${valBestPoint.step} for the same val ${valMetric}`);
  }
  if (stillDescending) {
    console.log("Note: val is still descending in the final window — bigger gains may be available with more training, not less.");
  }
}
