// `autoresearch story <run-id>` — narrate a run's life.
//
// Given a run id, walk the ledger and tell the story:
//   - when it started, what command, what env
//   - what changed vs its parent (config diff)
//   - what happened during the run (status, kill_reason, retries, replays)
//   - what came after it (children, promotions, archives, lessons learned)
//
// This is the human-readable answer to "what's the deal with this run?"
// without making the user pivot between five different commands.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, rowMetricValue, fmt } from "./researchloop-core.js";

function fmtSeconds(s) {
  if (!Number.isFinite(s)) return "—";
  if (s < 90) return `${s.toFixed(1)}s`;
  if (s < 5400) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

function findChildren(rows, parentId) {
  return rows.filter((r) =>
    String(r.parent_id) === String(parentId)
    || String(r.replay_of) === String(parentId)
    || String(r.retry_of) === String(parentId)
    || String(r.resume_of) === String(parentId)
  );
}

function summarizeParamDiff(parent, run) {
  if (!parent) return [];
  const pp = (parent.params) || (parent.config && parent.config.params) || {};
  const rp = (run.params) || (run.config && run.config.params) || {};
  const keys = Array.from(new Set([...Object.keys(pp), ...Object.keys(rp)])).sort();
  return keys
    .filter((k) => String(pp[k]) !== String(rp[k]))
    .map((k) => ({ key: k, parent: pp[k] ?? null, run: rp[k] ?? null }));
}

function loadLesson(cwd, runId) {
  const p = path.join(cwd, ".researchloop", "learnings", `${runId}.md`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function loadArchive(cwd, runId) {
  const p = path.join(cwd, ".researchloop", "dead-ends", runId, "ARCHIVE.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export async function cmdStory(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const idx = args.findIndex((a) => a === "story");
  let runId = String(option("--id", "")).trim();
  if (!runId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    runId = String(args[idx + 1]).trim();
  }

  if (!runId) {
    console.error("Usage: autoresearch story <run-id> [--format text|json] [--dir PATH]");
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

  // Walk ancestors.
  const ancestors = [];
  let cur = subject;
  const seen = new Set([cur.id]);
  while (cur && cur.parent_id) {
    const p = findRowById(rows, cur.parent_id);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    ancestors.push(p);
    cur = p;
  }
  ancestors.reverse(); // oldest first

  const directParent = subject.parent_id ? findRowById(rows, subject.parent_id) : null;
  const paramDiffs = summarizeParamDiff(directParent, subject);
  const children = findChildren(rows, subject.id);
  const lesson = loadLesson(cwd, runId);
  const archive = loadArchive(cwd, runId);

  const story = {
    id: subject.id,
    status: subject.status,
    started_at: subject.started_at || subject.timestamp,
    ended_at: subject.ended_at,
    wall_seconds: Number(subject.wall_seconds),
    est_cost_usd: Number.isFinite(Number(subject.est_cost_usd)) ? Number(subject.est_cost_usd) : null,
    command: subject.command,
    metrics: subject.metrics || {},
    parent_id: subject.parent_id || null,
    replay_of: subject.replay_of || null,
    retry_of: subject.retry_of || null,
    resume_of: subject.resume_of || null,
    kill_reason: subject.kill_reason || null,
    ancestors: ancestors.map((a) => ({ id: a.id, status: a.status, metrics: a.metrics || {} })),
    param_diff_vs_parent: paramDiffs,
    children: children.map((c) => ({
      id: c.id,
      status: c.status,
      relation: c.replay_of === subject.id ? "replay"
        : c.retry_of === subject.id ? "retry"
        : c.resume_of === subject.id ? "resume"
        : "child",
      metrics: c.metrics || {},
    })),
    lesson: lesson || null,
    archived: archive ? { marker: archive } : null,
  };

  if (formatJson) {
    console.log(JSON.stringify(story, null, 2));
    return;
  }

  console.log(`# story: ${runId}`);
  console.log("");
  console.log(`status: ${subject.status || "unknown"}  ·  wall: ${fmtSeconds(Number(subject.wall_seconds))}  ·  started: ${subject.started_at || subject.timestamp || "?"}`);
  if (subject.command) console.log(`command: ${subject.command}`);
  console.log("");

  console.log("## Lineage");
  if (ancestors.length === 0) {
    console.log("(no ancestors — this is a root run)");
  } else {
    for (const a of ancestors) {
      const metricKeys = Object.keys(a.metrics || {}).filter((k) => !k.endsWith("_std"));
      const m = metricKeys.length ? `${metricKeys[0]}=${fmt(rowMetricValue(a, metricKeys[0]), 4)}` : "(no metric)";
      console.log(`  ← ${a.id}  [${a.status || "?"}]  ${m}`);
    }
  }
  console.log(`  → ${subject.id}  (this run)`);
  console.log("");

  if (paramDiffs.length > 0) {
    console.log("## Changes vs parent");
    for (const p of paramDiffs) {
      console.log(`  ${p.key}: ${p.parent} → ${p.run}`);
    }
    console.log("");
  }

  console.log("## Metrics");
  const metricKeys = Object.keys(subject.metrics || {}).filter((k) => !k.endsWith("_std"));
  if (metricKeys.length === 0) {
    console.log("(no metrics recorded)");
  } else {
    for (const k of metricKeys) {
      console.log(`  ${k}: ${fmt(rowMetricValue(subject, k), 6)}`);
    }
  }
  console.log("");

  if (subject.kill_reason) {
    console.log("## Why it stopped");
    console.log(`  ${subject.kill_reason}`);
    console.log("");
  }

  if (children.length > 0) {
    console.log("## What came after");
    for (const c of children) {
      const relation = c.replay_of === subject.id ? "replay"
        : c.retry_of === subject.id ? "retry"
        : c.resume_of === subject.id ? "resume"
        : "child";
      const metricKeysC = Object.keys(c.metrics || {}).filter((k) => !k.endsWith("_std"));
      const m = metricKeysC.length ? `${metricKeysC[0]}=${fmt(rowMetricValue(c, metricKeysC[0]), 4)}` : "(no metric)";
      console.log(`  → ${c.id}  [${relation}, ${c.status || "?"}]  ${m}`);
    }
    console.log("");
  }

  if (lesson) {
    console.log("## Lesson");
    console.log(lesson.trim());
    console.log("");
  }
  if (archive) {
    console.log("## Archived");
    console.log(archive.trim());
    console.log("");
  }
}
