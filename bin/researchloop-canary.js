// `autoresearch canary --eval PATH --train PATH` — data-leak detector.
//
// Detects overlap between an evaluation dataset and a training set by hashing
// every row (sha256 of trimmed line content) on both sides and reporting
// matches. JSONL files are normalized so insignificant whitespace/key-order
// differences still hash the same. Plain text/CSV/TSV files are hashed
// line-by-line as-is.
//
// Why this matters: contamination is the dominant source of inflated benchmark
// numbers in modern LLM training. A pre-train canary check costs minutes and
// can invalidate (or save) months of compute.
//
// Two report modes:
//   --eval PATH --train PATH         exact-row overlap (default)
//   --eval PATH --train PATH --substring   substring containment of each eval
//                                          row inside any train row (catches
//                                          paraphrase-light leakage)

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function readLines(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function normalizeJson(line) {
  try {
    const obj = JSON.parse(line);
    // Sort keys for stable hashing.
    return JSON.stringify(obj, Object.keys(obj).sort ? Object.keys(obj).sort() : undefined);
  } catch {
    return line.trim();
  }
}

function hashLine(line, isJsonl) {
  const norm = isJsonl ? normalizeJson(line) : line.trim();
  return createHash("sha256").update(norm).digest("hex");
}

export async function cmdCanary(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const evalPath = option("--eval", null);
  const trainPath = option("--train", null);
  if (!evalPath || !trainPath || typeof evalPath !== "string" || typeof trainPath !== "string") {
    console.error("Usage: autoresearch canary --eval EVAL.jsonl --train TRAIN.jsonl [--substring] [--min-len N] [--max-show N] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const evalAbs = path.resolve(cwd, evalPath);
  const trainAbs = path.resolve(cwd, trainPath);
  if (!fs.existsSync(evalAbs)) { console.error(`File not found: ${evalAbs}`); process.exitCode = 1; return; }
  if (!fs.existsSync(trainAbs)) { console.error(`File not found: ${trainAbs}`); process.exitCode = 1; return; }

  const substring = hasFlag("--substring");
  const minLen = parseInt(String(option("--min-len", "32")), 10) || 32;
  const maxShow = parseInt(String(option("--max-show", "10")), 10) || 10;

  const evalLines = readLines(evalAbs);
  const trainLines = readLines(trainAbs);
  const evalIsJsonl = evalAbs.endsWith(".jsonl") || evalAbs.endsWith(".ndjson");
  const trainIsJsonl = trainAbs.endsWith(".jsonl") || trainAbs.endsWith(".ndjson");

  const overlaps = [];
  if (substring) {
    // Build a Set of every train line (trimmed) for fast `includes` testing.
    // For very large train sets this is O(N*M) on length — warn the caller.
    const trainSet = trainLines.map((l) => l.trim()).filter((l) => l.length >= minLen);
    for (let i = 0; i < evalLines.length; i += 1) {
      const e = evalLines[i].trim();
      if (e.length < minLen) continue;
      for (const t of trainSet) {
        if (t.includes(e)) { overlaps.push({ eval_index: i, eval_line: e.slice(0, 240), match: "substring" }); break; }
      }
    }
  } else {
    // Exact (normalized) hash overlap.
    const trainHashes = new Set();
    for (const line of trainLines) {
      const h = hashLine(line, trainIsJsonl);
      trainHashes.add(h);
    }
    for (let i = 0; i < evalLines.length; i += 1) {
      const h = hashLine(evalLines[i], evalIsJsonl);
      if (trainHashes.has(h)) {
        overlaps.push({ eval_index: i, eval_line: evalLines[i].slice(0, 240), hash: h, match: "exact" });
      }
    }
  }

  const overlapPct = evalLines.length > 0 ? overlaps.length / evalLines.length * 100 : 0;
  const verdict = overlaps.length === 0 ? "clean" : (overlapPct >= 5 ? "heavy_contamination" : "some_contamination");

  if (formatJson) {
    console.log(JSON.stringify({
      eval_path: evalAbs,
      train_path: trainAbs,
      eval_n: evalLines.length,
      train_n: trainLines.length,
      mode: substring ? "substring" : "exact",
      n_overlaps: overlaps.length,
      overlap_pct: overlapPct,
      verdict,
      samples: overlaps.slice(0, maxShow),
    }, null, 2));
  } else {
    console.log("autoresearch canary");
    console.log(`eval:  ${evalAbs}  (${evalLines.length} rows)`);
    console.log(`train: ${trainAbs}  (${trainLines.length} rows)`);
    console.log(`mode:  ${substring ? "substring containment" : "exact hash"}${substring ? `  (min-len ${minLen})` : ""}`);
    console.log("---");
    console.log(`overlaps: ${overlaps.length} of ${evalLines.length} eval rows (${overlapPct.toFixed(2)}%)`);
    console.log(`verdict: ${verdict}`);
    if (overlaps.length > 0) {
      console.log("---");
      console.log(`first ${Math.min(overlaps.length, maxShow)} matches:`);
      for (const o of overlaps.slice(0, maxShow)) {
        console.log(`  eval[${o.eval_index}]  ${o.eval_line}`);
      }
      if (verdict === "heavy_contamination") {
        console.log("---");
        console.log("warning: ≥5% of eval rows appear in training data — benchmark numbers will be inflated.");
      }
    }
  }

  if (overlaps.length > 0) process.exitCode = 2;
}
