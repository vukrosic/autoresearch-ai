// `autoresearch search "TEXT"` — full-text grep across the project's
// research artifacts: paper notes, hypothesis notes, learnings, archive
// reasons, questions, and ledger rows.
//
// Faster than remembering which subdir a half-typed thought lives in.
// Case-insensitive by default; substring match; ranked by file modification
// time (most recent first); shows a short context window around each hit.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows } from "./researchloop-core.js";

const SCAN_DIRS = [
  ["papers", path.join(".researchloop", "scratchpad", "papers")],
  ["hypotheses", path.join(".researchloop", "scratchpad", "hypotheses")],
  ["proposals", path.join(".researchloop", "scratchpad", "proposals.jsonl")],
  ["learnings", path.join(".researchloop", "learnings")],
  ["dead-ends", path.join(".researchloop", "dead-ends")],
  ["winners", path.join(".researchloop", "winners")],
  ["goal", path.join(".researchloop", "goal.md")],
  ["plan", path.join(".researchloop", "plan.md")],
];

function walk(p) {
  const out = [];
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  for (const entry of fs.readdirSync(p)) {
    out.push(...walk(path.join(p, entry)));
  }
  return out;
}

function findHits(text, needleLower, contextChars) {
  const hits = [];
  const lower = text.toLowerCase();
  let from = 0;
  while (true) {
    const idx = lower.indexOf(needleLower, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(text.length, idx + needleLower.length + contextChars);
    hits.push({
      offset: idx,
      snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
    });
    from = idx + needleLower.length;
    if (hits.length >= 5) break; // cap per file
  }
  return hits;
}

export async function cmdSearch(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Positional after `search` is the query (may include spaces if user quoted).
  const idx = args.findIndex((a) => a === "search");
  let query = "";
  if (idx !== -1) {
    for (let i = idx + 1; i < args.length; i += 1) {
      if (args[i].startsWith("-")) break;
      query += (query ? " " : "") + args[i];
    }
  }
  if (!query) query = String(option("--query", "")).trim();

  if (!query) {
    console.error("Usage: autoresearch search \"TEXT\" [--include ledger,papers,...] [--context N] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const includeRaw = option("--include", null);
  const includeSet = includeRaw && typeof includeRaw === "string"
    ? new Set(includeRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const includeLedger = includeSet === null || includeSet.has("ledger");
  const contextChars = Math.max(20, parseInt(String(option("--context", "60")), 10) || 60);
  const needleLower = query.toLowerCase();

  const filesScanned = [];
  const hitsByFile = [];

  // File-system scan.
  for (const [tag, rel] of SCAN_DIRS) {
    if (includeSet !== null && !includeSet.has(tag)) continue;
    const abs = path.join(cwd, rel);
    for (const file of walk(abs)) {
      filesScanned.push(file);
      let text;
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const hits = findHits(text, needleLower, contextChars);
      if (hits.length > 0) {
        const st = fs.statSync(file);
        hitsByFile.push({
          source: tag,
          path: path.relative(cwd, file),
          mtime: st.mtime.toISOString(),
          hits,
        });
      }
    }
  }

  // Ledger scan (each row stringified).
  const ledgerHits = [];
  if (includeLedger) {
    const rows = readLedgerRows(cwd);
    for (const r of rows) {
      const blob = JSON.stringify(r);
      if (blob.toLowerCase().includes(needleLower)) {
        ledgerHits.push({
          id: r.id,
          status: r.status,
          snippet: blob.length > 200 ? blob.slice(0, 200) + "…" : blob,
        });
      }
    }
  }

  hitsByFile.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));

  if (formatJson) {
    console.log(JSON.stringify({
      query,
      n_files_scanned: filesScanned.length,
      n_files_with_hits: hitsByFile.length,
      n_ledger_hits: ledgerHits.length,
      file_hits: hitsByFile,
      ledger_hits: ledgerHits,
    }, null, 2));
    return;
  }

  console.log(`autoresearch search`);
  console.log(`query: ${query}`);
  console.log(`scanned: ${filesScanned.length} files`);
  console.log(`matches: ${hitsByFile.length} files, ${ledgerHits.length} ledger rows`);
  console.log("---");
  for (const fh of hitsByFile) {
    console.log(`# ${fh.path}  [${fh.source}]  ${fh.mtime}`);
    for (const h of fh.hits) {
      console.log(`  · ${h.snippet}`);
    }
  }
  if (ledgerHits.length > 0) {
    console.log("---");
    console.log("ledger rows:");
    for (const lh of ledgerHits) {
      console.log(`  - ${lh.id}  [${lh.status || "?"}]  ${lh.snippet}`);
    }
  }
}
