// `autoresearch mechanisms` — list every distinct mechanism the agent (or
// human) has tried, with run counts and best metrics.
//
// "Mechanism" here is the field the hypothesis / propose flow writes; it lives
// either on the ledger row (`mechanism`, `hypothesis_mechanism`, `notes`) or
// in `.researchloop/scratchpad/hypotheses/*.md` under a `## Mechanism` section.
//
// This command gives `propose --novel` something concrete to dedupe against:
// if a proposed mechanism string is one substring-match away from an existing
// one in this list, the agent should think twice.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, rowMetricValue, fmt } from "./researchloop-core.js";

function extractMechanismFromMarkdown(text) {
  if (!text) return null;
  const m = text.match(/^##\s+Mechanism\s*$\n+([^\n]+(?:\n[^\n#]+)*)/im);
  if (!m) return null;
  return m[1].split("\n").map((s) => s.trim()).filter(Boolean).join(" ").slice(0, 240);
}

function loadHypothesisMechanisms(cwd) {
  const dir = path.join(cwd, ".researchloop", "scratchpad", "hypotheses");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const mech = extractMechanismFromMarkdown(text);
      return mech ? { source: `hypothesis:${f.replace(/\.md$/, "")}`, mechanism: mech } : null;
    })
    .filter(Boolean);
}

function rowMechanism(row) {
  if (!row) return null;
  for (const k of ["mechanism", "hypothesis_mechanism"]) {
    if (typeof row[k] === "string" && row[k].trim()) return row[k].trim().slice(0, 240);
  }
  if (row.config && typeof row.config === "object" && typeof row.config.mechanism === "string") {
    return row.config.mechanism.trim().slice(0, 240);
  }
  return null;
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function bestMetricFor(rows, metric) {
  const vals = rows.map((r) => rowMetricValue(r, metric)).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

export async function cmdMechanisms(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // `--for <run-id>`: show just one run's mechanism.
  const forIdx = args.findIndex((a) => a === "--for");
  const forId = forIdx !== -1 && args[forIdx + 1] ? String(args[forIdx + 1]).trim() : null;

  const rows = readLedgerRows(cwd);
  if (forId) {
    const row = rows.find((r) => String(r.id) === String(forId));
    if (!row) {
      console.error(`Run not found: ${forId}`);
      process.exitCode = 1;
      return;
    }
    const mech = rowMechanism(row);
    if (formatJson) {
      console.log(JSON.stringify({ id: forId, mechanism: mech }, null, 2));
    } else if (mech) {
      console.log(`mechanism for ${forId}:`);
      console.log(mech);
    } else {
      console.log(`No mechanism recorded for ${forId}.`);
    }
    return;
  }

  // Build the dictionary.
  const buckets = new Map();
  function add(mech, source, row = null) {
    const key = normalize(mech);
    if (!buckets.has(key)) {
      buckets.set(key, { mechanism: mech, sources: new Set(), rows: [] });
    }
    const b = buckets.get(key);
    b.sources.add(source);
    if (row) b.rows.push(row);
  }

  for (const row of rows) {
    const m = rowMechanism(row);
    if (m) add(m, `run:${row.id}`, row);
  }
  for (const hm of loadHypothesisMechanisms(cwd)) {
    add(hm.mechanism, hm.source);
  }

  // --check "TEXT": match against existing buckets (substring) and exit 1 if
  // there's a near-duplicate. Useful in CI for propose --novel.
  const checkRaw = option("--check", null);
  if (checkRaw && typeof checkRaw === "string") {
    const needle = normalize(checkRaw);
    const matches = [];
    for (const b of buckets.values()) {
      const hay = normalize(b.mechanism);
      if (hay === needle || hay.includes(needle) || needle.includes(hay)) {
        matches.push({ mechanism: b.mechanism, sources: Array.from(b.sources) });
      }
    }
    if (formatJson) {
      console.log(JSON.stringify({ query: checkRaw, matches, novel: matches.length === 0 }, null, 2));
    } else if (matches.length === 0) {
      console.log("novel: yes — no existing mechanism overlaps with this string.");
    } else {
      console.log(`novel: no — ${matches.length} existing mechanism${matches.length === 1 ? "" : "s"} overlap:`);
      for (const m of matches) {
        console.log(`- ${m.mechanism}  [${m.sources.slice(0, 3).join(", ")}${m.sources.length > 3 ? "…" : ""}]`);
      }
      process.exitCode = 1;
    }
    return;
  }

  const metric = String(option("--metric", "val_loss")).trim() || "val_loss";

  const entries = Array.from(buckets.values()).map((b) => {
    const best = bestMetricFor(b.rows, metric);
    return {
      mechanism: b.mechanism,
      sources: Array.from(b.sources).sort(),
      run_count: b.rows.length,
      best_metric: best,
    };
  }).sort((a, b) => b.run_count - a.run_count);

  if (formatJson) {
    console.log(JSON.stringify({ metric, n_distinct: entries.length, mechanisms: entries }, null, 2));
    return;
  }

  console.log(`autoresearch mechanisms`);
  console.log(`metric: ${metric}`);
  console.log(`n_distinct: ${entries.length}`);
  console.log("---");
  if (entries.length === 0) {
    console.log("No mechanisms recorded yet. Write hypothesis notes under .researchloop/scratchpad/hypotheses/ or set `mechanism` on run rows.");
    return;
  }
  console.log("| # | runs | best | mechanism | sources |");
  console.log("| --- | --- | --- | --- | --- |");
  entries.forEach((e, i) => {
    const best = e.best_metric ? `min=${fmt(e.best_metric.min, 4)} (n=${e.best_metric.n})` : "—";
    const trimmed = e.mechanism.length > 80 ? e.mechanism.slice(0, 77) + "…" : e.mechanism;
    const src = e.sources.slice(0, 3).join(", ") + (e.sources.length > 3 ? "…" : "");
    console.log(`| ${i + 1} | ${e.run_count} | ${best} | ${trimmed} | ${src} |`);
  });
  console.log("---");
  console.log("Check novelty of a new idea: autoresearch mechanisms --check \"your mechanism string\"");
}
