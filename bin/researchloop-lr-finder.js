// `autoresearch lr-finder` — analyze a learning-rate range test.
//
// Leslie Smith's LR range test (2015, "Cyclical Learning Rates"; popularized
// by fast.ai): linearly or exponentially ramp the LR from very small to very
// large across a single short training run; plot loss vs LR; pick the largest
// LR that still produces a steeply-decreasing loss. The "elbow" — the point
// where loss reaches its minimum before diverging — is roughly the maximum
// useful LR; for one-cycle / cosine schedules, set max_lr to elbow / 10.
//
// Input formats accepted (in priority):
//   --file PATH    JSONL of {lr, loss} rows (also accepts step/learning_rate)
//   --id RUN_ID    reads .researchloop/scratchpad/runs/<id>/lrtest.jsonl
//                  else metrics.jsonl with a metric named "lr_test_loss"
//
// Picks:
//   - lr_at_min_loss              — the LR where loss bottoms out
//   - lr_max_useful               — typically the elbow (steepest descent end)
//   - lr_suggested_one_cycle      — elbow / 10 (rule of thumb for one-cycle)
//   - lr_suggested_constant       — elbow / 30 (conservative)
//
// We also detect divergence — if loss > min × 4 anywhere right of the minimum,
// the elbow is the lr just before that explosion.

import fs from "node:fs";
import path from "node:path";

function readJsonl(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readLrTest(cwd, runId) {
  if (!runId) return null;
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", String(runId));
  const explicit = path.join(runDir, "lrtest.jsonl");
  if (fs.existsSync(explicit)) return readJsonl(explicit);
  const m = path.join(runDir, "metrics.jsonl");
  if (fs.existsSync(m)) {
    const rows = readJsonl(m) || [];
    // Look for any row with both `lr` (or `learning_rate`) and `value` (loss).
    return rows.filter((r) => Number.isFinite(Number(r.lr ?? r.learning_rate)) && Number.isFinite(Number(r.value ?? r.loss)));
  }
  return null;
}

function normalize(rows) {
  return rows
    .map((r) => ({
      lr: Number(r.lr ?? r.learning_rate ?? r.lr_val),
      loss: Number(r.loss ?? r.value ?? r.train_loss),
      step: Number(r.step ?? r.iteration ?? NaN),
    }))
    .filter((p) => Number.isFinite(p.lr) && p.lr > 0 && Number.isFinite(p.loss))
    .sort((a, b) => a.lr - b.lr);
}

function smooth(values, alpha = 0.05) {
  // EMA smoothing — matches fast.ai's recommendation for LR-vs-loss plots.
  const out = new Array(values.length);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function findElbow(points, smoothed) {
  // Minimum of smoothed loss.
  let minIdx = 0;
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] < smoothed[minIdx]) minIdx = i;
  }
  const minLoss = smoothed[minIdx];
  const lrAtMin = points[minIdx].lr;

  // Divergence detection: the first index right of minIdx where smoothed loss
  // exceeds min × 4. The "elbow" is the lr just before — that's the largest
  // LR still in the descent region.
  let divergeIdx = -1;
  for (let i = minIdx + 1; i < smoothed.length; i++) {
    if (smoothed[i] > minLoss * 4 || !Number.isFinite(smoothed[i])) { divergeIdx = i; break; }
  }
  // Steepest-descent point: argmax of negative slope of smoothed loss in log-lr.
  let steepestIdx = 1;
  let steepest = 0;
  for (let i = 1; i < minIdx; i++) {
    const dLr = Math.log(points[i].lr) - Math.log(points[i - 1].lr);
    if (dLr <= 0) continue;
    const dLoss = smoothed[i] - smoothed[i - 1];
    const slope = -dLoss / dLr;
    if (slope > steepest) { steepest = slope; steepestIdx = i; }
  }

  const elbowIdx = divergeIdx > 0 ? Math.max(0, divergeIdx - 1) : minIdx;
  return {
    minIdx, lrAtMin, minLoss,
    divergeIdx,
    steepestIdx, steepestSlope: steepest,
    elbowIdx, lrElbow: points[elbowIdx].lr,
  };
}

export async function cmdLrFinder(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const file = option("--file", null);
  const runId = option("--id", null);
  const alpha = parseFloat(String(option("--smoothing", "0.05"))) || 0.05;

  let rowsRaw;
  let source;
  if (file) {
    rowsRaw = readJsonl(path.resolve(file));
    source = file;
  } else if (runId) {
    rowsRaw = readLrTest(cwd, runId);
    source = `run ${runId}`;
  } else {
    console.error("Usage: autoresearch lr-finder --file lrtest.jsonl   [--smoothing 0.05]");
    console.error("   or: autoresearch lr-finder --id <run-id>");
    console.error("");
    console.error("Each row: {\"lr\": 1e-5, \"loss\": 2.7}");
    process.exitCode = 1;
    return;
  }

  if (!rowsRaw || rowsRaw.length < 10) {
    console.error(`Not enough points for an LR range test (need ≥10, found ${rowsRaw ? rowsRaw.length : 0}).`);
    process.exitCode = 1;
    return;
  }
  const points = normalize(rowsRaw);
  if (points.length < 10) {
    console.error(`After filtering for valid {lr, loss}, only ${points.length} points remain. Need ≥10.`);
    process.exitCode = 1;
    return;
  }

  const smoothed = smooth(points.map((p) => p.loss), alpha);
  const ana = findElbow(points, smoothed);
  const suggestedOneCycle = ana.lrElbow / 10;
  const suggestedConstant = ana.lrElbow / 30;

  if (formatJson) {
    console.log(JSON.stringify({
      source, n: points.length, smoothing_alpha: alpha,
      lr_at_min_loss: ana.lrAtMin,
      min_smoothed_loss: ana.minLoss,
      lr_elbow: ana.lrElbow,
      diverges_at_idx: ana.divergeIdx >= 0 ? ana.divergeIdx : null,
      diverges_at_lr: ana.divergeIdx >= 0 ? points[ana.divergeIdx].lr : null,
      steepest_slope: ana.steepestSlope,
      suggested_one_cycle_max_lr: suggestedOneCycle,
      suggested_constant_lr: suggestedConstant,
    }, null, 2));
    return;
  }

  console.log("autoresearch lr-finder");
  console.log(`source: ${source}   points: ${points.length}   EMA smoothing: ${alpha}`);
  console.log("---");
  console.log(`lr range:           ${points[0].lr.toExponential(2)} → ${points[points.length - 1].lr.toExponential(2)}`);
  console.log(`min smoothed loss:  ${ana.minLoss.toFixed(6)} @ lr=${ana.lrAtMin.toExponential(3)}`);
  if (ana.divergeIdx >= 0) {
    console.log(`divergence (loss > 4× min): starts at lr=${points[ana.divergeIdx].lr.toExponential(3)}`);
  } else {
    console.log("no divergence detected — range may have ended too early");
  }
  console.log(`elbow (last usable lr): ${ana.lrElbow.toExponential(3)}`);
  console.log("---");
  console.log(`suggested max_lr (one-cycle / cosine):   ${suggestedOneCycle.toExponential(3)}    (elbow / 10)`);
  console.log(`suggested constant lr (conservative):    ${suggestedConstant.toExponential(3)}    (elbow / 30)`);
  console.log("---");
  console.log("ASCII curve (log lr → smoothed loss):");
  const W = 60, H = 12;
  const minLoss = Math.min(...smoothed);
  const maxLoss = Math.max(...smoothed.filter(Number.isFinite));
  const grid = Array.from({ length: H }, () => new Array(W).fill(" "));
  for (let i = 0; i < points.length; i++) {
    const x = Math.floor((i / (points.length - 1)) * (W - 1));
    const y = Math.floor((H - 1) - ((smoothed[i] - minLoss) / (maxLoss - minLoss || 1)) * (H - 1));
    if (y >= 0 && y < H) grid[y][x] = "*";
  }
  // Mark elbow + min.
  const xElbow = Math.floor((ana.elbowIdx / (points.length - 1)) * (W - 1));
  const xMin = Math.floor((ana.minIdx / (points.length - 1)) * (W - 1));
  for (let y = 0; y < H; y++) {
    if (grid[y][xElbow] === " ") grid[y][xElbow] = "|";
    if (grid[y][xMin] === " ") grid[y][xMin] = ":";
  }
  for (const r of grid) console.log("  " + r.join(""));
  console.log(`   ${" ".repeat(0)}^ : = min loss   | = elbow`);
  if (ana.steepestSlope < 0.1) {
    console.log("Heads up: steepest slope is shallow — the range may have been too narrow or the model is already well-fit. Re-run with a wider --lr-min/--lr-max in your training script.");
  }
}
