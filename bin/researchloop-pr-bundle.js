// `autoresearch pr-bundle <run-id>` — markdown summary for a PR description.
//
// Most of an experiment PR is the same shape every time:
//   - one-line headline ("X improved Y from a to b")
//   - the baseline number, the new number, the delta
//   - what changed (config diff vs parent / vs baseline)
//   - reproducibility info (env, command, wall_seconds, cost)
//   - a link to the dashboard
//
// We can render all of that from one run row. The output goes to stdout so it
// can be piped into `gh pr create --body-file -`, or to `--out FILE.md`.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, rowMetricValue, fmt } from "./researchloop-core.js";

function fmtSeconds(s) {
  if (!Number.isFinite(s)) return "—";
  if (s < 90) return `${s.toFixed(1)}s`;
  if (s < 5400) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

function paramDiff(a, b) {
  const ap = (a && a.params) || (a && a.config && a.config.params) || {};
  const bp = (b && b.params) || (b && b.config && b.config.params) || {};
  const keys = Array.from(new Set([...Object.keys(ap), ...Object.keys(bp)])).sort();
  return keys
    .filter((k) => String(ap[k]) !== String(bp[k]))
    .map((k) => ({ key: k, base: ap[k] ?? null, run: bp[k] ?? null }));
}

function metricDiff(a, b) {
  if (!a || !b || !a.metrics || !b.metrics) return [];
  const keys = Array.from(new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])).filter((k) => !k.endsWith("_std")).sort();
  return keys.map((k) => ({
    key: k,
    base: rowMetricValue(a, k),
    run: rowMetricValue(b, k),
  }));
}

function pickBaseline(rows, subject) {
  // Prefer rows tagged "baseline"; else the row pointed to by parent_id; else first chronological.
  const tagged = rows.find((r) => Array.isArray(r.tags) && r.tags.includes("baseline"));
  if (tagged) return tagged;
  if (subject.parent_id) {
    const parent = rows.find((r) => String(r.id) === String(subject.parent_id));
    if (parent) return parent;
  }
  return rows[0] || null;
}

export async function cmdPrBundle(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();

  const idx = args.findIndex((a) => a === "pr-bundle");
  let runId = String(option("--id", "")).trim();
  if (!runId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    runId = String(args[idx + 1]).trim();
  }

  if (!runId) {
    console.error("Usage: autoresearch pr-bundle <run-id> [--baseline-id ID] [--out FILE.md] [--dashboard-url URL] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const subject = findRowById(rows, runId);
  if (!subject) {
    console.error(`Run not found: ${runId}`);
    process.exitCode = 1;
    return;
  }

  const baselineId = option("--baseline-id", null);
  const baseline = baselineId && typeof baselineId === "string"
    ? findRowById(rows, baselineId)
    : pickBaseline(rows, subject);

  const metricKeys = subject.metrics ? Object.keys(subject.metrics).filter((k) => !k.endsWith("_std")) : [];
  const primaryMetric = metricKeys.find((k) => Number.isFinite(rowMetricValue(subject, k))) || metricKeys[0] || null;
  const subjectVal = primaryMetric ? rowMetricValue(subject, primaryMetric) : null;
  const baselineVal = baseline && primaryMetric ? rowMetricValue(baseline, primaryMetric) : null;
  const delta = (Number.isFinite(subjectVal) && Number.isFinite(baselineVal)) ? subjectVal - baselineVal : null;
  const pct = (delta !== null && baselineVal !== 0 && Number.isFinite(baselineVal)) ? delta / Math.abs(baselineVal) * 100 : null;

  const headline = primaryMetric && Number.isFinite(subjectVal)
    ? (Number.isFinite(baselineVal)
        ? `${primaryMetric}: ${fmt(baselineVal, 4)} → ${fmt(subjectVal, 4)} (${delta >= 0 ? "+" : ""}${fmt(delta, 4)}${pct !== null ? `, ${pct.toFixed(2)}%` : ""})`
        : `${primaryMetric}: ${fmt(subjectVal, 4)}`)
    : `Run ${runId}`;

  const pd = baseline ? paramDiff(baseline, subject) : [];
  const md = baseline ? metricDiff(baseline, subject) : [];
  const dashUrl = option("--dashboard-url", null);

  const lines = [];
  lines.push(`# ${headline}`);
  lines.push("");
  lines.push(`Run: \`${runId}\`  · Status: \`${subject.status || "unknown"}\`  · Wall: ${fmtSeconds(Number(subject.wall_seconds))}` + (Number.isFinite(Number(subject.est_cost_usd)) ? `  · Cost: $${fmt(Number(subject.est_cost_usd), 4)}` : ""));
  if (baseline) lines.push(`Baseline: \`${baseline.id}\``);
  lines.push("");
  if (md.length > 0) {
    lines.push("## Metrics");
    lines.push("");
    lines.push("| metric | baseline | run | delta |");
    lines.push("| --- | --- | --- | --- |");
    for (const m of md) {
      const d = (Number.isFinite(m.run) && Number.isFinite(m.base)) ? m.run - m.base : null;
      lines.push(`| ${m.key} | ${fmt(m.base, 4)} | ${fmt(m.run, 4)} | ${d === null ? "—" : (d >= 0 ? "+" : "") + fmt(d, 4)} |`);
    }
    lines.push("");
  }
  if (pd.length > 0) {
    lines.push("## What changed (vs baseline)");
    lines.push("");
    lines.push("| param | baseline | this run |");
    lines.push("| --- | --- | --- |");
    for (const p of pd) {
      lines.push(`| ${p.key} | \`${p.base ?? "—"}\` | \`${p.run ?? "—"}\` |`);
    }
    lines.push("");
  }
  lines.push("## Reproducibility");
  lines.push("");
  lines.push("```");
  lines.push(`command: ${subject.command || "(none recorded)"}`);
  if (subject.env) {
    const env = subject.env;
    lines.push(`git_sha: ${env.git_sha || "?"}  dirty: ${env.git_dirty === true ? "yes" : "no"}`);
    lines.push(`python: ${env.python || "?"}  torch: ${env.torch || "?"}  cuda: ${env.cuda || "?"}`);
    if (env.gpu) lines.push(`gpu: ${Array.isArray(env.gpu) ? env.gpu.join(", ") : env.gpu}`);
  }
  if (subject.last_checkpoint) lines.push(`last_checkpoint: ${subject.last_checkpoint}`);
  lines.push("```");
  lines.push("");
  lines.push("## How to reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push(`autoresearch replay ${runId}`);
  lines.push("```");
  lines.push("");
  if (dashUrl && typeof dashUrl === "string") {
    lines.push(`[View on dashboard](${dashUrl})`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Generated by \`autoresearch pr-bundle ${runId}\` on ${new Date().toISOString()}_`);
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
