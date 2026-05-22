// `autoresearch agent-memory` — distill the project state into a CLAUDE.md
// fragment (or AGENTS.md, or .cursorrules — whatever the agent reads).
//
// A fresh agent walking into a project re-derives a lot: what's the goal,
// what's the baseline, what's been tried, what didn't work. This command
// answers all of those from the ledger + supporting files and emits a single
// markdown block the user can paste (or pipe with `--out`) into their agent's
// context file.
//
// Sections are kept short on purpose; the goal is to fit inside an agent's
// system-prompt-sized budget, not to be a full report.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, fmt } from "./researchloop-core.js";

function readSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function readGoal(cwd) {
  return readSafe(path.join(cwd, ".researchloop", "goal.md"));
}

function readPlan(cwd) {
  return readSafe(path.join(cwd, ".researchloop", "plan.md"));
}

function listLearnings(cwd) {
  const dir = path.join(cwd, ".researchloop", "learnings");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      id: f.replace(/\.md$/, ""),
      text: readSafe(path.join(dir, f)),
      mtime: fs.statSync(path.join(dir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

function listDeadEnds(cwd) {
  const dir = path.join(cwd, ".researchloop", "dead-ends");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .map((id) => {
      const archiveFile = path.join(dir, id, "ARCHIVE.md");
      const text = readSafe(archiveFile);
      const reasonMatch = text.match(/^Reason:\s*(.+)$/m);
      const mechMatch = text.match(/^Mechanism:\s*(.+)$/m);
      return {
        id,
        reason: reasonMatch ? reasonMatch[1].trim() : "",
        mechanism: mechMatch ? mechMatch[1].trim() : "",
      };
    });
}

function summarizeBlock(text, maxLines = 6, maxChars = 400) {
  if (!text) return "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join("\n").slice(0, maxChars);
}

function topRuns(rows, metric, preferHigher, n = 3) {
  const scored = rows
    .map((r) => ({ id: r.id, status: r.status, value: rowMetricValue(r, metric), wall: Number(r.wall_seconds) }))
    .filter((e) => Number.isFinite(e.value))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  return scored.slice(0, n);
}

export async function cmdAgentMemory(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const goalText = readGoal(cwd);
  const planText = readPlan(cwd);
  const rows = readLedgerRows(cwd);

  // Pick metric + direction from goal.md as best we can.
  const metricMatch = goalText.match(/^\s*[-*]?\s*metric:\s*([^\n]+)/im) || goalText.match(/^\s*metric:\s*([^\n]+)/im);
  const dirMatch = goalText.match(/^\s*[-*]?\s*direction:\s*([^\n]+)/im) || goalText.match(/^\s*direction:\s*([^\n]+)/im);
  const metric = String(option("--metric", metricMatch ? metricMatch[1].trim() : "val_loss")).trim();
  const direction = String(option("--direction", dirMatch ? dirMatch[1].trim() : "lower")).toLowerCase();
  const preferHigher = direction.startsWith("high") || direction === "max" || direction === "maximize";

  const baselineEntry = rows.find((r) => Array.isArray(r.tags) && r.tags.includes("baseline") && Number.isFinite(rowMetricValue(r, metric)));
  const baselineVal = baselineEntry ? rowMetricValue(baselineEntry, metric) : null;
  const top = topRuns(rows, metric, preferHigher, 3);
  const lessons = listLearnings(cwd).slice(0, 5);
  const deadEnds = listDeadEnds(cwd).slice(0, 5);

  const lines = [];
  lines.push("# AutoResearch-AI project memory");
  lines.push("");
  lines.push(`_Distilled by \`autoresearch agent-memory\` on ${new Date().toISOString()}._`);
  lines.push("");
  lines.push("## Goal");
  lines.push("");
  lines.push(summarizeBlock(goalText) || "_(no .researchloop/goal.md found)_");
  lines.push("");
  if (planText) {
    lines.push("## Plan (excerpt)");
    lines.push("");
    lines.push(summarizeBlock(planText, 8, 600));
    lines.push("");
  }
  lines.push("## Baseline");
  lines.push("");
  if (baselineEntry) {
    lines.push(`- id: \`${baselineEntry.id}\``);
    lines.push(`- ${metric}: ${fmt(baselineVal, 4)}`);
    if (baselineEntry.command) lines.push(`- command: \`${baselineEntry.command}\``);
  } else {
    lines.push("_No baseline run tagged yet — establish one with `autoresearch baseline`._");
  }
  lines.push("");
  lines.push(`## Top runs by ${metric} (${preferHigher ? "higher better" : "lower better"})`);
  lines.push("");
  if (top.length === 0) {
    lines.push("_(no runs with finite values yet)_");
  } else {
    lines.push("| id | status | " + metric + " |");
    lines.push("| --- | --- | --- |");
    for (const t of top) {
      lines.push(`| \`${t.id}\` | ${t.status || "—"} | ${fmt(t.value, 4)} |`);
    }
  }
  lines.push("");
  if (lessons.length > 0) {
    lines.push("## Lessons learned (most recent)");
    lines.push("");
    for (const l of lessons) {
      const firstPara = l.text.split(/\n## /)[1] || l.text;
      const snippet = firstPara.split("\n").slice(0, 3).join(" ").trim().slice(0, 240);
      lines.push(`- **${l.id}**: ${snippet}`);
    }
    lines.push("");
  }
  if (deadEnds.length > 0) {
    lines.push("## Dead ends (do not retry without new information)");
    lines.push("");
    for (const d of deadEnds) {
      lines.push(`- **${d.id}**${d.mechanism ? ` (mechanism: ${d.mechanism})` : ""}: ${d.reason || "no reason recorded"}`);
    }
    lines.push("");
  }
  lines.push("## Toolbelt cheatsheet");
  lines.push("");
  lines.push("- `autoresearch leaderboard` — top runs with deltas");
  lines.push("- `autoresearch significance A B` — is B's win real?");
  lines.push("- `autoresearch power --baseline-std N --detect-delta D` — how many seeds?");
  lines.push("- `autoresearch similar <run-id>` — have I tried this before?");
  lines.push("- `autoresearch ablate <run-id>` — what part of the win mattered?");
  lines.push("- `autoresearch forecast --command CMD` — how long / how much $?");
  lines.push("");

  const body = lines.join("\n");

  if (formatJson) {
    console.log(JSON.stringify({
      goal: goalText.trim(),
      baseline: baselineEntry ? { id: baselineEntry.id, value: baselineVal } : null,
      top_runs: top,
      lessons: lessons.map((l) => ({ id: l.id, mtime: l.mtime.toISOString() })),
      dead_ends: deadEnds,
      rendered: body,
    }, null, 2));
    return;
  }

  const outPath = option("--out", null);
  if (outPath && typeof outPath === "string") {
    fs.writeFileSync(outPath, body);
    console.log(`wrote ${outPath} (${body.split("\n").length} lines)`);
  } else {
    process.stdout.write(body);
  }
}
