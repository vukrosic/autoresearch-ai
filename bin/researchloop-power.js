// `autoresearch power` — sample-size / statistical-power calculator for the
// two-sample t-test that `autoresearch significance` uses downstream.
//
// Three modes (pick one, the others are derived):
//   --detect-delta D         -> required n per group at the given alpha/power
//   --n N                    -> minimum detectable delta at the given alpha/power
//   --detect-delta D --n N   -> achieved power for that design
//
// The math is the standard normal approximation
//   n ≈ 2 * sigma^2 * (z_{1-alpha/2} + z_{power})^2 / delta^2
// which is what calculators like G*Power and statsmodels print by default.
// For small n (<10) the normal approximation underestimates n by ~10%; we add a
// note about that rather than swap in a t-distribution (which would need an
// incomplete-beta implementation and a root finder).
//
// Inputs come from the CLI directly. If `--baseline-std` isn't passed, we try
// to recover it from a baseline / aggregate ledger row's `seeds.values` array
// so researchers don't have to retype numbers they already collected.

import fs from "node:fs";
import path from "node:path";

// Inverse standard normal (Beasley–Springer–Moro). Accurate to ~1e-9 for
// p in (0.001, 0.999); good enough for power calculations where alpha and
// 1-beta are usually 0.05/0.10/0.20.
function invNormCdf(p) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q;
  let r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Standard normal CDF via erf — good to ~1e-7.
function normCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function ledgerRows(cwd) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) return [];
  return fs.readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// Pull a baseline noise estimate from the ledger:
//   1. A row tagged `baseline` with a `seeds.values` array (best).
//   2. The most recent row with `seeds.values` (decent proxy).
// Returns { std, source: "id of row", n } or null.
function discoverBaselineStd(cwd, metricName) {
  const rows = ledgerRows(cwd);
  const candidates = rows.filter((r) => r && r.seeds && Array.isArray(r.seeds.values) && r.seeds.values.length >= 2);
  if (candidates.length === 0) return null;
  const baselineFirst = candidates.find((r) => Array.isArray(r.tags) && r.tags.includes("baseline"));
  const chosen = baselineFirst || candidates[candidates.length - 1];
  const vals = chosen.seeds.values.filter((v) => Number.isFinite(Number(v))).map(Number);
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const ss = vals.reduce((a, b) => a + (b - mean) ** 2, 0);
  const std = Math.sqrt(ss / (vals.length - 1));
  return { std, source: chosen.id, n: vals.length, mean };
}

function fmt(n, digits = 4) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "null";
  return Number(n).toFixed(digits);
}

// Compute n per group for a two-sample, two-sided t-test under the normal
// approximation. Returns a ceiling integer >= 2.
function requiredN(sigma, delta, alpha, power) {
  if (sigma <= 0 || delta === 0) return Infinity;
  const zAlpha = invNormCdf(1 - alpha / 2);
  const zBeta = invNormCdf(power);
  const n = 2 * sigma ** 2 * (zAlpha + zBeta) ** 2 / delta ** 2;
  return Math.max(2, Math.ceil(n));
}

// Minimum detectable delta given n per group, alpha, power.
function minDetectableDelta(sigma, n, alpha, power) {
  if (sigma <= 0 || n < 2) return Infinity;
  const zAlpha = invNormCdf(1 - alpha / 2);
  const zBeta = invNormCdf(power);
  return Math.sqrt(2 * sigma ** 2 * (zAlpha + zBeta) ** 2 / n);
}

// Achieved power given delta, n, sigma, alpha.
function achievedPower(sigma, delta, n, alpha) {
  if (sigma <= 0 || delta === 0 || n < 2) return 0;
  const zAlpha = invNormCdf(1 - alpha / 2);
  const ncp = Math.abs(delta) / (sigma * Math.sqrt(2 / n));
  return normCdf(ncp - zAlpha) + normCdf(-ncp - zAlpha);
}

export async function cmdPower(ctx) {
  const { option, targetDir, hasFlag } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const stdRaw = option("--baseline-std", null);
  const explicitStd = stdRaw !== null && stdRaw !== undefined ? parseFloat(String(stdRaw)) : null;
  const deltaRaw = option("--detect-delta", null);
  const detectDelta = deltaRaw !== null && deltaRaw !== undefined ? parseFloat(String(deltaRaw)) : null;
  const nRaw = option("--n", null);
  const nPerGroup = nRaw !== null && nRaw !== undefined ? parseInt(String(nRaw), 10) : null;
  const alpha = Math.max(1e-6, Math.min(0.5, parseFloat(String(option("--alpha", "0.05")))));
  const power = Math.max(0.01, Math.min(0.999, parseFloat(String(option("--power", "0.8")))));
  const metric = String(option("--metric", "val_loss")).trim() || "val_loss";

  // Resolve sigma: explicit beats discovered.
  let sigma = Number.isFinite(explicitStd) ? explicitStd : null;
  let sigmaSource = sigma !== null ? "explicit" : null;
  let discoveredFrom = null;
  if (sigma === null) {
    const discovered = discoverBaselineStd(cwd, metric);
    if (discovered) {
      sigma = discovered.std;
      sigmaSource = "ledger";
      discoveredFrom = discovered;
    }
  }
  if (sigma === null) {
    console.error("Need a baseline std. Pass --baseline-std N or run a baseline with --seeds first so the ledger has noise to estimate from.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(sigma) || sigma <= 0) {
    console.error(`Invalid baseline std: ${sigma}. Must be a positive number.`);
    process.exitCode = 1;
    return;
  }

  let mode;
  const results = { sigma, alpha, power, metric, sigma_source: sigmaSource };
  if (discoveredFrom) results.sigma_discovered_from = discoveredFrom;

  if (Number.isFinite(nPerGroup) && Number.isFinite(detectDelta)) {
    mode = "achieved_power";
    results.n = nPerGroup;
    results.delta = detectDelta;
    results.achieved_power = achievedPower(sigma, detectDelta, nPerGroup, alpha);
    results.adequate = results.achieved_power >= power;
  } else if (Number.isFinite(detectDelta)) {
    mode = "required_n";
    results.delta = detectDelta;
    results.required_n_per_group = requiredN(sigma, detectDelta, alpha, power);
    results.required_n_total = results.required_n_per_group * 2;
  } else if (Number.isFinite(nPerGroup)) {
    mode = "min_detectable_delta";
    results.n = nPerGroup;
    results.min_detectable_delta = minDetectableDelta(sigma, nPerGroup, alpha, power);
  } else {
    console.error("Provide at least one of --detect-delta or --n. With both, achieved power is returned.");
    process.exitCode = 1;
    return;
  }
  results.mode = mode;

  const smallN = (results.n && results.n < 10) || (results.required_n_per_group && results.required_n_per_group < 10);
  if (smallN) {
    results.small_n_note = "Normal approximation used; for n < 10 the true required n is ~10% higher than reported. Round up.";
  }

  if (formatJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`autoresearch power (${mode.replace(/_/g, " ")})`);
  console.log(`metric: ${metric}`);
  console.log(`baseline_std (sigma): ${fmt(sigma)} [source: ${sigmaSource}]`);
  if (discoveredFrom) {
    console.log(`  discovered from: ${discoveredFrom.source} (n=${discoveredFrom.n}, mean=${fmt(discoveredFrom.mean)})`);
  }
  console.log(`alpha: ${alpha}`);
  console.log(`target_power: ${power}`);
  console.log("---");
  if (mode === "required_n") {
    console.log(`detect_delta: ${fmt(results.delta)}`);
    console.log(`required_n_per_group: ${results.required_n_per_group}`);
    console.log(`required_n_total: ${results.required_n_total}`);
    console.log(`suggested command:`);
    console.log(`  autoresearch run --seeds ${results.required_n_per_group} --command "..."  # A side`);
    console.log(`  autoresearch run --seeds ${results.required_n_per_group} --command "..."  # B side`);
  } else if (mode === "min_detectable_delta") {
    console.log(`n_per_group: ${results.n}`);
    console.log(`min_detectable_delta: ${fmt(results.min_detectable_delta)}`);
    console.log(`relative_to_sigma: ${fmt(results.min_detectable_delta / sigma)}σ`);
  } else if (mode === "achieved_power") {
    console.log(`n_per_group: ${results.n}`);
    console.log(`delta: ${fmt(results.delta)}`);
    console.log(`achieved_power: ${fmt(results.achieved_power)}`);
    console.log(`adequate (≥ ${power}): ${results.adequate ? "yes" : "no"}`);
    if (!results.adequate) {
      const rec = requiredN(sigma, results.delta, alpha, power);
      console.log(`recommendation: increase n to ${rec} per group to reach power=${power}`);
    }
  }
  if (smallN) {
    console.log("---");
    console.log(results.small_n_note);
  }
}
