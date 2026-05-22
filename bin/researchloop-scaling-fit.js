// `autoresearch scaling-fit` — fit a power law to local ledger runs.
//
// Scaling laws (Kaplan 2020, Hoffmann/Chinchilla 2022) say loss decreases as a
// power law of compute, parameters, or tokens:
//
//   L(N) ≈ a + b · N^(-α)        (with offset)        — Hoffmann form
//   log(L) ≈ log(c) − α · log(N) (no offset)          — simple power-law
//
// Most local sweeps don't have enough data points to fit the offset cleanly,
// so by default we fit the simpler log-log form. Provide `--with-offset` to
// fit the Hoffmann form via grid search on `a` and least-squares on (log b, α)
// at each `a`.
//
// Useful for answering:
//   "If I 10x my compute budget, how much loss should I expect?"
//   "Are my runs on a scaling line, or have I plateaued?"
//
// Input independent variable comes from one of (in priority): row.compute,
// row.flops, row.params, row.tokens, row.wall_seconds. Override via `--x KEY`.

import { readLedgerRows, rowMetricValue } from "./researchloop-core.js";

function parseSize(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase().replace(/_/g, "");
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const m = text.match(/^([\d.]+(?:e[+-]?\d+)?)([kmbt])?$/);
  if (m) return parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1);
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function fmtBig(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e21) return (n / 1e21).toExponential(2);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

function rowX(row, key) {
  if (!row) return null;
  const tryKeys = key ? [key] : ["compute", "flops", "params", "tokens", "wall_seconds"];
  for (const k of tryKeys) {
    const v = row[k] ?? (row.config && row.config[k]) ?? (row.params && row.params[k]);
    if (Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function leastSquares(xs, ys) {
  // y = m*x + b
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const m = den === 0 ? 0 : num / den;
  const b = my - m * mx;
  // R²
  const yhat = xs.map((x) => m * x + b);
  const ssRes = ys.reduce((acc, y, i) => acc + (y - yhat[i]) ** 2, 0);
  const ssTot = ys.reduce((acc, y) => acc + (y - my) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { m, b, r2 };
}

function fitWithOffset(xs, ys) {
  // Hoffmann form: y ≈ a + b * x^(-α). Treat as y = a + g(x; α, b).
  // Grid search `a` in [0, min(y)] (loss offset must be non-negative and below
  // any observed loss), and at each `a` linearize: log(y - a) = log b − α log x.
  const minY = Math.min(...ys);
  let best = { a: 0, alpha: 0, b: 0, r2: -Infinity };
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const a = (minY * 0.99) * (i / steps);
    const adj = ys.map((y) => y - a);
    if (adj.some((v) => v <= 0)) continue;
    const logY = adj.map(Math.log);
    const logX = xs.map(Math.log);
    const { m, b, r2 } = leastSquares(logX, logY);
    const alpha = -m;
    const bConst = Math.exp(b);
    if (r2 > best.r2) best = { a, alpha, b: bConst, r2 };
  }
  return best;
}

export async function cmdScalingFit(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const xKey = option("--x", null);
  const metric = String(option("--metric", "val_loss")).trim();
  const withOffset = String(option("--with-offset", "false")).toLowerCase() === "true" || ctx.hasFlag("--with-offset");
  const target = parseSize(option("--target", null));

  const rows = readLedgerRows(cwd);
  const points = rows
    .map((r) => ({ id: r.id, x: rowX(r, xKey), y: rowMetricValue(r, metric) }))
    .filter((p) => Number.isFinite(p.x) && p.x > 0 && Number.isFinite(p.y) && p.y > 0);

  if (points.length < 3) {
    console.error(`Need at least 3 runs with positive (x, ${metric}). Found ${points.length}.`);
    console.error("x is auto-discovered from row.compute / row.flops / row.params / row.tokens / row.wall_seconds.");
    console.error("Override with --x <key>, or run more sweeps first.");
    process.exitCode = 1;
    return;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const logXs = xs.map(Math.log);
  const logYs = ys.map(Math.log);

  // Simple power law on log-log axes.
  const simple = leastSquares(logXs, logYs);
  const alphaSimple = -simple.m;
  const cSimple = Math.exp(simple.b);
  const predictSimple = (x) => cSimple * Math.pow(x, -alphaSimple);

  let offset = null;
  if (withOffset) {
    offset = fitWithOffset(xs, ys);
  }
  const predictOffset = (x) => offset ? offset.a + offset.b * Math.pow(x, -offset.alpha) : null;

  const result = {
    metric, x_key: xKey || "auto",
    n_points: points.length,
    simple: { c: cSimple, alpha: alphaSimple, r2: simple.r2 },
    hoffmann: offset,
    target: target ? {
      x: target,
      predicted_simple: predictSimple(target),
      predicted_hoffmann: offset ? predictOffset(target) : null,
    } : null,
    points: points.slice().sort((a, b) => a.x - b.x),
  };

  if (formatJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("autoresearch scaling-fit");
  console.log(`metric: ${metric}   x-axis: ${xKey || "auto-detected from row"}   n=${points.length}`);
  console.log("---");
  console.log("Simple power law:  y ≈ c · x^(-α)");
  console.log(`  α (exponent):   ${alphaSimple.toFixed(4)}`);
  console.log(`  c (prefactor):  ${cSimple.toExponential(3)}`);
  console.log(`  R²:             ${simple.r2.toFixed(4)}`);
  if (offset) {
    console.log("");
    console.log("Hoffmann form: y ≈ a + b · x^(-α)");
    console.log(`  a (irreducible loss): ${offset.a.toFixed(4)}`);
    console.log(`  α (exponent):         ${offset.alpha.toFixed(4)}`);
    console.log(`  b (prefactor):        ${offset.b.toExponential(3)}`);
    console.log(`  R²:                   ${offset.r2.toFixed(4)}`);
  }
  console.log("---");
  if (target) {
    console.log(`Extrapolation at x=${fmtBig(target)}:`);
    console.log(`  simple:  ${predictSimple(target).toFixed(6)}`);
    if (offset) console.log(`  hoffmann:${predictOffset(target).toFixed(6)}`);
    const currentBest = Math.min(...ys);
    const currentBestX = xs[ys.indexOf(currentBest)];
    if (target > currentBestX) {
      const reduction = (currentBest - predictSimple(target)) / currentBest;
      console.log(`  vs current best (${currentBest.toFixed(6)} @ x=${fmtBig(currentBestX)}): ${reduction > 0 ? "−" : "+"}${(Math.abs(reduction) * 100).toFixed(2)}%`);
    }
  } else {
    console.log("Tip: pass --target <x> (e.g. compute 1e22, params 70B) to predict loss at a scaled-up budget.");
  }
  console.log("---");
  console.log("Observed points (sorted by x):");
  console.log("| id                | x              | y              | predicted (simple) |");
  console.log("| ---               | ---            | ---            | ---                |");
  for (const p of points.slice().sort((a, b) => a.x - b.x)) {
    const pred = predictSimple(p.x);
    const idStr = String(p.id).slice(0, 17);
    console.log(`| ${idStr.padEnd(17)} | ${fmtBig(p.x).padStart(14)} | ${p.y.toFixed(6).padStart(14)} | ${pred.toFixed(6).padStart(18)} |`);
  }
  console.log("---");
  if (simple.r2 < 0.7) {
    console.log("Warning: R² < 0.70. The points don't fit a clean power law — possible reasons:");
    console.log("  - Mixed model architectures or training recipes in the same fit");
    console.log("  - Plateau from undertrained runs (try filtering to converged rows only)");
    console.log("  - Wrong x-axis (try --x params or --x tokens explicitly)");
  }
  if (alphaSimple < 0 || alphaSimple > 0.5) {
    console.log(`Note: α=${alphaSimple.toFixed(3)} is outside the typical 0.05–0.35 range for transformer LM loss. Check the metric direction.`);
  }
}
