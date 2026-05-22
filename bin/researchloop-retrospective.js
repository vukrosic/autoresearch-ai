// `autoresearch retrospective --since 7d` — weekly synthesis.
//
// Aggregates the last N days of activity into a single status-update-shaped
// markdown report:
//   - run volume (total / promoted / discarded / failed / archived)
//   - top winners by primary metric, with delta vs baseline
//   - newest dead ends + their reasons
//   - newest lessons captured
//   - dominant mechanisms tried (frequency table)
//   - rough compute spend (sum of wall_seconds, est_cost_usd)
//
// Designed to be pasted into a weekly research-update doc. The narrative is
// terse on purpose — researchers want signal, not adjectives.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, fmt, loadCostYaml } from "./researchloop-core.js";

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

function listLessons(cwd, sinceMs) {
  const dir = path.join(cwd, ".researchloop", "learnings");
  if (!fs.existsSync(dir)) return [];
  const cutoff = sinceMs === null ? 0 : Date.now() - sinceMs;
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      id: f.replace(/\.md$/, ""),
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime,
    }))
    .filter((l) => l.mtime.getTime() >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);
}

function listDeadEnds(cwd) {
  const dir = path.join(cwd, ".researchloop", "dead-ends");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .map((id) => {
      const archiveFile = path.join(dir, id, "ARCHIVE.md");
      let reason = ""; let archivedAt = ""; let mechanism = "";
      if (fs.existsSync(archiveFile)) {
        const text = fs.readFileSync(archiveFile, "utf8");
        reason = (text.match(/^Reason:\s*(.+)$/m) || [, ""])[1].trim();
        archivedAt = (text.match(/^Archived:\s*(.+)$/m) || [, ""])[1].trim();
        mechanism = (text.match(/^Mechanism:\s*(.+)$/m) || [, ""])[1].trim();
      }
      return { id, reason, archived_at: archivedAt, mechanism };
    });
}

function mechanismBuckets(rows) {
  const m = new Map();
  for (const r of rows) {
    const mech = r.mechanism || r.hypothesis_mechanism || (r.config && r.config.mechanism) || null;
    if (!mech) continue;
    const k = String(mech).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 240);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).map(([mechanism, count]) => ({ mechanism, count })).sort((a, b) => b.count - a.count);
}

function summarizeBlock(text, maxLines = 3, maxChars = 200) {
  if (!text) return "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join(" ").slice(0, maxChars);
}

export async function cmdRetrospective(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const since = option("--since", "7d");
  const sinceMs = parseDuration(since);
  const cutoff = sinceMs === null ? null : Date.now() - sinceMs;

  const goalDefaults = readGoalMetric(cwd);
  const metric = String(option("--metric", goalDefaults.metric || "val_loss")).trim() || "val_loss";
  const directionRaw = String(option("--direction", goalDefaults.direction || "lower")).toLowerCase();
  const preferHigher = directionRaw.startsWith("high") || directionRaw === "max" || directionRaw === "maximize";

  const allRows = readLedgerRows(cwd);
  const rows = cutoff !== null
    ? allRows.filter((r) => { const t = rowTimestamp(r); return t && t.getTime() >= cutoff; })
    : allRows;

  const counts = { total: rows.length, promoted: 0, kept: 0, complete: 0, discarded: 0, failed: 0, killed: 0, archived: 0 };
  for (const r of rows) {
    const s = String(r.status || "").toLowerCase();
    if (s === "promoted") counts.promoted += 1;
    else if (s === "kept") counts.kept += 1;
    else if (s === "complete" || s === "completed") counts.complete += 1;
    else if (s === "discarded") counts.discarded += 1;
    else if (s === "failed" || s === "spawn_error" || s === "complete_no_metric") counts.failed += 1;
    else if (s.startsWith("killed")) counts.killed += 1;
    else if (s === "archived") counts.archived += 1;
  }

  const scored = rows
    .map((r) => ({ id: r.id, status: r.status, value: rowMetricValue(r, metric) }))
    .filter((e) => Number.isFinite(e.value))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  const top = scored.slice(0, 5);

  const baselineEntry = allRows.find((r) => Array.isArray(r.tags) && r.tags.includes("baseline") && Number.isFinite(rowMetricValue(r, metric)));
  const baselineVal = baselineEntry ? rowMetricValue(baselineEntry, metric) : null;

  // Compute spend.
  let totalWall = 0;
  let totalCost = 0;
  for (const r of rows) {
    if (Number.isFinite(Number(r.wall_seconds))) totalWall += Number(r.wall_seconds);
    if (Number.isFinite(Number(r.est_cost_usd))) totalCost += Number(r.est_cost_usd);
  }
  const cost = loadCostYaml(cwd);
  const hourly = cost && Number.isFinite(Number(cost.hourly_usd)) ? Number(cost.hourly_usd) : null;

  const lessons = listLessons(cwd, sinceMs);
  const deadEnds = listDeadEnds(cwd);
  const mechBuckets = mechanismBuckets(rows).slice(0, 5);

  const data = {
    since,
    window_start: cutoff ? new Date(cutoff).toISOString() : null,
    window_end: new Date().toISOString(),
    metric,
    direction: preferHigher ? "higher" : "lower",
    counts,
    baseline: baselineEntry ? { id: baselineEntry.id, value: baselineVal } : null,
    top_runs: top.map((t) => ({
      id: t.id,
      status: t.status,
      value: t.value,
      delta_from_baseline: baselineVal !== null ? t.value - baselineVal : null,
    })),
    lessons: lessons.slice(0, 5).map((l) => ({ id: l.id, mtime: l.mtime.toISOString() })),
    dead_ends: deadEnds.slice(0, 5),
    dominant_mechanisms: mechBuckets,
    compute: {
      wall_seconds_total: totalWall,
      wall_hours_total: totalWall / 3600,
      est_cost_usd_total: totalCost > 0 ? totalCost : (hourly !== null ? totalWall / 3600 * hourly : null),
      hourly_usd: hourly,
    },
  };

  if (formatJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = [];
  lines.push(`# Retrospective — last ${since}`);
  lines.push("");
  lines.push(`_${data.window_start || "(all time)"} → ${data.window_end}_`);
  lines.push("");
  lines.push("## Activity");
  lines.push("");
  lines.push(`- runs: **${counts.total}**   promoted: ${counts.promoted}   kept: ${counts.kept}   complete: ${counts.complete}   discarded: ${counts.discarded}   failed: ${counts.failed}   killed: ${counts.killed}   archived: ${counts.archived}`);
  lines.push(`- wall time: ${(data.compute.wall_hours_total).toFixed(2)}h${data.compute.est_cost_usd_total !== null ? `   est cost: $${fmt(data.compute.est_cost_usd_total, 2)}` : ""}`);
  lines.push("");
  lines.push(`## Top ${top.length} by ${metric} (${preferHigher ? "higher" : "lower"} better)`);
  lines.push("");
  if (top.length === 0) {
    lines.push("_(no runs with finite metric in window)_");
  } else {
    lines.push("| rank | id | status | " + metric + " | Δ vs base |");
    lines.push("| --- | --- | --- | --- | --- |");
    top.forEach((t, i) => {
      const delta = baselineVal !== null ? t.value - baselineVal : null;
      lines.push(`| ${i + 1} | \`${t.id}\` | ${t.status || "—"} | ${fmt(t.value, 4)} | ${delta === null ? "—" : (delta >= 0 ? "+" : "") + fmt(delta, 4)} |`);
    });
  }
  lines.push("");
  if (lessons.length > 0) {
    lines.push("## Lessons captured this window");
    lines.push("");
    for (const l of lessons.slice(0, 5)) {
      const text = fs.readFileSync(l.path, "utf8");
      const snippet = summarizeBlock(text.split(/\n## /)[1] || text);
      lines.push(`- **${l.id}**: ${snippet}`);
    }
    lines.push("");
  }
  if (deadEnds.length > 0) {
    lines.push("## Dead ends (most recent)");
    lines.push("");
    for (const d of deadEnds.slice(0, 5)) {
      lines.push(`- **${d.id}**${d.mechanism ? ` (${d.mechanism})` : ""}: ${d.reason || "—"}`);
    }
    lines.push("");
  }
  if (mechBuckets.length > 0) {
    lines.push("## Mechanisms tried");
    lines.push("");
    lines.push("| count | mechanism |");
    lines.push("| --- | --- |");
    for (const m of mechBuckets) {
      const trimmed = m.mechanism.length > 100 ? m.mechanism.slice(0, 97) + "…" : m.mechanism;
      lines.push(`| ${m.count} | ${trimmed} |`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Generated by \`autoresearch retrospective --since ${since}\` on ${new Date().toISOString()}_`);
  lines.push("");

  const body = lines.join("\n");
  const outPath = option("--out", null);
  if (outPath && typeof outPath === "string") {
    fs.writeFileSync(outPath, body);
    console.log(`wrote ${outPath} (${body.split("\n").length} lines)`);
  } else {
    process.stdout.write(body);
  }
}
