// `autoresearch similar <run-id>` — find nearest-neighbor runs in the ledger.
//
// The agent question this answers: "Have I tried something like this before?"
// Useful before launching a new experiment, and useful when proposing
// hypotheses (G02's novelty score should defer to this when available).
//
// Distance is a weighted sum of:
//   - normalized L2 distance over numeric params (lr, batch_size, dropout, ...)
//   - normalized metric distance (defaults to the same metric the row reports)
//
// Normalization uses the std of each feature across the ledger so big-scale
// features (lr ~ 1e-4) don't drown out small-scale ones (dropout ~ 0.1).
// Runs with no overlapping numeric params get a distance of +Infinity rather
// than a silent zero.

import { readLedgerRows, findRowById, numericParams, arrStd, fmt, rowMetricValue } from "./researchloop-core.js";

function paramVector(row, paramKeys) {
  const p = numericParams(row);
  return paramKeys.map((k) => (k in p ? p[k] : null));
}

// Compute per-feature std across the whole ledger so we can normalize the
// distance computation. Missing values are skipped per-feature, not per-row.
function perFeatureStds(rows, paramKeys) {
  const out = {};
  for (const k of paramKeys) {
    const vals = rows.map((r) => numericParams(r)[k]).filter((v) => Number.isFinite(v));
    const std = arrStd(vals);
    out[k] = std > 0 ? std : 1; // avoid divide-by-zero on constant features
  }
  return out;
}

// Distance between two rows. Returns { distance, overlap, components }.
// `overlap` is the count of features both rows have; if 0, distance = Infinity.
function weightedDistance(rowA, rowB, paramKeys, paramStds, metric, metricStd, paramWeight) {
  const pA = paramVector(rowA, paramKeys);
  const pB = paramVector(rowB, paramKeys);
  let paramSq = 0;
  let overlap = 0;
  for (let i = 0; i < paramKeys.length; i += 1) {
    if (pA[i] === null || pB[i] === null) continue;
    overlap += 1;
    const std = paramStds[paramKeys[i]] || 1;
    paramSq += ((pA[i] - pB[i]) / std) ** 2;
  }
  if (overlap === 0) return { distance: Infinity, overlap: 0, paramDistance: Infinity, metricDistance: Infinity };
  const paramDist = Math.sqrt(paramSq / overlap);

  const mA = rowMetricValue(rowA, metric);
  const mB = rowMetricValue(rowB, metric);
  let metricDist = 0;
  if (Number.isFinite(mA) && Number.isFinite(mB) && metricStd > 0) {
    metricDist = Math.abs(mA - mB) / metricStd;
  }

  const distance = paramWeight * paramDist + (1 - paramWeight) * metricDist;
  return { distance, overlap, paramDistance: paramDist, metricDistance: metricDist };
}

function describeDelta(a, b, paramKeys) {
  const pA = numericParams(a);
  const pB = numericParams(b);
  const diffs = [];
  for (const k of paramKeys) {
    const va = pA[k];
    const vb = pB[k];
    if (va === undefined && vb === undefined) continue;
    if (va === vb) continue;
    diffs.push(`${k}: ${va ?? "—"} → ${vb ?? "—"}`);
  }
  return diffs;
}

export async function cmdSimilar(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Accept positional <run-id> after `similar`, or --id.
  const simIdx = args.findIndex((a) => a === "similar");
  let runId = String(option("--id", "")).trim();
  if (!runId && simIdx !== -1 && args[simIdx + 1] && !args[simIdx + 1].startsWith("-")) {
    runId = String(args[simIdx + 1]).trim();
  }
  const k = Math.max(1, parseInt(String(option("--k", "5")), 10) || 5);
  const paramWeight = Math.max(0, Math.min(1, parseFloat(String(option("--param-weight", "0.7")))));
  const metricArg = option("--metric", null);

  if (!runId) {
    console.error("Usage: autoresearch similar <run-id> [--k N] [--metric NAME] [--param-weight 0..1] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  if (rows.length === 0) {
    console.error("Ledger is empty. Run something first.");
    process.exitCode = 1;
    return;
  }
  const subject = findRowById(rows, runId);
  if (!subject) {
    console.error(`Run not found: ${runId}`);
    process.exitCode = 1;
    return;
  }

  // Determine metric: explicit, else first finite metric of subject, else val_loss.
  let metric = metricArg && typeof metricArg === "string" ? metricArg : null;
  if (!metric) {
    const keys = subject.metrics ? Object.keys(subject.metrics).filter((k2) => !k2.endsWith("_std")) : [];
    metric = keys.find((k2) => Number.isFinite(rowMetricValue(subject, k2))) || "val_loss";
  }

  // Collect every numeric param key that appears anywhere in the ledger.
  const paramKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(numericParams(r))))).sort();
  const paramStds = perFeatureStds(rows, paramKeys);
  const metricVals = rows.map((r) => rowMetricValue(r, metric)).filter((v) => Number.isFinite(v));
  const metricStd = arrStd(metricVals) || 1;

  const candidates = rows
    .filter((r) => String(r.id) !== String(runId))
    .map((r) => {
      const d = weightedDistance(subject, r, paramKeys, paramStds, metric, metricStd, paramWeight);
      return {
        id: r.id,
        status: r.status,
        metric_value: rowMetricValue(r, metric),
        distance: d.distance,
        param_distance: d.paramDistance,
        metric_distance: d.metricDistance,
        overlap: d.overlap,
        delta: describeDelta(subject, r, paramKeys),
      };
    })
    .filter((c) => Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);

  if (formatJson) {
    console.log(JSON.stringify({
      subject: runId,
      metric,
      param_weight: paramWeight,
      neighbors: candidates,
      n_total_ledger_rows: rows.length,
      n_param_keys: paramKeys.length,
    }, null, 2));
    return;
  }

  console.log(`similar to: ${runId}`);
  console.log(`metric: ${metric}`);
  console.log(`param_weight: ${paramWeight}  (1.0 = params only, 0.0 = metric only)`);
  console.log(`params considered: ${paramKeys.length ? paramKeys.join(", ") : "(none)"}`);
  console.log("---");
  if (candidates.length === 0) {
    console.log("No comparable runs found (no overlap on any numeric param).");
    return;
  }
  console.log("| rank | id | distance | param_dist | metric_dist | metric | delta |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  candidates.forEach((c, i) => {
    const delta = c.delta.length === 0 ? "(identical params)" : c.delta.slice(0, 3).join(", ") + (c.delta.length > 3 ? ", …" : "");
    console.log(`| ${i + 1} | ${c.id} | ${fmt(c.distance, 3)} | ${fmt(c.param_distance, 3)} | ${fmt(c.metric_distance, 3)} | ${fmt(c.metric_value, 4)} | ${delta} |`);
  });
}
