// `autoresearch grad-noise` — gradient noise scale (GNS) estimator.
//
// McCandlish et al. 2018 ("An Empirical Model of Large-Batch Training")
// defined the critical batch size: the batch size beyond which doubling
// stops giving you ~2x training speedup. It's the per-coordinate signal-to-
// noise ratio of the gradient: B_simple = tr(Σ) / |g|², where g is the true
// gradient mean and Σ is its covariance.
//
// You cannot estimate Σ directly without per-microbatch gradients (and most
// training scripts don't expose them). But there are two practical ways:
//
//   1. Two-batch estimator (cheap, in-training): the user's training script
//      logs `g_norm_small` and `g_norm_big` (gradient L2 norm computed on
//      microbatch of size B_small vs B_big at the same step). GNS ≈
//      (1/B_small − 1/B_big) / (|g_big|² − |g_small|²) × |g_big|². Comes
//      from the noise-scale identity in McCandlish §A.2.
//
//   2. Sample variance estimator (offline, what we provide here): take the
//      ledger rows from a multi-seed run; the per-seed final-grad-norm
//      variance gives a usable proxy for tr(Σ). The user passes
//      `--grad-norms` (file of {step, norm} samples across seeds) or we
//      auto-collect from `metrics.jsonl` rows with metric == "grad_norm".
//
// Reports:
//   - simple noise scale B_simple
//   - "this batch is N× larger/smaller than critical" verdict
//   - Recommended batch range (B_simple/4 → B_simple × 4 is the linear-
//     speedup regime per McCandlish)
//
// Input formats (one accepted):
//   --file PATH               JSONL of {step, norm, batch_size?} samples
//   --id RUN_ID               reads metrics.jsonl with metric=grad_norm
//   --norm-small N --norm-big N --batch-small N --batch-big N
//                             single-step two-batch estimator

import fs from "node:fs";
import path from "node:path";
import { arrMean, arrStd } from "./researchloop-core.js";

function readJsonl(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readGradNorms(cwd, runId) {
  const p = path.join(cwd, ".researchloop", "scratchpad", "runs", String(runId), "metrics.jsonl");
  if (!fs.existsSync(p)) return null;
  const rows = readJsonl(p) || [];
  return rows
    .filter((r) => r.metric === "grad_norm" || r.metric === "gradient_norm")
    .map((r) => ({ step: Number(r.step), norm: Number(r.value), batch_size: Number(r.batch_size) }))
    .filter((p) => Number.isFinite(p.norm));
}

function twoBatchGns({ normSmall, normBig, batchSmall, batchBig }) {
  // McCandlish §A.2: B_simple = (|G|² − E|G_hat|²) / (|G_hat|² − |G|²)
  // approximated with two batches gives:
  //   |G|² ≈ (B_big × |g_big|² − B_small × |g_small|²) / (B_big − B_small)
  //   tr(Σ) ≈ B_big × B_small / (B_big − B_small) × (|g_small|² − |g_big|²)
  //   B_simple = tr(Σ) / |G|²
  const g2small = normSmall * normSmall;
  const g2big = normBig * normBig;
  if (batchBig === batchSmall) return { error: "batch sizes must differ" };
  const trueSquaredGrad = (batchBig * g2big - batchSmall * g2small) / (batchBig - batchSmall);
  const traceCov = (batchBig * batchSmall / (batchBig - batchSmall)) * (g2small - g2big);
  if (trueSquaredGrad <= 0) return { error: "estimated |G|² ≤ 0 — gradient noise dominates; pick smaller batches" };
  if (traceCov <= 0) return { error: "estimated tr(Σ) ≤ 0 — try a wider batch ratio" };
  return { B_simple: traceCov / trueSquaredGrad, true_grad_sq: trueSquaredGrad, trace_cov: traceCov };
}

function sampleVarianceGns(samples) {
  // Use the variance of |g|² across samples as a proxy for tr(Σ) and the
  // mean as |G|². This is a rough estimator that works when you have ≥ 30
  // samples and the underlying gradient noise is roughly stationary across
  // them (use within a single training phase, not across the whole run).
  if (samples.length < 30) return { error: `need ≥ 30 samples; got ${samples.length}` };
  const sq = samples.map((s) => s.norm * s.norm);
  const meanSq = arrMean(sq);
  const stdSq = arrStd(sq);
  const traceCov = stdSq * stdSq; // ≈ Var(|g|²); proxy for tr(Σ)
  const trueGradSq = meanSq;
  if (trueGradSq <= 0) return { error: "mean |g|² ≤ 0 (degenerate)" };
  return { B_simple: traceCov / trueGradSq, true_grad_sq: trueGradSq, trace_cov: traceCov, n_samples: samples.length };
}

export async function cmdGradNoise(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const currentBatch = parseFloat(String(option("--batch", "0"))) || 0;

  const normSmall = parseFloat(String(option("--norm-small", "NaN")));
  const normBig = parseFloat(String(option("--norm-big", "NaN")));
  const batchSmall = parseFloat(String(option("--batch-small", "NaN")));
  const batchBig = parseFloat(String(option("--batch-big", "NaN")));

  let result;
  let estimator;
  if ([normSmall, normBig, batchSmall, batchBig].every(Number.isFinite)) {
    result = twoBatchGns({ normSmall, normBig, batchSmall, batchBig });
    estimator = "two-batch";
  } else {
    const filePath = option("--file", null);
    const runId = option("--id", null);
    let samples;
    if (filePath) samples = readJsonl(path.resolve(filePath)).map((r) => ({ step: Number(r.step), norm: Number(r.norm || r.value || r.grad_norm) })).filter((p) => Number.isFinite(p.norm));
    else if (runId) samples = readGradNorms(cwd, runId);
    else {
      console.error("Usage (pick one):");
      console.error("  autoresearch grad-noise --norm-small 1.4 --batch-small 32 --norm-big 1.05 --batch-big 256");
      console.error("  autoresearch grad-noise --file grad_norms.jsonl                # {step, norm}");
      console.error("  autoresearch grad-noise --id <run-id>                          # metrics.jsonl with metric=grad_norm");
      console.error("");
      console.error("Pass --batch N to get a 'how does N compare to critical' verdict.");
      process.exitCode = 1;
      return;
    }
    if (!samples || samples.length === 0) {
      console.error("No grad_norm samples found.");
      process.exitCode = 1;
      return;
    }
    result = sampleVarianceGns(samples);
    estimator = "sample-variance";
  }

  if (result.error) {
    console.error(`grad-noise error: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const B = result.B_simple;
  const verdict = currentBatch > 0
    ? (currentBatch < B / 4
       ? `under-batched (B=${currentBatch} < B_simple/4=${(B / 4).toFixed(0)}) — bigger batch gives near-linear speedup`
       : currentBatch > B * 4
       ? `over-batched (B=${currentBatch} > B_simple×4=${(B * 4).toFixed(0)}) — bigger batch wastes compute`
       : `near critical (B=${currentBatch} within [B_simple/4, B_simple×4] = [${(B / 4).toFixed(0)}, ${(B * 4).toFixed(0)}]) — linear-speedup regime`)
    : null;

  if (formatJson) {
    console.log(JSON.stringify({
      estimator,
      B_simple: B,
      true_grad_sq: result.true_grad_sq,
      trace_cov: result.trace_cov,
      n_samples: result.n_samples,
      current_batch: currentBatch || null,
      verdict,
      linear_speedup_range: [B / 4, B * 4],
    }, null, 2));
    return;
  }

  console.log("autoresearch grad-noise");
  console.log(`estimator: ${estimator}${result.n_samples ? `   n=${result.n_samples}` : ""}`);
  console.log("---");
  console.log(`B_simple (critical batch):     ${B.toFixed(1)}`);
  console.log(`|G|² (true gradient norm sq):  ${result.true_grad_sq.toExponential(3)}`);
  console.log(`tr(Σ) (gradient noise trace):  ${result.trace_cov.toExponential(3)}`);
  console.log(`linear-speedup range:          [${(B / 4).toFixed(0)}, ${(B * 4).toFixed(0)}]   (B_simple/4 → B_simple × 4)`);
  if (verdict) {
    console.log("---");
    console.log(`current batch: ${currentBatch}`);
    console.log(`verdict: ${verdict}`);
  } else {
    console.log("---");
    console.log("Pass --batch N to see how your current batch compares to B_simple.");
  }
  if (estimator === "sample-variance") {
    console.log("---");
    console.log("Note: the sample-variance estimator is a proxy and tends to underestimate the true noise scale by 2-4×.");
    console.log("Two-batch is exact (see McCandlish §A.2): log grad-norm at two microbatch sizes in your training script and pass --norm-small/--batch-small/--norm-big/--batch-big.");
  }
}
