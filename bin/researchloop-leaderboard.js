// `autoresearch leaderboard` — top-N runs by metric, with deltas vs baseline.
//
// `compare` already prints the best run, but a working researcher wants a
// dashboard-style snapshot they can paste into a status update: top 10 runs,
// delta-from-baseline as both absolute and percent, run status, optional cost.
//
// Defaults to the goal's primary metric and direction; both overridable. With
// `--since DURATION` (e.g. `7d`, `24h`) the leaderboard filters to recent
// runs only — useful for week-in-review summaries.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, fmt } from "./researchloop-core.js";

function readGoalMetric(cwd) {
  const p = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(p)) return { metric: null, direction: null };
  const text = fs.readFileSync(p, "utf8");
  const metricMatch = text.match(/^\s*[-*]?\s*metric:\s*([^\n]+)/im) || text.match(/^\s*metric:\s*([^\n]+)/im);
  const dirMatch = text.match(/^\s*[-*]?\s*direction:\s*([^\n]+)/im) || text.match(/^\s*direction:\s*([^\n]+)/im);
  return {
    metric: metricMatch ? metricMatch[1].trim() : null,
    direction: dirMatch ? dirMatch[1].trim().toLowerCase() : null,
  };
}

function parseDuration(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([smhd])$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
  return n * mult;
}

function rowTimestamp(row) {
  const t = row.timestamp || row.ended_at || row.started_at || null;
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function cmdLeaderboard(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const goalDefaults = readGoalMetric(cwd);
  const metric = String(option("--metric", goalDefaults.metric || "val_loss")).trim() || "val_loss";
  const directionRaw = String(option("--direction", goalDefaults.direction || "lower")).toLowerCase();
  const preferHigher = directionRaw.startsWith("high") || directionRaw === "max" || directionRaw === "maximize";
  const top = Math.max(1, parseInt(String(option("--top", "10")), 10) || 10);
  const sinceMs = parseDuration(option("--since", null));
  const includeFailed = String(option("--include", "complete")).toLowerCase() === "all";

  let rows = readLedgerRows(cwd);
  if (!includeFailed) {
    rows = rows.filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return ["complete", "completed", "promoted", "kept"].includes(s);
    });
  }
  if (sinceMs !== null) {
    const cutoff = Date.now() - sinceMs;
    rows = rows.filter((r) => {
      const t = rowTimestamp(r);
      return t && t.getTime() >= cutoff;
    });
  }

  const scored = rows
    .map((r) => ({
      row: r,
      value: rowMetricValue(r, metric),
    }))
    .filter((e) => Number.isFinite(e.value));

  if (scored.length === 0) {
    if (formatJson) {
      console.log(JSON.stringify({ metric, direction: preferHigher ? "higher" : "lower", n: 0, baseline: null, entries: [] }, null, 2));
    } else {
      console.log(`No runs with finite ${metric}. Set --metric or --include all.`);
    }
    return;
  }

  // Baseline = whichever row carries tag "baseline" first, else the first chronological run.
  const baselineEntry = scored.find((e) => Array.isArray(e.row.tags) && e.row.tags.includes("baseline"))
    || scored.slice().sort((a, b) => {
      const ta = rowTimestamp(a.row);
      const tb = rowTimestamp(b.row);
      return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
    })[0];

  const baselineVal = baselineEntry ? baselineEntry.value : null;

  scored.sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  const top10 = scored.slice(0, top);

  const enriched = top10.map((e, i) => {
    const delta = baselineVal !== null ? e.value - baselineVal : null;
    const pct = (baselineVal !== null && baselineVal !== 0) ? delta / Math.abs(baselineVal) * 100 : null;
    // "improved" means moved in the goal direction
    const improved = delta === null ? null : (preferHigher ? delta > 0 : delta < 0);
    return {
      rank: i + 1,
      id: e.row.id,
      status: e.row.status,
      value: e.value,
      delta_from_baseline: delta,
      pct_from_baseline: pct,
      improved,
      wall_seconds: Number.isFinite(Number(e.row.wall_seconds)) ? Number(e.row.wall_seconds) : null,
      est_cost_usd: Number.isFinite(Number(e.row.est_cost_usd)) ? Number(e.row.est_cost_usd) : null,
      is_baseline: baselineEntry && e.row.id === baselineEntry.row.id,
    };
  });

  if (formatJson) {
    console.log(JSON.stringify({
      metric,
      direction: preferHigher ? "higher" : "lower",
      baseline: baselineEntry ? { id: baselineEntry.row.id, value: baselineEntry.value } : null,
      n_total: scored.length,
      n_returned: enriched.length,
      since: option("--since", null),
      entries: enriched,
    }, null, 2));
    return;
  }

  console.log("autoresearch leaderboard");
  console.log(`metric: ${metric}  direction: ${preferHigher ? "higher" : "lower"}`);
  if (baselineEntry) console.log(`baseline: ${baselineEntry.row.id} = ${fmt(baselineEntry.value, 4)}`);
  console.log(`n_total: ${scored.length}  showing: top ${enriched.length}`);
  if (sinceMs !== null) console.log(`window: since ${option("--since", null)}`);
  console.log("---");
  console.log("| rank | id | status | value | Δ vs base | % vs base | wall | $ |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const e of enriched) {
    const mark = e.is_baseline ? "*" : (e.improved === null ? "" : (e.improved ? "↑" : "↓"));
    const wall = e.wall_seconds === null ? "—" : (e.wall_seconds < 90 ? `${e.wall_seconds.toFixed(0)}s` : `${(e.wall_seconds / 60).toFixed(1)}m`);
    const cost = e.est_cost_usd === null ? "—" : `$${fmt(e.est_cost_usd, 4)}`;
    const delta = e.delta_from_baseline === null ? "—" : fmt(e.delta_from_baseline, 4);
    const pct = e.pct_from_baseline === null ? "—" : `${e.pct_from_baseline.toFixed(2)}%`;
    console.log(`| ${e.rank}${mark} | ${e.id} | ${e.status || "—"} | ${fmt(e.value, 4)} | ${delta} | ${pct} | ${wall} | ${cost} |`);
  }
}
