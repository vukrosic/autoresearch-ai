// `autoresearch data-sample --path FILE` — quick look at a data file.
//
// Researchers spend a depressing fraction of their time staring at a dataset
// trying to confirm it's not corrupted. This command:
//   - autodetects JSONL, CSV, TSV, plain text
//   - samples N random rows (default 10), seeded for reproducibility
//   - reports total row count, length percentiles, JSON-field-presence
//     histogram (for JSONL), and class-balance if a `--label` field is given
//
// The output is meant to fit on one screen — enough to spot "oh, every row
// has an empty `target` field" or "the length distribution is suspicious."

import fs from "node:fs";
import path from "node:path";
import { percentile, fmt } from "./researchloop-core.js";

// Mulberry32 PRNG so --seed makes the sample reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function detectFormat(filePath, firstLine) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsonl" || ext === ".ndjson") return "jsonl";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "tsv";
  if (firstLine && firstLine.trim().startsWith("{")) return "jsonl";
  if (firstLine && firstLine.includes("\t")) return "tsv";
  if (firstLine && firstLine.includes(",")) return "csv";
  return "text";
}

function parseCsvLine(line, sep) {
  // Minimal CSV parser: handles quoted fields with embedded sep, doesn't handle
  // embedded newlines. Good enough for inspection.
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') { inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === sep) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function reservoirSample(arr, n, rng) {
  if (arr.length <= n) return arr.slice();
  const out = arr.slice(0, n);
  for (let i = n; i < arr.length; i += 1) {
    const j = Math.floor(rng() * (i + 1));
    if (j < n) out[j] = arr[i];
  }
  return out;
}

export async function cmdDataSample(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const filePath = option("--path", null);
  if (!filePath || typeof filePath !== "string") {
    console.error("Usage: autoresearch data-sample --path FILE [--n N] [--seed N] [--label FIELD] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  const resolved = path.resolve(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exitCode = 1;
    return;
  }

  const n = Math.max(1, parseInt(String(option("--n", "10")), 10) || 10);
  const seed = parseInt(String(option("--seed", "42")), 10);
  const labelField = option("--label", null);
  const rng = mulberry32(seed);

  // Stream the file once; collect every line. For huge files (>200 MB) we
  // could switch to a true reservoir over chunks, but inspection is rarely
  // that large in practice.
  const stat = fs.statSync(resolved);
  if (stat.size > 1024 * 1024 * 200) {
    console.error(`warning: file is ${(stat.size / 1024 / 1024).toFixed(1)} MiB; inspection loads everything into memory.`);
  }
  const lines = fs.readFileSync(resolved, "utf8").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const fmt0 = detectFormat(resolved, lines[0]);
  const lengths = lines.map((l) => l.length);
  const sampled = reservoirSample(lines, n, rng);

  // JSONL-specific stats: field presence + label distribution.
  let fieldHistogram = null;
  let labelHistogram = null;
  if (fmt0 === "jsonl") {
    const presence = new Map();
    const labels = new Map();
    let parseFailures = 0;
    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch { parseFailures += 1; continue; }
      if (obj && typeof obj === "object") {
        for (const k of Object.keys(obj)) presence.set(k, (presence.get(k) || 0) + 1);
        if (labelField && labelField in obj) {
          const v = String(obj[labelField]);
          labels.set(v, (labels.get(v) || 0) + 1);
        }
      }
    }
    fieldHistogram = Array.from(presence.entries())
      .map(([k, v]) => ({ field: k, count: v, pct: v / lines.length * 100 }))
      .sort((a, b) => b.count - a.count);
    fieldHistogram._parse_failures = parseFailures;
    if (labelField) {
      labelHistogram = Array.from(labels.entries())
        .map(([k, v]) => ({ label: k, count: v, pct: v / lines.length * 100 }))
        .sort((a, b) => b.count - a.count);
    }
  }

  const result = {
    path: resolved,
    bytes: stat.size,
    format: fmt0,
    n_rows: lines.length,
    length_percentiles: {
      p1: percentile(lengths, 0.01),
      p50: percentile(lengths, 0.50),
      p95: percentile(lengths, 0.95),
      p99: percentile(lengths, 0.99),
      min: Math.min(...lengths),
      max: Math.max(...lengths),
    },
    sample_n: sampled.length,
    sample: sampled,
    field_histogram: fieldHistogram,
    label_histogram: labelHistogram,
  };

  if (formatJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`autoresearch data-sample`);
  console.log(`path: ${resolved}`);
  console.log(`format: ${fmt0}`);
  console.log(`bytes: ${stat.size}  rows: ${lines.length}`);
  console.log(`length_chars: p1=${fmt(result.length_percentiles.p1, 0)}  p50=${fmt(result.length_percentiles.p50, 0)}  p95=${fmt(result.length_percentiles.p95, 0)}  p99=${fmt(result.length_percentiles.p99, 0)}  min=${result.length_percentiles.min}  max=${result.length_percentiles.max}`);
  console.log("---");
  console.log(`sampled rows (seed=${seed}):`);
  for (const row of sampled) {
    console.log(`  ${row.length > 200 ? row.slice(0, 200) + " …" : row}`);
  }
  if (fieldHistogram) {
    console.log("---");
    console.log("field presence (jsonl):");
    if (fieldHistogram._parse_failures > 0) console.log(`  parse_failures: ${fieldHistogram._parse_failures}`);
    for (const f of fieldHistogram.slice(0, 30)) {
      console.log(`  ${String(f.count).padStart(8)}  (${f.pct.toFixed(1).padStart(6)}%)  ${f.field}`);
    }
  }
  if (labelHistogram) {
    console.log("---");
    console.log(`label histogram (--label ${labelField}):`);
    for (const l of labelHistogram.slice(0, 30)) {
      console.log(`  ${String(l.count).padStart(8)}  (${l.pct.toFixed(1).padStart(6)}%)  ${l.label}`);
    }
    const top = labelHistogram[0];
    if (top && top.pct > 90) console.log(`warning: dominant class (${top.pct.toFixed(1)}%) — confirm this is intended`);
  }
}
