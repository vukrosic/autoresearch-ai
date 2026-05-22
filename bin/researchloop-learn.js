// `autoresearch learn` — capture what an experiment taught you.
//
// Every promotion/discard moment should produce a one-paragraph answer to
// "what did we learn?" Without this, the ledger becomes a graveyard of metrics
// with no institutional memory. The lessons file at .researchloop/learnings/
// is meant to be diffable, greppable, and exportable into CLAUDE.md / agent
// memory so future runs benefit from past mistakes.
//
// Modes:
//   learn --id <run-id> --lesson "TEXT"     write/append to .researchloop/learnings/<id>.md
//   learn --id <run-id>                     show the lesson for one run
//   learn --list                            list all lessons (most recent first)
//   learn --search "QUERY"                  grep lessons (case-insensitive)
//   learn --export                          dump all lessons as a single markdown file

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, ensureDir, rowMetricValue } from "./researchloop-core.js";

function learningsDir(cwd) {
  return path.join(cwd, ".researchloop", "learnings");
}

function learningPath(cwd, runId) {
  return path.join(learningsDir(cwd), `${runId}.md`);
}

function listLearnings(cwd) {
  const dir = learningsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return {
        id: f.replace(/\.md$/, ""),
        path: full,
        mtime: st.mtime,
        bytes: st.size,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function summarizeLearningFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const firstLesson = text.split(/\n## /)[1] || text;
  return firstLesson.split("\n").slice(0, 3).join(" ").trim().slice(0, 160);
}

export async function cmdLearn(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (hasFlag("--list")) {
    const items = listLearnings(cwd);
    if (formatJson) {
      console.log(JSON.stringify(items.map((it) => ({ ...it, mtime: it.mtime.toISOString() })), null, 2));
      return;
    }
    if (items.length === 0) {
      console.log("No lessons recorded yet. Use: autoresearch learn --id <run-id> --lesson \"TEXT\"");
      return;
    }
    console.log(`lessons (${items.length}):`);
    for (const it of items) {
      const headline = summarizeLearningFile(it.path);
      console.log(`- ${it.id}  ${it.mtime.toISOString()}`);
      if (headline) console.log(`    ${headline}`);
    }
    return;
  }

  const searchQuery = option("--search", null);
  if (searchQuery && typeof searchQuery === "string") {
    const items = listLearnings(cwd);
    const needle = searchQuery.toLowerCase();
    const hits = [];
    for (const it of items) {
      const text = fs.readFileSync(it.path, "utf8");
      if (text.toLowerCase().includes(needle)) {
        hits.push({ id: it.id, path: it.path, snippet: summarizeLearningFile(it.path) });
      }
    }
    if (formatJson) {
      console.log(JSON.stringify({ query: searchQuery, hits }, null, 2));
      return;
    }
    console.log(`matches: ${hits.length}`);
    for (const h of hits) {
      console.log(`- ${h.id}`);
      if (h.snippet) console.log(`    ${h.snippet}`);
    }
    return;
  }

  if (hasFlag("--export")) {
    const items = listLearnings(cwd);
    const out = [];
    out.push("# AutoResearch-AI lessons");
    out.push("");
    out.push(`Exported ${new Date().toISOString()} — ${items.length} lessons.`);
    out.push("");
    for (const it of items) {
      const text = fs.readFileSync(it.path, "utf8");
      out.push(`## ${it.id}`);
      out.push("");
      out.push(text.trim());
      out.push("");
    }
    const outPath = String(option("--out", path.join(cwd, ".researchloop", "LEARNINGS.md")));
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, out.join("\n"));
    console.log(`wrote ${outPath} (${items.length} lessons)`);
    return;
  }

  const runId = String(option("--id", "")).trim();
  if (!runId) {
    console.error("Usage: autoresearch learn --id <run-id> [--lesson \"TEXT\"] [--list] [--search QUERY] [--export] [--out FILE]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const row = findRowById(rows, runId);
  if (!row) {
    console.error(`Run not found: ${runId}`);
    process.exitCode = 1;
    return;
  }

  const lessonText = option("--lesson", null);
  if (lessonText && typeof lessonText === "string") {
    ensureDir(learningsDir(cwd));
    const lp = learningPath(cwd, runId);
    const stamp = new Date().toISOString();
    const metricKeys = row.metrics ? Object.keys(row.metrics).filter((k) => !k.endsWith("_std")) : [];
    const metricLine = metricKeys.length > 0
      ? metricKeys.map((k) => `${k}=${rowMetricValue(row, k)}`).join(" ")
      : "(no metrics)";
    const block = [
      `## ${stamp}`,
      "",
      `Run: \`${runId}\``,
      `Status: ${row.status || "unknown"}`,
      `Metrics: ${metricLine}`,
      "",
      lessonText.trim(),
      "",
    ].join("\n");
    fs.appendFileSync(lp, (fs.existsSync(lp) ? "\n" : "") + block);
    console.log(`recorded lesson for ${runId} -> ${path.relative(cwd, lp)}`);
    return;
  }

  // Show mode: print the lesson file if it exists.
  const lp = learningPath(cwd, runId);
  if (!fs.existsSync(lp)) {
    console.log(`No lesson recorded for ${runId} yet.`);
    console.log(`Add one: autoresearch learn --id ${runId} --lesson "TEXT"`);
    return;
  }
  process.stdout.write(fs.readFileSync(lp, "utf8"));
}
