// `autoresearch summary` — single-screen project snapshot.
//
// Different from `leaderboard` (which is the metric-sorted top-N table) and
// from `retrospective` (which is the weekly synthesis): this is the "what's
// the state of this project right now?" view. Designed for the agent's first
// look after `cd`-ing into the repo, or for a human glancing at the project
// before standup.
//
// Sections:
//   - goal one-liner
//   - baseline + best-so-far + gap
//   - active runs (status not yet terminal)
//   - recent activity (last 5 rows, oldest -> newest)
//   - blockers (failed/killed-by-safety/killed-by-rule rows that haven't been
//     archived — these need a human or agent decision)

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, fmt } from "./researchloop-core.js";

function readGoalLine(cwd) {
  const p = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  // Pick the first non-empty line that isn't a heading.
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    return t.slice(0, 200);
  }
  return null;
}

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

function rowTimestamp(row) {
  const t = row.timestamp || row.ended_at || row.started_at || null;
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
}

function rowTimestampMs(row) {
  const ts = rowTimestamp(row);
  return ts ? ts.getTime() : 0;
}

function countJsonlRows(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .length;
}

function isBaselineRow(row) {
  if (!row) return false;
  if (Array.isArray(row.tags) && row.tags.includes("baseline")) return true;
  if (row.agent === "autoresearch baseline") return true;
  if (row.is_baseline === true || row.config?.is_baseline === true) return true;
  return String(row.id || "").startsWith("baseline-");
}

function buildNextAction(data) {
  if (!data.initialized) {
    return {
      label: "initialize the loop",
      command: "autoresearch init --agent codex",
      reason: "no .researchloop directory exists yet",
    };
  }
  if (!data.goal_line) {
    return {
      label: "write the research goal",
      command: "autoresearch goal \"lower validation loss\" --metric val_loss --direction lower",
      reason: "the loop needs a durable objective before ranking experiments",
    };
  }
  if (!data.baseline) {
    return {
      label: "check and lock the baseline",
      command: "autoresearch baseline-status",
      reason: "runs are hard to interpret until the baseline is documented",
    };
  }
  if (data.active_runs.length > 0) {
    const run = data.active_runs[0];
    return {
      label: "watch the active run",
      command: `autoresearch tail ${run.id} --metrics --lines 20`,
      reason: "there is already work in flight",
    };
  }
  if (data.blockers.length > 0) {
    const run = data.blockers[0];
    return {
      label: "inspect the top blocker",
      command: `autoresearch tail ${run.id} --lines 80`,
      reason: "a failed or killed run needs a decision before more runs pile up",
    };
  }
  if (data.proposals.ranked > 0) {
    return {
      label: "turn the top ranked proposal into a runbook",
      command: "autoresearch next-experiment --write",
      reason: "ranked proposals already exist",
    };
  }
  if (data.proposals.open > 0) {
    return {
      label: "rank the proposal backlog",
      command: "autoresearch rank --write",
      reason: "proposal rows exist but are not ranked yet",
    };
  }
  if (data.n_evaluable_runs === 0) {
    return {
      label: "create the first grounded proposal",
      command: "autoresearch propose --n 5 --write --with-priors",
      reason: "baseline is present but no completed experiment rows exist yet",
    };
  }
  if (data.best && String(data.best.status || "").toLowerCase() !== "promoted") {
    return {
      label: "review the current best run",
      command: `autoresearch review --id ${data.best.id}`,
      reason: "a best run exists and has not been promoted",
    };
  }
  return {
    label: "write the lab note",
    command: "autoresearch report --format markdown --out report.md --include-plots",
    reason: "the loop is stable enough to summarize for review",
  };
}

function renderSummaryText(data) {
  const lines = [];
  lines.push("autoresearch summary");
  lines.push("====================");
  if (data.goal_line) lines.push(`goal: ${data.goal_line}`);
  lines.push("");
  lines.push(`metric: ${data.metric}  (${data.direction} is better)`);
  if (data.baseline) {
    lines.push(`baseline: ${data.baseline.id} = ${fmt(data.baseline.value, 4)}`);
  } else {
    lines.push("baseline: not established - `autoresearch baseline --lock` recommended");
  }
  if (data.best) {
    const gap = data.gap_from_baseline;
    const pctGap = data.pct_gap;
    lines.push(`best:     ${data.best.id} = ${fmt(data.best.value, 4)}` + (gap !== null ? `  delta=${gap >= 0 ? "+" : ""}${fmt(gap, 4)}${pctGap !== null ? ` (${pctGap.toFixed(2)}%)` : ""}` : ""));
  }
  lines.push(`runs: ${data.n_runs_total} total, ${data.n_active} active, ${data.n_blockers} blocked`);
  lines.push(`proposals: ${data.proposals.open} open, ${data.proposals.ranked} ranked`);
  lines.push("");

  if (data.active_runs.length > 0) {
    lines.push("Active:");
    for (const r of data.active_runs.slice(0, 10)) {
      lines.push(`  - ${r.id} [${r.status || "?"}]${r.started_at ? "  started " + r.started_at : ""}`);
    }
    lines.push("");
  }

  if (data.blockers.length > 0) {
    lines.push("Blockers (decide: investigate, retry, or archive):");
    for (const r of data.blockers.slice(0, 10)) {
      lines.push(`  - ${r.id} [${r.status}]${r.kill_reason ? "  reason: " + r.kill_reason : ""}`);
    }
    lines.push("");
  }

  if (data.recent.length > 0) {
    lines.push("Recent:");
    for (const r of data.recent) {
      lines.push(`  - ${r.id} [${r.status || "?"}]  ${r.ts || ""}  ${data.metric}=${fmt(r.value, 4)}`);
    }
    lines.push("");
  }

  lines.push("Next action:");
  lines.push(`  ${data.next_action.label}: ${data.next_action.command}`);
  lines.push(`  reason: ${data.next_action.reason}`);
  return lines.join("\n");
}

const HEALTHY_STATUSES = new Set(["complete", "completed", "promoted", "kept"]);
const TERMINAL_STATUSES = new Set(["complete", "completed", "promoted", "kept", "discarded", "archived", "failed", "killed_by_safety", "killed_by_rule", "spawn_error", "timeout", "complete_no_metric", "complete_partial", "recorded"]);
const BLOCKER_STATUSES = new Set(["failed", "killed_by_safety", "killed_by_rule", "spawn_error", "timeout"]);

export async function cmdSummary(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const outFile = option("--out", null);

  const goalDefaults = readGoalMetric(cwd);
  const goalLine = readGoalLine(cwd);
  const metric = String(option("--metric", goalDefaults.metric || "val_loss")).trim() || "val_loss";
  const directionRaw = String(option("--direction", goalDefaults.direction || "lower")).toLowerCase();
  const preferHigher = directionRaw.startsWith("high") || directionRaw === "max" || directionRaw === "maximize";

  const rows = readLedgerRows(cwd);
  const rowsByMetric = rows
    .map((r) => ({ row: r, value: rowMetricValue(r, metric) }))
    .filter((e) => Number.isFinite(e.value));

  const baselineEntry = rowsByMetric.slice().reverse().find((e) => isBaselineRow(e.row))?.row || null;
  const baselineVal = baselineEntry ? rowMetricValue(baselineEntry, metric) : null;
  const experimentEntries = rowsByMetric
    .filter((e) => !isBaselineRow(e.row))
    .filter((e) => HEALTHY_STATUSES.has(String(e.row.status || "").toLowerCase()));
  const best = experimentEntries.length > 0
    ? experimentEntries.slice().sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value)[0]
    : null;
  const gap = (best && baselineVal !== null) ? best.value - baselineVal : null;
  const pctGap = (gap !== null && baselineVal !== 0 && Number.isFinite(baselineVal)) ? gap / Math.abs(baselineVal) * 100 : null;

  const activeRuns = rows
    .filter((r) => !TERMINAL_STATUSES.has(String(r.status || "").toLowerCase()))
    .sort((a, b) => rowTimestampMs(b) - rowTimestampMs(a));
  const blockers = rows
    .filter((r) => BLOCKER_STATUSES.has(String(r.status || "").toLowerCase()))
    .sort((a, b) => rowTimestampMs(b) - rowTimestampMs(a));
  const recent = rows.slice(-5);
  const initialized = fs.existsSync(path.join(cwd, ".researchloop"));
  const proposalCount = countJsonlRows(path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl"));
  const rankedProposalCount = countJsonlRows(path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.jsonl"));

  const data = {
    initialized,
    goal_line: goalLine,
    metric,
    direction: preferHigher ? "higher" : "lower",
    baseline: baselineEntry ? { id: baselineEntry.id, value: baselineVal } : null,
    best: best ? { id: best.row.id, value: best.value, status: best.row.status } : null,
    gap_from_baseline: gap,
    pct_gap: pctGap,
    n_runs_total: rows.length,
    n_evaluable_runs: experimentEntries.length,
    n_active: activeRuns.length,
    n_blockers: blockers.length,
    proposals: {
      open: proposalCount,
      ranked: rankedProposalCount,
    },
    active_runs: activeRuns.map((r) => ({ id: r.id, status: r.status, started_at: r.started_at || r.timestamp })),
    blockers: blockers.map((r) => ({ id: r.id, status: r.status, kill_reason: r.kill_reason || null })),
    recent: recent.map((r) => ({ id: r.id, status: r.status, ts: rowTimestamp(r), value: rowMetricValue(r, metric) })).map((e) => ({ ...e, ts: e.ts ? e.ts.toISOString() : null })),
  };
  data.next_action = buildNextAction(data);

  if (formatJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const rendered = renderSummaryText(data);
  if (outFile) {
    const resolved = path.isAbsolute(String(outFile)) ? String(outFile) : path.join(cwd, String(outFile));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, rendered + "\n");
  }
  console.log(rendered);
}
