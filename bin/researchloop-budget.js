// `autoresearch budget` — cost guardrail with running total.
//
// One number in `.researchloop/budget.json` ("you have $X for this project"),
// one running tally derived from `est_cost_usd` summed across ledger rows,
// and a check command that exits non-zero when the spend exceeds the limit.
// Designed to be cheap to call from hooks and CI so an agent can short-circuit
// runs that would blow the budget.
//
// We do NOT block runs ourselves — `run` doesn't know about this file. Wire
// it in via a pre-run hook (see [[autoresearch-hooks]]):
//
//   #!/bin/sh
//   autoresearch budget --check || exit 1

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, loadCostYaml, fmt, ensureDir } from "./researchloop-core.js";

function budgetFile(cwd) {
  return path.join(cwd, ".researchloop", "budget.json");
}

function readBudget(cwd) {
  const p = budgetFile(cwd);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeBudget(cwd, state) {
  const p = budgetFile(cwd);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

function computeSpend(cwd) {
  const rows = readLedgerRows(cwd);
  const cost = loadCostYaml(cwd);
  const hourly = cost && Number.isFinite(Number(cost.hourly_usd)) ? Number(cost.hourly_usd) : null;
  let recordedSum = 0;
  let derivedSum = 0;
  let n = 0;
  for (const r of rows) {
    if (Number.isFinite(Number(r.est_cost_usd))) {
      recordedSum += Number(r.est_cost_usd);
    } else if (hourly !== null && Number.isFinite(Number(r.wall_seconds))) {
      derivedSum += Number(r.wall_seconds) / 3600 * hourly;
    }
    n += 1;
  }
  return { recorded: recordedSum, derived: derivedSum, total: recordedSum + derivedSum, n };
}

export async function cmdBudget(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const setRaw = option("--set", null);
  const clearFlag = hasFlag("--clear");
  const checkFlag = hasFlag("--check");

  if (clearFlag) {
    const p = budgetFile(cwd);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    console.log(`cleared ${path.relative(cwd, p)}`);
    return;
  }

  let state = readBudget(cwd);

  if (setRaw !== null && setRaw !== undefined) {
    const limit = parseFloat(String(setRaw));
    if (!Number.isFinite(limit) || limit < 0) {
      console.error(`Invalid budget: ${setRaw}. Must be a non-negative number.`);
      process.exitCode = 1;
      return;
    }
    state = {
      limit_usd: limit,
      previous_limit_usd: state ? state.limit_usd : null,
      updated_at: new Date().toISOString(),
      note: typeof option("--note", null) === "string" ? String(option("--note", "")).slice(0, 200) : null,
    };
    writeBudget(cwd, state);
    console.log(`budget: $${fmt(limit, 2)} (was ${state.previous_limit_usd === null ? "unset" : "$" + fmt(state.previous_limit_usd, 2)})`);
  }

  const spend = computeSpend(cwd);
  const limit = state ? state.limit_usd : null;
  const remaining = limit !== null ? limit - spend.total : null;
  const pct = limit !== null && limit > 0 ? spend.total / limit * 100 : null;
  const overBudget = limit !== null && spend.total > limit;
  const nearBudget = limit !== null && pct !== null && pct >= 80 && !overBudget;

  if (formatJson) {
    console.log(JSON.stringify({
      limit_usd: limit,
      spend_usd_total: spend.total,
      spend_usd_recorded: spend.recorded,
      spend_usd_derived: spend.derived,
      remaining_usd: remaining,
      pct_used: pct,
      over_budget: overBudget,
      near_budget: nearBudget,
      n_runs: spend.n,
      updated_at: state ? state.updated_at : null,
    }, null, 2));
  } else if (!setRaw && !checkFlag) {
    // Default: show status.
    console.log("autoresearch budget");
    console.log("---");
    if (limit === null) {
      console.log("no budget set. Use: autoresearch budget --set 100");
    } else {
      console.log(`limit:     $${fmt(limit, 2)}`);
      console.log(`spent:     $${fmt(spend.total, 2)}  (recorded=$${fmt(spend.recorded, 2)}, derived=$${fmt(spend.derived, 2)})`);
      console.log(`remaining: $${fmt(remaining, 2)}  (${pct === null ? "?" : pct.toFixed(1) + "%"} used)`);
      console.log(`runs counted: ${spend.n}`);
      if (overBudget) console.log("STATUS: OVER BUDGET");
      else if (nearBudget) console.log("STATUS: near limit (>= 80% used)");
      else console.log("STATUS: ok");
    }
  } else if (checkFlag) {
    if (limit === null) {
      console.log("no budget set");
      return;
    }
    if (overBudget) {
      console.error(`OVER BUDGET: spent $${fmt(spend.total, 2)} > limit $${fmt(limit, 2)}`);
      process.exitCode = 2;
    } else if (nearBudget) {
      console.warn(`near budget: spent $${fmt(spend.total, 2)} / $${fmt(limit, 2)} (${pct.toFixed(1)}%)`);
    } else {
      console.log(`ok: $${fmt(spend.total, 2)} / $${fmt(limit, 2)} (${pct === null ? "?" : pct.toFixed(1) + "%"})`);
    }
  }
}
