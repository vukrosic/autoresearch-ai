// `autoresearch pareto --metrics m1,m2 [--direction m1=lower,m2=higher]`
//
// When two metrics matter (loss + latency, acc + model_size, F1 + cost),
// "winner" isn't a single number — it's a Pareto frontier. This command
// computes the non-dominated set across the chosen metrics and renders it
// alongside the dominated runs, sorted by the first metric.
//
// Optimization directions default to "lower" for any metric whose name
// suggests loss / cost / latency / error, and "higher" for everything else.
// Override per-metric via --direction.

import { readLedgerRows, fmt, rowMetricValue } from "./researchloop-core.js";

const DEFAULT_LOWER_KEYWORDS = ["loss", "error", "cost", "latency", "ppl", "perplexity", "mse", "rmse", "mae"];

function defaultDirectionForMetric(metric) {
  const lower = metric.toLowerCase();
  return DEFAULT_LOWER_KEYWORDS.some((k) => lower.includes(k)) ? "lower" : "higher";
}

function parseDirectionFlag(raw, metrics) {
  const dirs = {};
  for (const m of metrics) dirs[m] = defaultDirectionForMetric(m);
  if (raw && typeof raw === "string") {
    for (const part of raw.split(/[,;]/)) {
      const [name, value] = part.split("=").map((s) => s.trim());
      if (!name || !value) continue;
      const v = value.toLowerCase();
      if (v.startsWith("low") || v === "min" || v === "minimize") dirs[name] = "lower";
      else if (v.startsWith("high") || v === "max" || v === "maximize") dirs[name] = "higher";
    }
  }
  return dirs;
}

// A dominates B iff:
//  - A is no worse than B on every metric, AND
//  - A is strictly better than B on at least one metric.
function dominates(a, b, metrics, directions) {
  let strictlyBetter = false;
  for (const m of metrics) {
    const dir = directions[m];
    const av = a.values[m];
    const bv = b.values[m];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
    if (dir === "lower") {
      if (av > bv) return false;
      if (av < bv) strictlyBetter = true;
    } else {
      if (av < bv) return false;
      if (av > bv) strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

export async function cmdPareto(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const metricsRaw = option("--metrics", null);
  if (!metricsRaw || typeof metricsRaw !== "string") {
    console.error("Usage: autoresearch pareto --metrics m1,m2[,...] [--direction m1=lower,m2=higher] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  const metrics = metricsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (metrics.length < 2) {
    console.error("Pareto needs at least two metrics. Got: " + metrics.join(","));
    process.exitCode = 1;
    return;
  }
  const directions = parseDirectionFlag(option("--direction", null), metrics);

  const rows = readLedgerRows(cwd);
  const points = rows
    .map((r) => {
      const values = {};
      let ok = true;
      for (const m of metrics) {
        const v = rowMetricValue(r, m);
        if (!Number.isFinite(v)) { ok = false; break; }
        values[m] = v;
      }
      return ok ? { id: r.id, status: r.status, values } : null;
    })
    .filter(Boolean);

  if (points.length === 0) {
    if (formatJson) {
      console.log(JSON.stringify({ metrics, directions, frontier: [], dominated: [], reason: "no rows have finite values for all chosen metrics" }, null, 2));
    } else {
      console.log("No rows with finite values for all chosen metrics: " + metrics.join(", "));
    }
    return;
  }

  // O(n^2) — fine for typical ledgers (hundreds, not millions).
  const frontier = [];
  const dominated = [];
  for (const p of points) {
    const isDominated = points.some((q) => q !== p && dominates(q, p, metrics, directions));
    (isDominated ? dominated : frontier).push(p);
  }

  // Sort frontier by first metric in its preferred direction.
  frontier.sort((a, b) => directions[metrics[0]] === "lower"
    ? a.values[metrics[0]] - b.values[metrics[0]]
    : b.values[metrics[0]] - a.values[metrics[0]]);
  dominated.sort((a, b) => directions[metrics[0]] === "lower"
    ? a.values[metrics[0]] - b.values[metrics[0]]
    : b.values[metrics[0]] - a.values[metrics[0]]);

  if (formatJson) {
    console.log(JSON.stringify({
      metrics,
      directions,
      n_points: points.length,
      n_frontier: frontier.length,
      frontier,
      dominated,
    }, null, 2));
    return;
  }

  console.log("autoresearch pareto");
  console.log(`metrics: ${metrics.join(", ")}`);
  console.log(`directions: ${metrics.map((m) => `${m}=${directions[m]}`).join(", ")}`);
  console.log(`n_points: ${points.length}  n_frontier: ${frontier.length}`);
  console.log("---");
  const header = `| ★ | id | status | ${metrics.join(" | ")} |`;
  const divider = `| --- | --- | --- | ${metrics.map(() => "---").join(" | ")} |`;
  console.log(header);
  console.log(divider);
  for (const p of frontier) {
    console.log(`| ★ | ${p.id} | ${p.status || "—"} | ${metrics.map((m) => fmt(p.values[m], 6)).join(" | ")} |`);
  }
  for (const p of dominated) {
    console.log(`|   | ${p.id} | ${p.status || "—"} | ${metrics.map((m) => fmt(p.values[m], 6)).join(" | ")} |`);
  }
}
