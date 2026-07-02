// `autoresearch forecast --command CMD` — predict wall-clock and $ for a
// command BEFORE running it, using the ledger of past runs as training data.
//
// Method: simple nearest-history matching. We tokenize the proposed command,
// score every past run by token overlap, take the top-K matches (default 5),
// and report median / 95th-percentile wall_seconds across them. Cost is the
// same arithmetic the rest of autoresearch already uses: wall_seconds/3600 *
// hourly rate from .researchloop/cost.yaml.
//
// Two modes:
//   --command CMD                     forecast for a new command
//   --similar-to <run-id>             forecast for a stored command, with the
//                                     subject excluded from the reference pool
//
// This is intentionally crude. We're not training a model on log lines; we're
// answering "is this 10 minutes or 10 hours" so the agent can decide whether
// to spend the budget. A wider CI is itself a signal: act on the high end.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, arrMedian, percentile, loadCostYaml, fmt } from "./researchloop-core.js";

const TOKEN_RE = /[A-Za-z_][\w.-]*|\d+/g;

function tokenize(cmd) {
  if (!cmd || typeof cmd !== "string") return new Set();
  return new Set((cmd.match(TOKEN_RE) || []).map((t) => t.toLowerCase()));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function fmtSeconds(s) {
  if (!Number.isFinite(s)) return "unknown";
  if (s < 90) return `${s.toFixed(1)}s`;
  if (s < 5400) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

export async function cmdForecast(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  let cmdText = option("--command", null);
  let excludeId = null;
  const similarTo = option("--similar-to", null);
  if (similarTo && typeof similarTo === "string") {
    const rows = readLedgerRows(cwd);
    const src = findRowById(rows, similarTo);
    if (!src) {
      console.error(`Run not found: ${similarTo}`);
      process.exitCode = 1;
      return;
    }
    if (!src.command) {
      console.error(`Run ${similarTo} has no recorded command.`);
      process.exitCode = 1;
      return;
    }
    cmdText = src.command;
    excludeId = similarTo;
  }

  if (!cmdText || typeof cmdText !== "string") {
    console.error("Usage: autoresearch forecast --command CMD [--k N] [--format text|json] [--dir PATH]");
    console.error("  or:  autoresearch forecast --similar-to <run-id> [--k N] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const k = Math.max(1, parseInt(String(option("--k", "5")), 10) || 5);
  const rows = readLedgerRows(cwd);
  const candidates = rows.filter((r) => r && r.command && Number.isFinite(Number(r.wall_seconds)) && (excludeId === null || String(r.id) !== String(excludeId)));

  if (candidates.length === 0) {
    if (formatJson) {
      console.log(JSON.stringify({
        command: cmdText,
        forecast: null,
        n_reference: 0,
        reason: "no prior runs with wall_seconds in the ledger",
      }, null, 2));
    } else {
      console.log(`autoresearch forecast`);
      console.log(`command: ${cmdText}`);
      console.log("forecast: unavailable — no prior runs with wall_seconds in the ledger");
    }
    return;
  }

  const proposedTokens = tokenize(cmdText);
  const scored = candidates
    .map((r) => ({
      id: r.id,
      command: r.command,
      wall_seconds: Number(r.wall_seconds),
      est_cost_usd: Number.isFinite(Number(r.est_cost_usd)) ? Number(r.est_cost_usd) : null,
      similarity: jaccard(proposedTokens, tokenize(r.command)),
    }))
    .filter((s) => s.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  const reference = scored.length > 0 ? scored : candidates.slice(-Math.min(k, candidates.length)).map((r) => ({
    id: r.id,
    command: r.command,
    wall_seconds: Number(r.wall_seconds),
    est_cost_usd: Number.isFinite(Number(r.est_cost_usd)) ? Number(r.est_cost_usd) : null,
    similarity: 0,
  }));

  const walls = reference.map((r) => r.wall_seconds);
  const median = arrMedian(walls);
  const p95 = percentile(walls, 0.95);
  const minW = Math.min(...walls);
  const maxW = Math.max(...walls);

  const cost = loadCostYaml(cwd);
  const hourly = cost && Number.isFinite(Number(cost.hourly_usd)) ? Number(cost.hourly_usd) : null;
  const costMedian = hourly !== null ? median / 3600 * hourly : null;
  const costP95 = hourly !== null ? p95 / 3600 * hourly : null;

  const forecast = {
    command: cmdText,
    n_reference: reference.length,
    fallback_used: scored.length === 0,
    wall_seconds: { median, p95, min: minW, max: maxW },
    est_cost_usd: hourly !== null ? { median: costMedian, p95: costP95, hourly_usd: hourly } : null,
    matches: reference,
  };

  if (formatJson) {
    console.log(JSON.stringify(forecast, null, 2));
    return;
  }

  console.log(`autoresearch forecast`);
  console.log(`command: ${cmdText}`);
  if (excludeId) console.log(`reference: similar-to ${excludeId} (excluded from pool)`);
  console.log(`n_reference: ${reference.length}${scored.length === 0 ? " (fallback: recent runs; no token overlap)" : ""}`);
  console.log("---");
  console.log(`wall_seconds: median=${fmtSeconds(median)}  p95=${fmtSeconds(p95)}  min=${fmtSeconds(minW)}  max=${fmtSeconds(maxW)}`);
  if (hourly !== null) {
    console.log(`est_cost_usd: median=$${fmt(costMedian, 4)}  p95=$${fmt(costP95, 4)}  (hourly_usd=${fmt(hourly, 4)})`);
  } else {
    console.log("est_cost_usd: unavailable — add .researchloop/cost.yaml with `hourly_usd: N` to enable");
  }
  console.log("---");
  console.log("nearest matches:");
  console.log("| id | similarity | wall | cost_usd |");
  console.log("| --- | --- | --- | --- |");
  for (const m of reference) {
    console.log(`| ${m.id} | ${fmt(m.similarity, 3)} | ${fmtSeconds(m.wall_seconds)} | ${m.est_cost_usd === null ? "—" : "$" + fmt(m.est_cost_usd, 4)} |`);
  }
}
